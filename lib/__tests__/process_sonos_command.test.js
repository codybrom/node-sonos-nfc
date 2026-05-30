import process_sonos_command from '../process_sonos_command.js';
import * as engine from '../sonos/index.js';

// Mock the whole engine so these tests exercise routing/dispatch, not the LAN.
jest.mock('../sonos/index.js', () => {
  const player = {
    play: jest.fn(),
    pause: jest.fn(),
    playPause: jest.fn(),
    nextTrack: jest.fn(),
    previousTrack: jest.fn(),
    mute: jest.fn(),
    unMute: jest.fn(),
    clearQueue: jest.fn(),
    setRepeat: jest.fn(),
    setShuffle: jest.fn(),
    setCrossfade: jest.fn(),
    setVolume: jest.fn(),
    getVolume: jest.fn(async () => 30),
  };
  const system = {
    resolveRoom: jest.fn(async () => player),
    playFavorite: jest.fn(),
    playPlaylist: jest.fn(),
    __player: player,
  };
  return {
    getEngine: jest.fn(async () => system),
    spotify: { now: jest.fn() },
    __system: system,
  };
});

const system = engine.__system;
const player = system.__player;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => console.log.mockRestore());

describe('routing', () => {
  test('spotify tag plays via spotify.now after the reset sequence', async () => {
    await process_sonos_command('spotify:track:abc123');
    expect(system.resolveRoom).toHaveBeenCalled();
    expect(player.setRepeat).toHaveBeenCalledWith('none');
    expect(player.setShuffle).toHaveBeenCalledWith(false);
    expect(player.setCrossfade).toHaveBeenCalledWith(false);
    expect(player.clearQueue).toHaveBeenCalled();
    expect(engine.spotify.now).toHaveBeenCalledWith(player, system, 'spotify:track:abc123');
  });

  test('favorite tag plays the named favorite', async () => {
    await process_sonos_command('favorite:Songs');
    expect(player.clearQueue).toHaveBeenCalled();
    expect(system.playFavorite).toHaveBeenCalledWith(player, 'Songs');
  });

  test('playlist tag plays the named playlist (URL-decoded)', async () => {
    await process_sonos_command('playlist:My%20Mix');
    expect(system.playPlaylist).toHaveBeenCalledWith(player, 'My Mix');
  });
});

describe('command passthrough (no reset sequence)', () => {
  test('command:play calls play and does NOT reset', async () => {
    await process_sonos_command('command:play');
    expect(player.play).toHaveBeenCalled();
    expect(player.setRepeat).not.toHaveBeenCalled();
    expect(player.clearQueue).not.toHaveBeenCalled();
  });

  test('command:next', async () => {
    await process_sonos_command('command:next');
    expect(player.nextTrack).toHaveBeenCalled();
  });

  test('command:volume/40 sets absolute volume', async () => {
    await process_sonos_command('command:volume/40');
    expect(player.setVolume).toHaveBeenCalledWith('40');
  });

  test('command:volume/+5 sets relative volume', async () => {
    await process_sonos_command('command:volume/+5');
    expect(player.getVolume).toHaveBeenCalled();
    expect(player.setVolume).toHaveBeenCalledWith(35);
  });

  test('command:repeat/all', async () => {
    await process_sonos_command('command:repeat/all');
    expect(player.setRepeat).toHaveBeenCalledWith('all');
  });

  test('unknown command logs and does nothing', async () => {
    await process_sonos_command('command:frobnicate');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Unsupported command'));
    expect(player.play).not.toHaveBeenCalled();
  });
});

describe('local + unsupported', () => {
  test('room: changes the active room without any engine call', async () => {
    await process_sonos_command('room:Office');
    expect(console.log).toHaveBeenCalledWith('Sonos room changed to Office');
    expect(system.resolveRoom).not.toHaveBeenCalled();
  });

  test('room change is honoured on the next command', async () => {
    await process_sonos_command('room:Kitchen');
    await process_sonos_command('command:play');
    expect(system.resolveRoom).toHaveBeenCalledWith('Kitchen');
  });

  test('apple: is reported unsupported with no engine call', async () => {
    await process_sonos_command('apple:12345');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('not supported'));
    expect(system.resolveRoom).not.toHaveBeenCalled();
  });

  test('unrecognised prefix logs guidance', async () => {
    await process_sonos_command('wat:nope');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('not recognised'));
    expect(system.resolveRoom).not.toHaveBeenCalled();
  });
});

test('engine errors propagate', async () => {
  engine.spotify.now.mockRejectedValueOnce(new Error('boom'));
  await expect(process_sonos_command('spotify:track:x')).rejects.toThrow('boom');
});
