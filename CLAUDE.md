# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Tapdeck reads NFC tags from a PC/SC card reader (tested on the ACR122U) and plays the corresponding music on Sonos — tap a tag and the matching Spotify item plays (tapdeck is Spotify-only). It is a single self-contained Deno binary with **no native addons and no runtime dependencies** — the only `imports` in `deno.json` are dev-only (`@std/assert`, `@std/testing`). Both the NFC reader and the Sonos engine are implemented in-project. Keeping dependencies near zero is a core philosophy of this project.

## Commands

```bash
deno task start     # run from source (FFI + net + read perms baked in)
deno task test      # run all tests
deno task compile   # build the self-contained ./tapdeck binary
deno task lint
deno task fmt
deno check index.ts lib/   # type-check (what CI runs)
```

Run a single test file or filter by name:

```bash
deno test --allow-read --allow-net lib/sonos/__tests__/soap_test.ts
deno test --allow-read --allow-net --filter "buildEnvelope"
```

CI (`.github/workflows/ci.yml`) runs, in order: `deno fmt --check`, `deno lint`, `deno check index.ts lib/`, then `deno task test`. Run these locally before pushing. Pushing a `v*` tag triggers `release.yml`, which cross-compiles Linux arm64 + x86_64 binaries and attaches them to a GitHub release.

`deno fmt` config (in `deno.json`) is non-default: 100-col, single quotes, `proseWrap: preserve` (so Markdown is never hard-wrapped). `compilerOptions` enables `strict` **and** `noUncheckedIndexedAccess` — indexing an array yields `T | undefined`, which is why you'll see `!` assertions in the byte-parsing code in `lib/nfc`.

## Runtime permissions

`start`/`compile` bake in: `--allow-ffi` (load libpcsclite for the reader), `--allow-net` (Sonos over LAN), `--allow-read` (config file), `--allow-write` (the `setup` subcommand writes the config), `--allow-run=pm2` (setup's optional autostart registration), and `--allow-env=PCSC_LIB,HOME` (libpcsclite path + locating `~/.tapdeck/config.json`). The permission set is a superset across all subcommands; the reader loop itself doesn't write or spawn, but the single binary serves `setup` too. Tests need `--allow-read --allow-net --allow-env`.

## CLI subcommands

`index.ts` dispatches on `Deno.args[0]` before starting the reader, and **lazily imports** the reader/command modules only on the default path — so `status`/`setup` don't load the FFI layer or trigger `process_sonos_command`'s module-level settings load. `status [ip]` prints the connected IP, rooms (+IPs), and Spotify accounts — the pre-setup diagnostic. `setup [ip]` is interactive (`prompt()`/`confirm()`, so it needs a real TTY — they return null/false when stdin is piped): it picks a room and Spotify account, writes the config, and then offers to register with pm2 (`offerPm2` shells out to `pm2 jlist`/`start`/`save`, using `Deno.execPath()` as the start target). The bare `tapdeck` (reader) path first checks `hasUserConfig()` and, on a fresh install with no real config, runs `setup` instead of starting. Both subcommands take an optional seed-IP arg to skip discovery.

## Architecture

The flow is one line in `index.ts`: `startReader(onTag)` loops forever, and each scanned tag's text is handed to `processSonosCommand`. The two halves — reading tags and driving Sonos — are fully independent and meet only at that callback.

Settings (`lib/settings.ts`) load from, in order: `usersettings.json` in the cwd (dev / beside-the-binary), then `~/.tapdeck/config.json` (where `setup` writes and an installed binary reads); with neither present, defaults apply and the bare-`tapdeck` path runs `setup`. `configFilePath()` is a pure function (takes `HOME`) so it's testable without env access.

### NFC reader (`lib/nfc/`)

- `pcsc.ts` — a hand-written PC/SC (winscard) binding to **libpcsclite via Deno FFI**. This is the part that replaces the old `nfc-pcsc` native addon (nan can't load under Deno). It encodes the pcsc-lite 64-bit Linux ABI directly: `DWORD`/handles are 8 bytes, the `SCARD_READERSTATE` struct is laid out by hand with explicit byte offsets, and blocking calls (`GetStatusChange`, `Connect`, `Transmit`) are declared `nonblocking` so they run off-thread and return Promises. If you touch this file, the offset/size comments are load-bearing — getting them wrong produces silent memory corruption, not errors.
- `reader.ts` — the monitor loop. Waits for a reader to appear, then uses `waitForChange` to detect card insertion, reads NTAG user memory from page 4 via `FF B0` read APDUs until a full NDEF message is assembled, and invokes the callback. Heavy on retries by design: a card passes through transient unpowered/unresponsive states right after landing (`POWERING_UP` set in `pcsc.ts`), so `connectWithRetry` retries ~3.6s, and the whole read is retried up to 3× because cards power up slowly or shift mid-read. Don't "simplify" the retries away — they're fixes for real flakiness (see commits 9a5fb74, 4773c86, 4ec7091).
- `ndef.ts` — minimal NDEF parsing, only the Text (`T`) and URI (`U`) records the jukebox uses. `extractNdefMessage` walks the TLV-framed tag memory for the NDEF TLV (0x03) and returns `null` when the message isn't fully read yet, which is the signal `reader.ts` uses to read another chunk.

### Sonos engine (`lib/sonos/`)

A small, dependency-free UPnP/SOAP client. `index.ts` is the only entry point the rest of the app imports; it lazily builds and **caches one `SonosSystem` per process** (`getEngine`) — the first tap pays the discovery cost, later taps reuse it. On bootstrap failure the cache is cleared so the next tap retries.

- `discovery.ts` — SSDP multicast (`node:dgram`) to find any one ZonePlayer. Requires being on the same L2 network as the speakers; `sonos_seed_ip` in settings skips this entirely.
- `system.ts` — owns discovery bootstrap, topology, the Spotify service-id lookup, and Spotify-account discovery. `refreshTopology` parses `GetZoneGroupState` into a `room name (lowercased) → group coordinator` map; `resolveRoom` returns the coordinator `Player` and refreshes topology once on a miss. `getSpotifyAccounts` mines favorites (`FV:2`, household-wide) and each room's queue (`Q:0`, per-coordinator) via ContentDirectory `Browse` to recover the linked Spotify accounts' serial numbers, for `status`/`setup`; `getFavorites` is kept solely for that.
- `player.ts` — a coordinator you send transport/rendering SOAP actions to. Note Sonos packs repeat+shuffle into one combined `PlayMode` string, so `setRepeat`/`setShuffle` read the current mode first and flip only their own dimension (`PLAYMODE` map).
- `services/spotify.ts` — turns a `spotify:track|album|playlist:ID` URI into the Sonos-native `x-sonos-spotify:`/`x-rincon-cpcontainer:` URI plus DIDL metadata, then runs the play-now queue sequence. **tapdeck plays Spotify only** — there is no favorites/playlists path; `spotify_account_sn` selects which linked Spotify account.
- `soap.ts` / `xml.ts` — SOAP transport over the runtime's built-in `fetch`, and small, dependency-free XML helpers (no XML library). Tag/attr extraction is regex-based; `encodeEntities`/`decodeEntities` hand-roll the five XML entities plus all numeric (decimal & hex) character references. `decodeEntities` may need to run **twice**: Sonos double-encodes nested DIDL (e.g. a Browse `<Result>` or a favorite's `<r:resMD>`).

### Tag command dispatch (`lib/process_sonos_command.ts`)

Classifies tag text by prefix — `spotify:`, `command:`, `room:` — and routes it; tapdeck is Spotify-only, so any other prefix is rejected with a message. `room:` is pure local state (no Sonos call). `command:` is a raw transport passthrough (`play`, `pause`, `volume/40`, `volume/+5`, `repeat/all`, `shuffle/on`, …) that skips the pre-play reset. A `spotify:` tag runs a best-effort pre-play reset (repeat/shuffle/crossfade off — on by default, opt out in config — plus clear queue), each step wrapped in `tryReset` so a Sonos rejection is logged and skipped rather than aborting playback, then bumps a near-muted speaker to an audible floor before enqueuing via `spotify.now`.

Settings are read once at module load. Defaults for the reset flags, `min_volume`, and `spotify_account_sn` live in the code, so tapdeck runs with no config at all; `usersettings.json` is gitignored, and `tapdeck setup` writes `~/.tapdeck/config.json`.

### Testing conventions

Tests live in `__tests__/` dirs next to the code, named `*_test.ts`, using `Deno.test` + `@std/assert`. The engine is **dependency-injected** into `process_sonos_command` (the `CommandDeps` parameter, defaulting to the real `getEngine`/`spotify`) so command-dispatch logic is tested with fakes — there's no module-mocking framework. Tests cover pure logic (NDEF parsing, XML helpers, SOAP body building, Spotify URI construction, command routing); the FFI reader and live network calls are not unit-tested.
