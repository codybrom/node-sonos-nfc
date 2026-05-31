import { assertEquals } from '@std/assert';
import { assertSpyCallArgs, assertSpyCalls, type Spy, spy, stub } from '@std/testing/mock';
import process_sonos_command, { type CommandDeps } from '../process_sonos_command.ts';

function makeDeps(volume = 30) {
  const player = {
    play: spy(() => Promise.resolve('')),
    pause: spy(() => Promise.resolve('')),
    playPause: spy(() => Promise.resolve('')),
    nextTrack: spy(() => Promise.resolve('')),
    previousTrack: spy(() => Promise.resolve('')),
    mute: spy(() => Promise.resolve('')),
    unMute: spy(() => Promise.resolve('')),
    clearQueue: spy(() => Promise.resolve('')),
    setRepeat: spy(() => Promise.resolve('')),
    setShuffle: spy(() => Promise.resolve('')),
    setCrossfade: spy(() => Promise.resolve('')),
    setVolume: spy(() => Promise.resolve('')),
    getVolume: spy(() => Promise.resolve(volume)),
  };
  const system = {
    resolveRoom: spy(() => Promise.resolve(player)),
    playFavorite: spy(() => Promise.resolve('')),
    playPlaylist: spy(() => Promise.resolve('')),
  };
  const spotifyNow = spy(() => Promise.resolve(''));
  const deps = {
    getEngine: spy(() => Promise.resolve(system)),
    spotify: { now: spotifyNow },
  } as unknown as CommandDeps;
  return { deps, player, system, spotifyNow };
}

function captureLogs(): { logs: string[]; restore: () => void } {
  const logs: string[] = [];
  const s = stub(console, 'log', (...args: unknown[]) => void logs.push(args.join(' ')));
  return { logs, restore: () => s.restore() };
}

Deno.test('spotify tag plays via spotify.now after the reset sequence', async () => {
  const { deps, player, system, spotifyNow } = makeDeps();
  const { restore } = captureLogs();
  await process_sonos_command('spotify:track:abc123', deps);
  restore();
  assertSpyCalls(system.resolveRoom as Spy, 1);
  assertSpyCallArgs(player.setRepeat as Spy, 0, ['none']);
  assertSpyCallArgs(player.setShuffle as Spy, 0, [false]);
  assertSpyCallArgs(player.setCrossfade as Spy, 0, [false]);
  assertSpyCalls(player.clearQueue as Spy, 1);
  assertSpyCallArgs(spotifyNow as Spy, 0, [player, system, 'spotify:track:abc123']);
});

Deno.test('favorite tag plays the named favorite', async () => {
  const { deps, player, system } = makeDeps();
  const { restore } = captureLogs();
  await process_sonos_command('favorite:Songs', deps);
  restore();
  assertSpyCalls(player.clearQueue as Spy, 1);
  assertSpyCallArgs(system.playFavorite as Spy, 0, [player, 'Songs']);
});

Deno.test('playlist tag plays the named playlist (URL-decoded)', async () => {
  const { deps, player, system } = makeDeps();
  const { restore } = captureLogs();
  await process_sonos_command('playlist:My%20Mix', deps);
  restore();
  assertSpyCallArgs(system.playPlaylist as Spy, 0, [player, 'My Mix']);
});

Deno.test('command:play calls play and does NOT reset', async () => {
  const { deps, player } = makeDeps();
  const { restore } = captureLogs();
  await process_sonos_command('command:play', deps);
  restore();
  assertSpyCalls(player.play as Spy, 1);
  assertSpyCalls(player.setRepeat as Spy, 0);
  assertSpyCalls(player.clearQueue as Spy, 0);
});

Deno.test('command:volume/40 sets absolute volume', async () => {
  const { deps, player } = makeDeps();
  const { restore } = captureLogs();
  await process_sonos_command('command:volume/40', deps);
  restore();
  assertSpyCallArgs(player.setVolume as Spy, 0, ['40']);
});

Deno.test('command:volume/+5 sets relative volume', async () => {
  const { deps, player } = makeDeps(30);
  const { restore } = captureLogs();
  await process_sonos_command('command:volume/+5', deps);
  restore();
  assertSpyCalls(player.getVolume as Spy, 1);
  assertSpyCallArgs(player.setVolume as Spy, 0, [35]);
});

Deno.test('audible floor: near-muted speaker raised to 10 on a play card', async () => {
  const { deps, player } = makeDeps(3);
  const { restore } = captureLogs();
  await process_sonos_command('spotify:track:x', deps);
  restore();
  assertSpyCallArgs(player.setVolume as Spy, 0, [10]);
});

Deno.test('audible floor: already-audible volume left alone', async () => {
  const { deps, player } = makeDeps(20);
  const { restore } = captureLogs();
  await process_sonos_command('favorite:Songs', deps);
  restore();
  assertSpyCalls(player.setVolume as Spy, 0);
});

Deno.test('room: changes the active room and is honoured next command', async () => {
  const { deps, system } = makeDeps();
  const { logs, restore } = captureLogs();
  await process_sonos_command('room:Kitchen', deps);
  await process_sonos_command('command:play', deps);
  restore();
  assertEquals(logs.some((l) => l.includes('Sonos room changed to Kitchen')), true);
  assertSpyCallArgs(system.resolveRoom as Spy, 0, ['Kitchen']);
});

Deno.test('apple: is reported unsupported with no engine call', async () => {
  const { deps, system } = makeDeps();
  const { logs, restore } = captureLogs();
  await process_sonos_command('apple:12345', deps);
  restore();
  assertEquals(logs.some((l) => l.includes('not supported')), true);
  assertSpyCalls(system.resolveRoom as Spy, 0);
});

Deno.test('unrecognised prefix logs guidance', async () => {
  const { deps, system } = makeDeps();
  const { logs, restore } = captureLogs();
  await process_sonos_command('wat:nope', deps);
  restore();
  assertEquals(logs.some((l) => l.includes('not recognised')), true);
  assertSpyCalls(system.resolveRoom as Spy, 0);
});
