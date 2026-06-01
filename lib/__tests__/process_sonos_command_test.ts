import { assertEquals } from '@std/assert';
import { assertSpyCallArgs, assertSpyCalls, type Spy, spy, stub } from '@std/testing/mock';
import processSonosCommand, { type CommandDeps } from '../process_sonos_command.ts';

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
  const s = stub(
    console,
    'log',
    (...args: unknown[]) => void logs.push(args.join(' ')),
  );
  return { logs, restore: () => s.restore() };
}

Deno.test(
  'spotify tag plays via spotify.now after the reset sequence',
  async () => {
    const { deps, player, system, spotifyNow } = makeDeps();
    const { restore } = captureLogs();
    await processSonosCommand('spotify:track:abc123', deps);
    restore();
    assertSpyCalls(system.resolveRoom as Spy, 1);
    assertSpyCallArgs(player.setRepeat as Spy, 0, ['none']);
    assertSpyCallArgs(player.setShuffle as Spy, 0, [false]);
    assertSpyCallArgs(player.setCrossfade as Spy, 0, [false]);
    assertSpyCalls(player.clearQueue as Spy, 1);
    assertSpyCallArgs(spotifyNow as Spy, 0, [
      player,
      system,
      'spotify:track:abc123',
      1, // default Spotify account serial number
    ]);
  },
);

Deno.test('command:play calls play and does NOT reset', async () => {
  const { deps, player } = makeDeps();
  const { restore } = captureLogs();
  await processSonosCommand('command:play', deps);
  restore();
  assertSpyCalls(player.play as Spy, 1);
  assertSpyCalls(player.setRepeat as Spy, 0);
  assertSpyCalls(player.clearQueue as Spy, 0);
});

Deno.test('command:volume/40 sets absolute volume', async () => {
  const { deps, player } = makeDeps();
  const { restore } = captureLogs();
  await processSonosCommand('command:volume/40', deps);
  restore();
  assertSpyCallArgs(player.setVolume as Spy, 0, ['40']);
});

Deno.test('command:volume/+5 sets relative volume', async () => {
  const { deps, player } = makeDeps(30);
  const { restore } = captureLogs();
  await processSonosCommand('command:volume/+5', deps);
  restore();
  assertSpyCalls(player.getVolume as Spy, 1);
  assertSpyCallArgs(player.setVolume as Spy, 0, [35]);
});

Deno.test(
  'audible floor: near-muted speaker raised to 10 on a play card',
  async () => {
    const { deps, player } = makeDeps(3);
    const { restore } = captureLogs();
    await processSonosCommand('spotify:track:x', deps);
    restore();
    assertSpyCallArgs(player.setVolume as Spy, 0, [10]);
  },
);

Deno.test('audible floor: already-audible volume left alone', async () => {
  const { deps, player } = makeDeps(20);
  const { restore } = captureLogs();
  await processSonosCommand('spotify:track:y', deps);
  restore();
  assertSpyCalls(player.setVolume as Spy, 0);
});

Deno.test(
  'room: changes the active room and is honoured next command',
  async () => {
    const { deps, system } = makeDeps();
    const { logs, restore } = captureLogs();
    await processSonosCommand('room:Kitchen', deps);
    await processSonosCommand('command:play', deps);
    restore();
    assertEquals(
      logs.some((l) => l.includes('Sonos room changed to Kitchen')),
      true,
    );
    assertSpyCallArgs(system.resolveRoom as Spy, 0, ['Kitchen']);
  },
);

Deno.test('a non-Spotify service tag is rejected with no engine call', async () => {
  const { deps, system } = makeDeps();
  const { logs, restore } = captureLogs();
  await processSonosCommand('apple:12345', deps);
  restore();
  assertEquals(
    logs.some((l) => l.includes('not recognized')),
    true,
  );
  assertSpyCalls(system.resolveRoom as Spy, 0);
});

Deno.test('unrecognized prefix logs guidance', async () => {
  const { deps, system } = makeDeps();
  const { logs, restore } = captureLogs();
  await processSonosCommand('wat:nope', deps);
  restore();
  assertEquals(
    logs.some((l) => l.includes('not recognized')),
    true,
  );
  assertSpyCalls(system.resolveRoom as Spy, 0);
});
