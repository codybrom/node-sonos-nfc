// Spotify playback. Turns a `spotify:track|album|playlist:ID` URI into the
// Sonos-native URI + DIDL metadata, then runs the "play now" queue sequence.

import type { Player } from '../player.ts';
import type { SonosSystem, SpotifyService } from '../system.ts';

function buildMetadata(encodedUri: string, serviceType: number): string {
  return (
    '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
    'xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" ' +
    'xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" ' +
    'xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">' +
    `<item id="00030020${encodedUri}" restricted="true">` +
    '<upnp:class>object.item.audioItem.musicTrack</upnp:class>' +
    '<desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">' +
    `SA_RINCON${serviceType}_X_#Svc${serviceType}-0-Token</desc></item></DIDL-Lite>`
  );
}

// Build the { uri, metadata } a Sonos coordinator needs for a Spotify item.
// `accountSn` is the Sonos account serial number — which linked Spotify account
// to play from (1 = the first/default account). It selects the account via the
// track URI's `sn=`; the cdudn metadata token stays at `-0-` (observed constant
// across accounts on real systems — `sn` is the actual account selector).
export function buildSpotifyTrack(
  spotifyUri: string,
  service: SpotifyService,
  accountSn = 1,
): { uri: string; metadata: string } {
  const enc = encodeURIComponent(spotifyUri);
  const uri = spotifyUri.startsWith('spotify:track:')
    ? `x-sonos-spotify:${enc}?sid=${service.id}&flags=32&sn=${accountSn}`
    : `x-rincon-cpcontainer:0006206c${enc}`;
  return { uri, metadata: buildMetadata(enc, service.type) };
}

// Play a Spotify URI immediately on the given coordinator.
export async function now(
  coordinator: Player,
  system: SonosSystem,
  spotifyUri: string,
  accountSn = 1,
): Promise<string> {
  const service = await system.getSpotifyService();
  const { uri, metadata } = buildSpotifyTrack(spotifyUri, service, accountSn);
  await coordinator.setAVTransport(coordinator.queueUri());
  const firstTrack = await coordinator.addURIToQueue(uri, metadata, true, 1);
  await coordinator.trackSeek(firstTrack);
  return coordinator.play();
}
