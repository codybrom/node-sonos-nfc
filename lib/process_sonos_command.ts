import { getEngine, spotify } from './sonos/index.ts';
import type { Player } from './sonos/player.ts';
import { loadSettings } from './settings.ts';

// loadSettings has already applied every default and coerced every value, so
// these are final. sonos_room is reassignable via a `room:` tag, hence `let`.
let {
  sonos_room,
  sonos_seed_ip,
  reset_repeat,
  reset_shuffle,
  reset_crossfade,
  min_volume,
  spotify_account_sn,
} = loadSettings();

// If a music card is scanned while the speaker is basically muted, raise it to
// min_volume so the card is actually audible. SILENT_VOLUME is the "is it
// muted?" trigger — not configurable; min_volume is the floor we raise to.
const SILENT_VOLUME = 5;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Run a best-effort pre-play reset step; log and continue if Sonos rejects it
// (e.g. crossfade/repeat aren't valid for the current source).
async function tryReset(
  label: string,
  fn: () => Promise<unknown>,
): Promise<void> {
  console.log(`Resetting ${label}`);
  try {
    await fn();
  } catch (err) {
    console.log(`  (${label} reset skipped: ${(err as Error).message})`);
  }
}

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

export default async function processSonosCommand(
  receivedText: string,
  deps: CommandDeps = { getEngine, spotify },
): Promise<void> {
  const lower = receivedText.toLowerCase();

  // Room change is purely local state — no Sonos call.
  if (lower.startsWith('room:')) {
    sonos_room = receivedText.slice(5);
    console.log(`Sonos room changed to ${sonos_room}`);
    return;
  }

  // Only Spotify URIs, command:, and room: tags are supported.
  const isCommand = lower.startsWith('command:');
  if (!isCommand && !lower.startsWith('spotify:')) {
    console.log(
      'Tag not recognized. ' +
        "Text should begin 'spotify:', 'command:', or 'room:'.",
    );
    return;
  }

  const system = await deps.getEngine(
    sonos_seed_ip ? { seedIp: sonos_seed_ip } : {},
  );
  const player = await system.resolveRoom(sonos_room);

  // `command:` is a raw passthrough and skips the pre-play reset sequence.
  if (isCommand) {
    await runCommand(player, receivedText.slice(8));
    return;
  }

  console.log('Detected Spotify request');

  // Reset playback state before queuing new music (best-effort cleanup of the
  // *outgoing* source — e.g. crossfade can't be set on the current source / UPnP
  // 712 — so a failure is logged and we continue to load the new track).
  if (reset_repeat) await tryReset('repeat', () => player.setRepeat('none'));
  await delay(200);
  if (reset_shuffle) await tryReset('shuffle', () => player.setShuffle(false));
  await delay(200);
  if (reset_crossfade) {
    await tryReset('crossfade', () => player.setCrossfade(false));
  }
  await delay(200);
  await tryReset('clearqueue', () => player.clearQueue());

  // Don't let a near-muted speaker silently "play" — bump it to an audible floor.
  try {
    const currentVolume = await player.getVolume();
    if (currentVolume < SILENT_VOLUME) {
      console.log(
        `Volume was ${currentVolume}; raising to ${min_volume} so the card is audible`,
      );
      await player.setVolume(min_volume);
    }
  } catch (err) {
    console.log(`  (volume check skipped: ${(err as Error).message})`);
  }

  await deps.spotify.now(player, system, receivedText, spotify_account_sn);

  // Give Sonos a moment before the next tag is processed.
  await delay(200);
}
