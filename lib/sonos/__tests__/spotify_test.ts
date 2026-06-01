import { assertEquals, assertStringIncludes } from '@std/assert';
import { buildSpotifyTrack } from '../services/spotify.ts';

const service = { id: 12, type: 3079 }; // verified against the live Office system

Deno.test('track URI uses x-sonos-spotify with sid/flags/sn', () => {
  const { uri, metadata } = buildSpotifyTrack(
    'spotify:track:4uLU6hMCjMI75M1A2tKUQC',
    service,
  );
  assertEquals(
    uri,
    'x-sonos-spotify:spotify%3Atrack%3A4uLU6hMCjMI75M1A2tKUQC?sid=12&flags=32&sn=1',
  );
  assertStringIncludes(metadata, 'SA_RINCON3079_X_#Svc3079-0-Token');
  assertStringIncludes(
    metadata,
    'id="00030020spotify%3Atrack%3A4uLU6hMCjMI75M1A2tKUQC"',
  );
});

Deno.test('a non-default account changes only sn; cdudn token stays -0-', () => {
  const { uri, metadata } = buildSpotifyTrack(
    'spotify:track:4uLU6hMCjMI75M1A2tKUQC',
    service,
    2,
  );
  assertStringIncludes(uri, '&sn=2');
  // Verified against the live Office system: a real sn=2 Spotify favorite still
  // carries the -0- token, so the account lives in `sn`, not the cdudn token.
  assertStringIncludes(metadata, 'SA_RINCON3079_X_#Svc3079-0-Token');
});

Deno.test('album/playlist URI uses x-rincon-cpcontainer', () => {
  const { uri } = buildSpotifyTrack(
    'spotify:album:1DFixLWuPkv3KT3TnV35m3',
    service,
  );
  assertEquals(
    uri,
    'x-rincon-cpcontainer:0006206cspotify%3Aalbum%3A1DFixLWuPkv3KT3TnV35m3',
  );
});
