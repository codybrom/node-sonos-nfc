import { assertEquals, assertStringIncludes } from '@std/assert';
import { buildSpotifyTrack } from '../services/spotify.ts';

const service = { id: 12, type: 3079 }; // verified against the live Office system

Deno.test('track URI uses x-sonos-spotify with sid/flags/sn', () => {
  const { uri, metadata } = buildSpotifyTrack('spotify:track:4uLU6hMCjMI75M1A2tKUQC', service);
  assertEquals(
    uri,
    'x-sonos-spotify:spotify%3Atrack%3A4uLU6hMCjMI75M1A2tKUQC?sid=12&flags=32&sn=1',
  );
  assertStringIncludes(metadata, 'SA_RINCON3079_X_#Svc3079-0-Token');
  assertStringIncludes(metadata, 'id="00030020spotify%3Atrack%3A4uLU6hMCjMI75M1A2tKUQC"');
});

Deno.test('album/playlist URI uses x-rincon-cpcontainer', () => {
  const { uri } = buildSpotifyTrack('spotify:album:1DFixLWuPkv3KT3TnV35m3', service);
  assertEquals(uri, 'x-rincon-cpcontainer:0006206cspotify%3Aalbum%3A1DFixLWuPkv3KT3TnV35m3');
});
