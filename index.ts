// tapdeck entry point: read NFC tags and drive Sonos.
// The FFI reader (lib/nfc) replaces nfc-pcsc; the Sonos engine (lib/sonos)
// talks to the speakers directly over the LAN.

import { getEngine } from './lib/sonos/index.ts';
import type { SonosSystem } from './lib/sonos/index.ts';
import {
  DEFAULT_SETTINGS,
  hasUserConfig,
  loadSettings,
  type Settings,
  userConfigPath,
} from './lib/settings.ts';
import { offerPm2 } from './lib/pm2.ts';

// A seed IP for the status/setup subcommands: an explicit `<ip>` arg wins,
// otherwise fall back to the configured one. Lazy so the reader path never
// triggers it.
const seedArg = () => Deno.args[1] ?? loadSettings().sonos_seed_ip;

// `tapdeck status [ip]` — the one call to run before (or while) configuring.
// It finds your system and prints everything the config needs: the rooms you can
// target, their IPs (proof the network works + a seed_ip candidate), and the
// Spotify accounts in use. Anything else falls through to the reader.
if (Deno.args[0] === 'status') {
  await printStatus(seedArg());
  Deno.exit(0);
}

// `tapdeck setup [ip]` — interactively discover the system, ask which room and
// Spotify account to use, and write the config to the standard per-user
// location, then exit.
if (Deno.args[0] === 'setup') {
  await runSetup(seedArg());
  Deno.exit(0);
}

// First run with no config — guide the user straight into setup instead of
// silently falling back to defaults.
if (!hasUserConfig()) {
  console.log("No tapdeck config found yet. Let's set one up.\n");
  await runSetup(undefined);
  Deno.exit(0);
}

// Default: run the reader loop. Imported lazily so the status/setup subcommands
// don't pull in the FFI reader or trigger the command module's settings load.
const { startReader } = await import('./lib/nfc/reader.ts');
const { default: processSonosCommand } = await import(
  './lib/process_sonos_command.ts'
);
// The reader loop already aggregates callback failures (logs and continues to
// the next tap), so no try/catch is needed here.
await startReader((text) => processSonosCommand(text));

// Print a numbered menu and read the user's choice (1-based). Returns the chosen
// item, or null on an out-of-range / non-numeric / non-TTY answer.
function chooseFromList<T>(items: T[], render: (item: T) => string): T | null {
  items.forEach((item, i) => console.log(`  ${i + 1}) ${render(item)}`));
  const idx = Number(prompt(`Enter a number [1-${items.length}]:`)) - 1;
  return items[idx] ?? null;
}

// Connect to the Sonos system for a CLI subcommand, or exit with guidance.
async function connect(seedIp: string | undefined, cmd: string): Promise<SonosSystem> {
  try {
    return await getEngine(seedIp ? { seedIp } : {});
  } catch (err) {
    console.error(`Could not reach your Sonos system: ${(err as Error).message}`);
    console.error(
      'Make sure this machine is on the same network as your speakers. If ' +
        `discovery is blocked, pass a player IP: tapdeck ${cmd} <ip>`,
    );
    Deno.exit(1);
  }
}

async function printStatus(seedIp?: string): Promise<void> {
  const system = await connect(seedIp, 'status');

  console.log(`Connected to Sonos at ${system.connectedIp}`);
  console.log(
    '  (if auto-discovery ever fails, set this as "sonos_seed_ip" in usersettings.json)\n',
  );

  const rooms = system.listRooms();
  console.log('Rooms — set "sonos_room" to the one your cards should control:');
  for (const { name, ip } of rooms) {
    console.log(`  ${name.padEnd(20)} ${ip}`);
  }

  const accounts = await system.getSpotifyAccounts();
  console.log('\nSpotify accounts — set "spotify_account_sn" to the one you want:');
  if (accounts.length === 0) {
    console.log(
      '  none found in your favorites or queues. With a single linked account ' +
        'the default of 1 is usually right; otherwise play a Spotify track and re-run.',
    );
  } else {
    for (const { token, sn, examples } of accounts) {
      const label = sn === null
        ? 'unknown (play a track from this account, then re-run)'
        : String(sn);
      console.log(`  spotify_account_sn: ${label}${token ? ` [token ${token}]` : ''}`);
      for (const title of examples) console.log(`      • ${title}`);
    }
  }
}

async function runSetup(seedIp?: string): Promise<void> {
  const system = await connect(seedIp, 'setup');
  console.log(`Connected to Sonos at ${system.connectedIp}\n`);

  // Pick a room.
  const rooms = system.listRooms();
  if (rooms.length === 0) {
    console.error('No rooms found. Is this the right network?');
    Deno.exit(1);
  }
  console.log('Which room should your cards control?');
  const room = chooseFromList(rooms, (r) => `${r.name}  (${r.ip})`);
  if (!room) {
    console.error('Not a valid choice; nothing written.');
    Deno.exit(1);
  }

  // Pick a Spotify account (default 1 when none is discoverable).
  const known = (await system.getSpotifyAccounts()).filter((a) => a.sn !== null);
  let accountSn = 1;
  if (known.length === 1) {
    accountSn = known[0]!.sn!;
    console.log(`\nUsing Spotify account spotify_account_sn=${accountSn}.`);
  } else if (known.length > 1) {
    console.log('\nWhich Spotify account?');
    const chosen = chooseFromList(known, (a) => `sn=${a.sn}  (e.g. ${a.examples[0] ?? '—'})`);
    accountSn = chosen?.sn ?? 1;
  } else {
    console.log('\nNo Spotify account detected; defaulting spotify_account_sn=1.');
  }

  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    sonos_room: room.name,
    spotify_account_sn: accountSn,
  };

  const path = userConfigPath() ?? 'usersettings.json';
  const slash = path.lastIndexOf('/');
  if (slash > 0) await Deno.mkdir(path.slice(0, slash), { recursive: true });
  await Deno.writeTextFile(path, JSON.stringify(settings, null, 2) + '\n');
  console.log(`\nWrote ${path}`);

  await offerPm2();
  console.log('\nRun tapdeck (no arguments) to start reading cards.');
}
