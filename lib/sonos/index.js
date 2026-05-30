// Public facade for the in-house Sonos engine. The jukebox imports only this.
// The engine (discovery + topology) is built once and cached for the process;
// the first NFC tap pays the discovery cost, later taps reuse it.

import { SonosSystem } from './system.js';
import * as spotify from './services/spotify.js';

let enginePromise = null;

// Returns the cached SonosSystem, bootstrapping (discover + topology) on first call.
// `opts.seedIp` skips SSDP discovery and talks to a known player directly.
export function getEngine(opts = {}) {
  if (!enginePromise) {
    enginePromise = new SonosSystem(opts).bootstrap().catch((err) => {
      enginePromise = null; // allow retry on next tap
      throw err;
    });
  }
  return enginePromise;
}

// Test/util hook to drop the cached engine.
export function resetEngine() {
  enginePromise = null;
}

export { spotify, SonosSystem };
