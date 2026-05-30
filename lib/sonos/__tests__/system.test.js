import { jest } from '@jest/globals';
import { encodeEntities } from '../xml.js';
import { SonosSystem } from '../system.js';

// --- Fixtures modeled on the real "Office" system (Office is a stereo pair:
// coordinator .195 is visible; the .113 right channel is Invisible="1"). ---
const TOPOLOGY_INNER =
  '<ZoneGroupState><ZoneGroups>' +
  '<ZoneGroup Coordinator="RINCON_OFFICE195" ID="g1">' +
  '<ZoneGroupMember UUID="RINCON_OFFICE195" Location="http://192.168.0.195:1400/xml/device_description.xml" ZoneName="Office"/>' +
  '<ZoneGroupMember UUID="RINCON_OFFICE113" Location="http://192.168.0.113:1400/xml/device_description.xml" ZoneName="Office" Invisible="1"/>' +
  '</ZoneGroup>' +
  '<ZoneGroup Coordinator="RINCON_KITCHEN96" ID="g2">' +
  '<ZoneGroupMember UUID="RINCON_KITCHEN96" Location="http://192.168.0.96:1400/xml/device_description.xml" ZoneName="Kitchen"/>' +
  '</ZoneGroup>' +
  '</ZoneGroups></ZoneGroupState>';
const TOPOLOGY = `<ZoneGroupState>${encodeEntities(TOPOLOGY_INNER)}</ZoneGroupState>`;

const SERVICES = `<AvailableServiceDescriptorList>${encodeEntities(
  '<Services><Service Id="9" Name="TuneIn"/><Service Id="12" Name="Spotify" Uri="https://x"/></Services>'
)}</AvailableServiceDescriptorList>`;

const FAV_DIDL =
  '<DIDL-Lite>' +
  '<item id="FV:2/1"><dc:title>Radio One</dc:title>' +
  '<res protocolInfo="x-sonosapi-hls:*:*:*">x-sonosapi-hls:foo?sid=37&amp;flags=296</res>' +
  `<r:resMD>${encodeEntities('<DIDL-Lite>radio-meta</DIDL-Lite>')}</r:resMD></item>` +
  '<item id="FV:2/2"><dc:title>Songs</dc:title>' +
  '<res protocolInfo="x-rincon-cpcontainer:*">x-rincon-cpcontainer:100e206cyour_songs?sid=12&amp;flags=8</res></item>' +
  '</DIDL-Lite>';
const FAVORITES = `<Result>${encodeEntities(FAV_DIDL)}</Result><NumberReturned>2</NumberReturned>`;

// Mock the network only; the real soap.js/xml.js pipeline runs end-to-end.
beforeEach(() => {
  global.fetch = jest.fn(async (url, opts) => {
    const body = String(opts?.body ?? '');
    let xml = '';
    if (body.includes('GetZoneGroupState')) xml = TOPOLOGY;
    else if (body.includes('ListAvailableServices')) xml = SERVICES;
    else if (body.includes('Browse')) xml = body.includes('FV:2') ? FAVORITES : '<Result></Result>';
    return new Response(xml, { status: 200 });
  });
});
afterEach(() => {
  delete global.fetch;
});

async function booted() {
  return new SonosSystem({ seedIp: '192.168.0.195' }).bootstrap();
}

test('resolveRoom("Office") returns the group coordinator (.195), not the invisible .113', async () => {
  const sys = await booted();
  const p = await sys.resolveRoom('office');
  expect(p.uuid).toBe('RINCON_OFFICE195');
  expect(p.baseUrl).toBe('http://192.168.0.195:1400');
});

test('resolveRoom is case-insensitive and resolves other rooms', async () => {
  const sys = await booted();
  expect((await sys.resolveRoom('Kitchen')).baseUrl).toBe('http://192.168.0.96:1400');
});

test('unknown room throws with the known room list', async () => {
  const sys = await booted();
  await expect(sys.resolveRoom('garage')).rejects.toThrow(/not found/i);
});

test('getSpotifyService derives id 12 -> serviceType 3079', async () => {
  const sys = await booted();
  expect(await sys.getSpotifyService()).toEqual({ id: 12, type: 3079 });
});

test('getFavorites parses titles and double-decoded uri/metadata', async () => {
  const sys = await booted();
  const favs = await sys.getFavorites();
  expect(favs.map((f) => f.title)).toEqual(['Radio One', 'Songs']);
  expect(favs[0].uri).toBe('x-sonosapi-hls:foo?sid=37&flags=296'); // & fully decoded
  expect(favs[0].metadata).toBe('<DIDL-Lite>radio-meta</DIDL-Lite>'); // decoded twice
});
