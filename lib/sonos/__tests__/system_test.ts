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

// Cdudn metadata for a Spotify favorite under account `token` (3079 = Spotify).
const spotifyResMD = (token: string) =>
  encodeEntities(
    `<DIDL-Lite><desc id="cdudn">SA_RINCON3079_X_#Svc3079-${token}-Token</desc></DIDL-Lite>`,
  );

const FAV_DIDL = '<DIDL-Lite>' +
  // Title carries an entity (`&amp;`) — must come back decoded.
  '<item id="FV:2/1"><dc:title>Rock &amp; Roll</dc:title>' +
  '<res protocolInfo="x-sonosapi-hls:*:*:*">x-sonosapi-hls:foo?sid=37&amp;flags=296</res>' +
  `<r:resMD>${encodeEntities('<DIDL-Lite>radio-meta</DIDL-Lite>')}</r:resMD></item>` +
  // Spotify account "0" — has a playable favorite, so its sn=2 is discoverable.
  '<item id="FV:2/2"><dc:title>Songs</dc:title>' +
  '<res protocolInfo="x-rincon-cpcontainer:*">x-rincon-cpcontainer:100e206cyour_songs?sid=12&amp;flags=8&amp;sn=2</res>' +
  `<r:resMD>${spotifyResMD('0')}</r:resMD></item>` +
  // A second Spotify account "61a1d0cb" — only a shortcut favorite (empty res),
  // so its sn can't be discovered.
  '<item id="FV:2/3"><dc:title>Discover Weekly</dc:title><res></res>' +
  `<r:resMD>${spotifyResMD('61a1d0cb')}</r:resMD></item>` +
  '</DIDL-Lite>';
const FAVORITES = `<Result>${encodeEntities(FAV_DIDL)}</Result><NumberReturned>3</NumberReturned>`;

// A room queue holding a Spotify track from the second account (61a1d0cb) — its
// res URI carries sn=3, which no favorite under that account revealed.
const QUEUE_DIDL = '<DIDL-Lite>' +
  '<item id="Q:0/1"><dc:title>Some Track</dc:title>' +
  '<res protocolInfo="x-sonos-spotify:*">x-sonos-spotify:spotify%3atrack%3aX?sid=12&amp;flags=32&amp;sn=3</res>' +
  `<r:resMD>${spotifyResMD('61a1d0cb')}</r:resMD></item>` +
  // A queued track with sn=2 but no cdudn token — must merge into account "0".
  '<item id="Q:0/2"><dc:title>Queued Hit</dc:title>' +
  '<res protocolInfo="x-sonos-spotify:*">x-sonos-spotify:spotify%3atrack%3aY?sid=12&amp;flags=32&amp;sn=2</res></item>' +
  '</DIDL-Lite>';
const QUEUE = `<Result>${encodeEntities(QUEUE_DIDL)}</Result><NumberReturned>1</NumberReturned>`;

// Stub the network; the real soap.ts/xml.ts pipeline runs end-to-end.
function withStubbedFetch(): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (
    _url: string | URL | Request,
    opts?: RequestInit,
  ): Promise<Response> => {
    const body = String(opts?.body ?? '');
    let xml = '';
    if (body.includes('GetZoneGroupState')) xml = TOPOLOGY;
    else if (body.includes('ListAvailableServices')) xml = SERVICES;
    else if (body.includes('Browse')) {
      xml = body.includes('FV:2') ? FAVORITES : body.includes('Q:0') ? QUEUE : '<Result></Result>';
    }
    return Promise.resolve(new Response(xml, { status: 200 }));
  };
  return () => {
    globalThis.fetch = original;
  };
}

async function booted(): Promise<SonosSystem> {
  return await new SonosSystem({ seedIp: '192.168.0.195' }).bootstrap();
}

Deno.test('listRooms returns each room (original casing) with its coordinator IP', async () => {
  const restore = withStubbedFetch();
  try {
    assertEquals((await booted()).listRooms(), [
      { name: 'Kitchen', ip: '192.168.0.96' },
      { name: 'Office', ip: '192.168.0.195' },
    ]);
  } finally {
    restore();
  }
});

Deno.test('connectedIp reports the player tapdeck is talking to', async () => {
  const restore = withStubbedFetch();
  try {
    assertEquals((await booted()).connectedIp, '192.168.0.195');
  } finally {
    restore();
  }
});

Deno.test(
  'resolveRoom("Office") returns the coordinator (.195), not the invisible .113',
  async () => {
    const restore = withStubbedFetch();
    try {
      const p = await (await booted()).resolveRoom('office');
      assertEquals(p.uuid, 'RINCON_OFFICE195');
      assertEquals(p.baseUrl, 'http://192.168.0.195:1400');
    } finally {
      restore();
    }
  },
);

Deno.test(
  'resolveRoom is case-insensitive and resolves other rooms',
  async () => {
    const restore = withStubbedFetch();
    try {
      assertEquals(
        (await (await booted()).resolveRoom('Kitchen')).baseUrl,
        'http://192.168.0.96:1400',
      );
    } finally {
      restore();
    }
  },
);

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
    assertEquals(await (await booted()).getSpotifyService(), {
      id: 12,
      type: 3079,
    });
  } finally {
    restore();
  }
});

Deno.test(
  'getFavorites parses titles and double-decoded uri/metadata',
  async () => {
    const restore = withStubbedFetch();
    try {
      const favs = await (await booted()).getFavorites();
      assertEquals(
        favs.map((f) => f.title),
        ['Rock & Roll', 'Songs', 'Discover Weekly'], // title entity decoded
      );
      const radio = favs[0]!;
      assertEquals(radio.uri, 'x-sonosapi-hls:foo?sid=37&flags=296');
      assertEquals(radio.metadata, '<DIDL-Lite>radio-meta</DIDL-Lite>');
    } finally {
      restore();
    }
  },
);

Deno.test(
  'getSpotifyAccounts groups by account token, filling sn from favorites and queues',
  async () => {
    const restore = withStubbedFetch();
    try {
      // Account "0" gets sn=2 from the "Songs" favorite, and the token-less
      // "Queued Hit" (sn=2) merges into it. Account "61a1d0cb" has no playable
      // favorite, but its queued "Some Track" supplies sn=3 and pulls in the
      // token-only "Discover Weekly" favorite. TuneIn (sid=37) is ignored.
      assertEquals(await (await booted()).getSpotifyAccounts(), [
        { token: '0', sn: 2, examples: ['Songs', 'Queued Hit'] },
        { token: '61a1d0cb', sn: 3, examples: ['Discover Weekly', 'Some Track'] },
      ]);
    } finally {
      restore();
    }
  },
);
