// User configuration. Loaded from a usersettings.json in the current directory
// (dev / beside-the-binary), else ~/.tapdeck/config.json. `setup` writes the
// latter, so the binary itself can live anywhere (e.g. /usr/local/bin) without a
// config file beside it; run `tapdeck setup` to create one.

export interface Settings {
  sonos_room?: string;
  sonos_seed_ip?: string;
  reset_repeat?: boolean;
  reset_shuffle?: boolean;
  reset_crossfade?: boolean;
  min_volume?: number;
  spotify_account_sn?: number;
}

// The per-user config file: ~/.tapdeck/config.json. Pure (takes HOME) so it's
// testable without env access; null when HOME is unset.
export function configFilePath(home: string | undefined): string | null {
  return home ? `${home}/.tapdeck/config.json` : null;
}

export function userConfigPath(): string | null {
  return configFilePath(Deno.env.get('HOME') ?? undefined);
}

// Where the config may live, in priority order: a usersettings.json in the cwd,
// then ~/.tapdeck/config.json. Single source of truth for both lookups below.
function configCandidatePaths(): string[] {
  const userPath = userConfigPath();
  return ['usersettings.json', ...(userPath ? [userPath] : [])];
}

// True if the user has a real config — so a fresh install can detect first run
// and offer `setup`.
export function hasUserConfig(): boolean {
  for (const file of configCandidatePaths()) {
    try {
      Deno.statSync(file);
      return true;
    } catch {
      // not there — keep looking
    }
  }
  return false;
}

function tryReadJson(path: string): Settings | undefined {
  try {
    return JSON.parse(Deno.readTextFileSync(path));
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return undefined;
    throw err;
  }
}

// The single source of truth for every default. Defaults live here — not in a
// config file, and not duplicated at the call sites — so `setup` writes from
// these and the reader resolves against them, and the value for, say,
// min_volume exists in exactly one place.
export const DEFAULT_SETTINGS: Required<Settings> = {
  sonos_room: 'Living Room',
  sonos_seed_ip: '',
  reset_repeat: true,
  reset_shuffle: true,
  reset_crossfade: true,
  min_volume: 10,
  spotify_account_sn: 1,
};

// Fill in defaults and coerce out-of-range values, so callers get a fully
// resolved config and never have to apply their own `?? default` /
// `Number.isFinite` checks. Pure (takes the raw settings) so it's testable
// without touching the disk.
export function resolveSettings(raw: Settings): Required<Settings> {
  return {
    sonos_room: raw.sonos_room?.trim() || DEFAULT_SETTINGS.sonos_room,
    sonos_seed_ip: typeof raw.sonos_seed_ip === 'string'
      ? raw.sonos_seed_ip
      : DEFAULT_SETTINGS.sonos_seed_ip,
    reset_repeat: raw.reset_repeat ?? DEFAULT_SETTINGS.reset_repeat,
    reset_shuffle: raw.reset_shuffle ?? DEFAULT_SETTINGS.reset_shuffle,
    reset_crossfade: raw.reset_crossfade ?? DEFAULT_SETTINGS.reset_crossfade,
    min_volume: Number.isFinite(raw.min_volume) ? raw.min_volume! : DEFAULT_SETTINGS.min_volume,
    spotify_account_sn: Number.isInteger(raw.spotify_account_sn) && raw.spotify_account_sn! >= 1
      ? raw.spotify_account_sn!
      : DEFAULT_SETTINGS.spotify_account_sn,
  };
}

function loadRawSettings(): Settings {
  for (const file of configCandidatePaths()) {
    const found = tryReadJson(file);
    if (found) return found;
  }
  return {};
}

// The user config with all defaults applied and values coerced — the only shape
// the rest of the app sees.
export function loadSettings(): Required<Settings> {
  return resolveSettings(loadRawSettings());
}
