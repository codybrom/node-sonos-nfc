import fs from 'fs';
import { getEngine, spotify } from './sonos/index.js';

let sonos_room, sonos_seed_ip, reset_repeat, reset_shuffle, reset_crossfade;

try {
  var settings = JSON.parse(fs.readFileSync('usersettings.json', 'utf-8'));
  ({ sonos_room, sonos_seed_ip, reset_repeat, reset_shuffle, reset_crossfade } = settings);
} catch (error) {
  if (error.code === 'ENOENT') {
    console.log('usersettings.json not found, using usersettings.json.example as fallback.');
    var settings = JSON.parse(fs.readFileSync('usersettings.json.example', 'utf-8'));
    ({ sonos_room, sonos_seed_ip, reset_repeat, reset_shuffle, reset_crossfade } = settings);
  } else {
    throw error;
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Music services other than Spotify are no longer supported by the in-house
// engine (this build talks to Sonos directly and only ships Spotify "play"
// metadata). Favorites/playlists/transport still work for any service that's
// already set up in the Sonos app.
const UNSUPPORTED_SERVICES = ['apple', 'applemusic', 'bbcsounds', 'tunein', 'amazonmusic', 'http'];

// Map a `command:` verb to a coordinator action. Args follow the verb in the
// tag, slash-separated, e.g. `command:volume/40`, `command:repeat/all`.
async function runCommand(player, payload) {
  const [verb, ...rest] = payload.split('/');
  const arg = rest.join('/');
  switch (verb) {
    case 'play':
      return player.play();
    case 'pause':
      return player.pause();
    case 'playpause':
    case 'toggle':
      return player.playPause();
    case 'next':
      return player.nextTrack();
    case 'previous':
    case 'prev':
      return player.previousTrack();
    case 'mute':
      return player.mute(true);
    case 'unmute':
      return player.unMute();
    case 'clearqueue':
      return player.clearQueue();
    case 'volume': {
      if (/^[+-]/.test(arg)) {
        const current = await player.getVolume();
        return player.setVolume(current + parseInt(arg, 10));
      }
      return player.setVolume(arg);
    }
    case 'repeat':
      return player.setRepeat(arg === 'on' ? 'all' : arg === 'off' ? 'none' : arg);
    case 'shuffle':
      return player.setShuffle(arg === 'on' || arg === 'true');
    case 'crossfade':
      return player.setCrossfade(arg === 'on' || arg === 'true');
    default:
      console.log(`Unsupported command: ${payload}`);
  }
}

export default async function process_sonos_command(received_text) {
  const lower = received_text.toLowerCase();

  // Room change is purely local state — no Sonos call.
  if (lower.startsWith('room:')) {
    sonos_room = received_text.slice(5);
    console.log(`Sonos room changed to ${sonos_room}`);
    return;
  }

  // Classify the tag into a { service, payload }.
  let service, payload;
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
    const prefix = lower.split(':')[0];
    if (UNSUPPORTED_SERVICES.includes(prefix) || lower.startsWith('http')) {
      console.log(
        `'${prefix}' is not supported by this build (Spotify-only). ` +
          'Use a Sonos favorite or playlist instead, or a spotify: tag.'
      );
      return;
    }
    console.log(
      "Service type not recognised. Text should begin 'spotify', 'favorite', " +
        "'playlist', 'command', or 'room'."
    );
    return;
  }

  console.log("Detected '%s' service request", service);

  const system = await getEngine(sonos_seed_ip ? { seedIp: sonos_seed_ip } : {});
  const player = await system.resolveRoom(sonos_room);

  // `command:` is a raw passthrough and skips the pre-play reset sequence.
  if (service === 'command') {
    await runCommand(player, payload);
    return;
  }

  // Reset playback state before queuing new music (mirrors the old behaviour:
  // repeat/off, shuffle/off, crossfade/off, clearqueue, with small spacing so
  // Sonos doesn't coalesce/drop rapid commands).
  if (reset_repeat) {
    console.log('Resetting repeat');
    await player.setRepeat('none');
  }
  await delay(200);
  if (reset_shuffle) {
    console.log('Resetting shuffle');
    await player.setShuffle(false);
  }
  await delay(200);
  if (reset_crossfade) {
    console.log('Resetting crossfade');
    await player.setCrossfade(false);
  }
  await delay(200);
  console.log('Clearing Sonos queue');
  await player.clearQueue();

  if (service === 'spotify') {
    await spotify.now(player, system, payload);
  } else if (service === 'favorite') {
    await system.playFavorite(player, decodeURIComponent(payload));
  } else if (service === 'playlist') {
    await system.playPlaylist(player, decodeURIComponent(payload));
  }

  // Give Sonos a moment before the next tag is processed.
  await delay(200);
}
