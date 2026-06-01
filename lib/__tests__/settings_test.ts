import { assertEquals } from '@std/assert';
import { configFilePath, DEFAULT_SETTINGS, resolveSettings } from '../settings.ts';

Deno.test('configFilePath is ~/.tapdeck/config.json', () => {
  assertEquals(configFilePath('/home/pi'), '/home/pi/.tapdeck/config.json');
});

Deno.test('configFilePath is null when HOME is unset', () => {
  assertEquals(configFilePath(undefined), null);
});

Deno.test('resolveSettings fills every default for an empty config', () => {
  assertEquals(resolveSettings({}), DEFAULT_SETTINGS);
});

Deno.test('resolveSettings keeps valid user values', () => {
  const resolved = resolveSettings({
    sonos_room: 'Kitchen',
    reset_repeat: false,
    min_volume: 25,
    spotify_account_sn: 3,
  });
  assertEquals(resolved.sonos_room, 'Kitchen');
  assertEquals(resolved.reset_repeat, false);
  assertEquals(resolved.min_volume, 25);
  assertEquals(resolved.spotify_account_sn, 3);
  assertEquals(resolved.reset_shuffle, true); // untouched fields still default
});

Deno.test('resolveSettings coerces out-of-range / blank values to defaults', () => {
  const resolved = resolveSettings({
    sonos_room: '   ',
    spotify_account_sn: 0, // must be >= 1
  });
  assertEquals(resolved.sonos_room, DEFAULT_SETTINGS.sonos_room);
  assertEquals(resolved.spotify_account_sn, DEFAULT_SETTINGS.spotify_account_sn);
});
