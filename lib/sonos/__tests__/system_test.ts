import { assertEquals, assertRejects } from '@std/assert';
import { encodeEntities } from '../xml.ts';
import { SonosSystem } from '../system.ts';

// --- Fixtures modeled on the real "Office" system (Office is a stereo pair:
// coordinator .195 is visible; the .113 right channel is Invisible="1"). ---
const TOPOLOGY_INNER = '<ZoneGroupState><ZoneGroups>' +
  '<ZoneGroup Coordinator="RINCON_OFFICE195" ID="g1">' +
  '<ZoneGroupMember UUID="RINCON_OFFICE195" Location="http://192.168.0.195:1400/xml/device_description.xml" ZoneName="Office"/>' +
  '<ZoneGroupMember UUID="RINCON_OFFICE113" Location="http://192.168.0.113:1400/xml/device_description.xml" ZoneName="Office" Invisible="1"/>' +
  '</ZoneGroup>' +
  '<ZoneGroup Coordinator="RINCON_KITCHEN96" ID="g2">' +
  '<ZoneGroupMember UUID="RINCON_KITCHEN96" Location="http://192.168.0.96:1400/xml/device_description.xml" ZoneName="Kitchen"/>' +
  '</ZoneGroup>' +
  '</ZoneGroups></ZoneGroupState>';
const TOPOLOGY = `<ZoneGroupState>${encodeEntities(TOPOLOGY_INNER)}</ZoneGroupState>`;

const SERVICES = `<AvailableServiceDescriptorList>${
  encodeEntities(
    '<Services><Service Id="9" Name="TuneIn"/><Service Id="12" Name="Spotify"/></Services>',
  )
}</AvailableServiceDescriptorList>`;

const FAV_DIDL = '<DIDL-Lite>' +
  '<item id="FV:2/1"><dc:title>Radio One</dc:title>' +
  '<res protocolInfo="x-sonosapi-hls:*:*:*">x-sonosapi-hls:foo?sid=37&amp;flags=296</res>' +
  `<r:resMD>${encodeEntities('<DIDL-Lite>radio-meta</DIDL-Lite>')}</r:resMD></item>` +
  '<item id="FV:2/2"><dc:title>Songs</dc:title>' +
  '<res protocolInfo="x-rincon-cpcontainer:*">x-rincon-cpcontainer:100e206cyour_songs?sid=12&amp;flags=8</res></item>' +
  '</DIDL-Lite>';
const FAVORITES = `<Result>${encodeEntities(FAV_DIDL)}</Result><NumberReturned>2</NumberReturned>`;

// Stub the network; the real soap.ts/xml.ts pipeline runs end-to-end.
function withStubbedFetch(): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (_url: string | URL | Request, opts?: RequestInit): Promise<Response> => {
    const body = String(opts?.body ?? '');
    let xml = '';
    if (body.includes('GetZoneGroupState')) xml = TOPOLOGY;
    else if (body.includes('ListAvailableServices')) xml = SERVICES;
    else if (body.includes('Browse')) xml = body.includes('FV:2') ? FAVORITES : '<Result></Result>';
    return Promise.resolve(new Response(xml, { status: 200 }));
  };
  return () => {
    globalThis.fetch = original;
  };
}

async function booted(): Promise<SonosSystem> {
  return await new SonosSystem({ seedIp: '192.168.0.195' }).bootstrap();
}

Deno.test('resolveRoom("Office") returns the coordinator (.195), not the invisible .113', async () => {
  const restore = withStubbedFetch();
  try {
    const p = await (await booted()).resolveRoom('office');
    assertEquals(p.uuid, 'RINCON_OFFICE195');
    assertEquals(p.baseUrl, 'http://192.168.0.195:1400');
  } finally {
    restore();
  }
});

Deno.test('resolveRoom is case-insensitive and resolves other rooms', async () => {
  const restore = withStubbedFetch();
  try {
    assertEquals(
      (await (await booted()).resolveRoom('Kitchen')).baseUrl,
      'http://192.168.0.96:1400',
    );
  } finally {
    restore();
  }
});

Deno.test('unknown room throws', async () => {
  const restore = withStubbedFetch();
  try {
    const sys = await booted();
    await assertRejects(() => sys.resolveRoom('garage'), Error, 'not found');
  } finally {
    restore();
  }
});

Deno.test('getSpotifyService derives id 12 -> serviceType 3079', async () => {
  const restore = withStubbedFetch();
  try {
    assertEquals(await (await booted()).getSpotifyService(), { id: 12, type: 3079 });
  } finally {
    restore();
  }
});

Deno.test('getFavorites parses titles and double-decoded uri/metadata', async () => {
  const restore = withStubbedFetch();
  try {
    const favs = await (await booted()).getFavorites();
    assertEquals(favs.map((f) => f.title), ['Radio One', 'Songs']);
    const radio = favs[0]!;
    assertEquals(radio.uri, 'x-sonosapi-hls:foo?sid=37&flags=296');
    assertEquals(radio.metadata, '<DIDL-Lite>radio-meta</DIDL-Lite>');
  } finally {
    restore();
  }
});
