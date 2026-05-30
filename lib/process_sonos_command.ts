import { getEngine, spotify } from './sonos/index.ts';
import type { Player } from './sonos/player.ts';

interface Settings {
  sonos_room?: string;
  sonos_seed_ip?: string;
  reset_repeat?: boolean;
  reset_shuffle?: boolean;
  reset_crossfade?: boolean;
  min_volume?: number;
}

function loadSettings(): Settings {
  for (const file of ['usersettings.json', 'usersettings.json.example']) {
    try {
      return JSON.parse(Deno.readTextFileSync(file));
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        if (file === 'usersettings.json') {
          console.log('usersettings.json not found, using usersettings.json.example as fallback.');
        }
        continue;
      }
      throw err;
    }
  }
  return {};
}

let { sonos_room, sonos_seed_ip, reset_repeat, reset_shuffle, reset_crossfade, min_volume } =
  loadSettings();

// If a music card is scanned while the speaker is basically muted, raise it so
// the card is actually audible. SILENT_VOLUME is the "is it muted?" trigger;
// MIN_VOLUME (configurable) is the floor we raise to.
const SILENT_VOLUME = 5;
const MIN_VOLUME = Number.isFinite(min_volume) ? (min_volume as number) : 10;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Run a best-effort pre-play reset step; log and continue if Sonos rejects it
// (e.g. crossfade/repeat aren't valid for the current source).
async function tryReset(label: string, fn: () => Promise<unknown>): Promise<void> {
  console.log(`Resetting ${label}`);
  try {
    await fn();
  } catch (err) {
    console.log(`  (${label} reset skipped: ${(err as Error).message})`);
  }
}

// Music services other than Spotify are no longer supported by the in-house
// engine. Favorites/playlists/transport still work for any service that's
// already set up in the Sonos app.
const UNSUPPORTED_SERVICES = ['apple', 'applemusic', 'bbcsounds', 'tunein', 'amazonmusic', 'http'];

// Map a `command:` verb to a coordinator action. Args follow the verb in the
// tag, slash-separated, e.g. `command:volume/40`, `command:repeat/all`.
async function runCommand(player: Player, payload: string): Promise<void> {
  const [verb, ...rest] = payload.split('/');
  const arg = rest.join('/');
  switch (verb) {
    case 'play':
      await player.play();
      return;
    case 'pause':
      await player.pause();
      return;
    case 'playpause':
    case 'toggle':
      await player.playPause();
      return;
    case 'next':
      await player.nextTrack();
      return;
    case 'previous':
    case 'prev':
      await player.previousTrack();
      return;
    case 'mute':
      await player.mute(true);
      return;
    case 'unmute':
      await player.unMute();
      return;
    case 'clearqueue':
      await player.clearQueue();
      return;
    case 'volume': {
      if (/^[+-]/.test(arg)) {
        const current = await player.getVolume();
        await player.setVolume(current + parseInt(arg, 10));
      } else {
        await player.setVolume(arg);
      }
      return;
    }
    case 'repeat':
      await player.setRepeat(
        arg === 'on' ? 'all' : arg === 'off' ? 'none' : (arg as 'all' | 'one'),
      );
      return;
    case 'shuffle':
      await player.setShuffle(arg === 'on' || arg === 'true');
      return;
    case 'crossfade':
      await player.setCrossfade(arg === 'on' || arg === 'true');
      return;
    default:
      console.log(`Unsupported command: ${payload}`);
  }
}

// The engine is injected (defaulting to the real one) so tests can supply fakes
// without a module-mocking framework.
export interface CommandDeps {
  getEngine: typeof getEngine;
  spotify: Pick<typeof spotify, 'now'>;
}

export default async function process_sonos_command(
  received_text: string,
  deps: CommandDeps = { getEngine, spotify },
): Promise<void> {
  const lower = received_text.toLowerCase();

  // Room change is purely local state — no Sonos call.
  if (lower.startsWith('room:')) {
    sonos_room = received_text.slice(5);
    console.log(`Sonos room changed to ${sonos_room}`);
    return;
  }

  // Classify the tag into a { service, payload }.
  let service: string | undefined;
  let payload = '';
  if (lower.startsWith('spotify:')) {
    service = 'spotify';
    payload = received_text; // full spotify: URI
  } else if (lower.startsWith('favorite:')) {
    service = 'favorite';
    payload = received_text.slice(9);
  } else if (lower.startsWith('playlist:')) {
    service = 'playlist';
    payload = received_text.slice(9);
  } else if (lower.startsWith('command:')) {
    service = 'command';
    payload = received_text.slice(8);
  } else {
    const prefix = lower.split(':')[0] ?? '';
    if (UNSUPPORTED_SERVICES.includes(prefix) || lower.startsWith('http')) {
      console.log(
        `'${prefix}' is not supported by this build (Spotify-only). ` +
          'Use a Sonos favorite or playlist instead, or a spotify: tag.',
      );
      return;
    }
    console.log(
      "Service type not recognised. Text should begin 'spotify', 'favorite', " +
        "'playlist', 'command', or 'room'.",
    );
    return;
  }

  console.log("Detected '%s' service request", service);

  const system = await deps.getEngine(sonos_seed_ip ? { seedIp: sonos_seed_ip } : {});
  const player = await system.resolveRoom(sonos_room ?? 'Living Room');

  // `command:` is a raw passthrough and skips the pre-play reset sequence.
  if (service === 'command') {
    await runCommand(player, payload);
    return;
  }

  // Reset playback state before queuing new music (best-effort cleanup of the
  // *outgoing* source — e.g. crossfade can't be set on a radio stream / UPnP
  // 712 — so a failure is logged and we continue to load the new track).
  if (reset_repeat) await tryReset('repeat', () => player.setRepeat('none'));
  await delay(200);
  if (reset_shuffle) await tryReset('shuffle', () => player.setShuffle(false));
  await delay(200);
  if (reset_crossfade) await tryReset('crossfade', () => player.setCrossfade(false));
  await delay(200);
  await tryReset('clearqueue', () => player.clearQueue());

  // Don't let a near-muted speaker silently "play" — bump it to an audible floor.
  try {
    const currentVolume = await player.getVolume();
    if (currentVolume < SILENT_VOLUME) {
      console.log(`Volume was ${currentVolume}; raising to ${MIN_VOLUME} so the card is audible`);
      await player.setVolume(MIN_VOLUME);
    }
  } catch (err) {
    console.log(`  (volume check skipped: ${(err as Error).message})`);
  }

  if (service === 'spotify') {
    await deps.spotify.now(player, system, payload);
  } else if (service === 'favorite') {
    await system.playFavorite(player, decodeURIComponent(payload));
  } else if (service === 'playlist') {
    await system.playPlaylist(player, decodeURIComponent(payload));
  }

  // Give Sonos a moment before the next tag is processed.
  await delay(200);
}
