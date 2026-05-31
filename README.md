[![CI](https://github.com/codybrom/tapdeck/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/codybrom/tapdeck/actions/workflows/ci.yml)

# tapdeck

Tap an NFC tag to play Spotify, a Sonos favorite, or a playlist on your Sonos — like dropping a
record on a deck. tapdeck ships as a **single self-contained binary**: it reads an NFC card reader
and talks to Sonos **directly over your LAN** (UPnP/SOAP). No cloud, no API server, no credentials,
no runtime to install.

## About

Stick an NTAG sticker on a card (or anything else), program it with a Spotify URI, a Sonos favorite
or playlist, or a transport command, and tap it on a cheap PC/SC reader to play. There's a nice
aesthetic to controlling streaming with physical media, and making the cards is a fun project —
NTAG213 stickers run under $15 for 50. (It's a hit with kids at least as young as 4.)

tapdeck is tested with the **ACR122U**, an inexpensive and widely available reader. The ACR122U
isn't great for general NFC, but it's a solid PC/SC smart-card reader — which is all tapdeck needs.
It should work with any PC/SC-compatible reader.

## Thanks

tapdeck started as a fork of Ryan Olf's [node-sonos-nfc](https://github.com/ryanolf/node-sonos-nfc)
— **thank you, Ryan**, for the original version that got this rolling. It has since been rewritten
from the ground up: it reads the card reader directly via FFI (no native addon) and drives Sonos
with an in-house, zero-dependency UPnP engine instead of an external HTTP API. The original
tap-a-card-to-play idea comes from
[Sonos Vinyl Emulator](https://github.com/hankhank10/vinylemulator) by hankhank10.

## What you need

- A **PC/SC card reader** (e.g. an ACR122U) plugged into a computer on the same network as your
  Sonos. Any always-on machine works; a Raspberry Pi is a popular choice.
- **NFC tags** — NTAG213 stickers are cheap and plentiful.

# Install

## 1. Set up the card reader (Linux)

Install the reader driver, the PC/SC library, and the PC/SC daemon. On Ubuntu/Debian/Raspberry Pi
OS:

```
$ sudo apt install libacsccid1 libpcsclite1 pcscd
```

Linux may try to grab the ACR122U with its kernel NFC modules — stop that by blacklisting them, then
reboot:

```
$ printf '%s\n' 'pn533' 'pn533_usb' 'nfc' | sudo tee /etc/modprobe.d/blacklist-nfc.conf
$ sudo reboot
```

## 2. Get tapdeck

Download the binary for your platform from the
[Releases](https://github.com/codybrom/tapdeck/releases) page and make it executable:

```
$ chmod +x tapdeck
```

(Or build it yourself — see [Development](#development).) The binary is fully self-contained: it
loads `libpcsclite` at runtime and talks to Sonos over the LAN. Nothing else to install.

## 3. Configure

Put a `usersettings.json` next to the binary (copy
[`usersettings.json.example`](usersettings.json.example)) and set `sonos_room` to the room you want
to control:

```json
{
  "sonos_room": "Living Room",
  "sonos_seed_ip": "",
  "reset_repeat": true,
  "reset_shuffle": true,
  "reset_crossfade": true,
  "min_volume": 10
}
```

| Setting                                              | Purpose                                                                                                                                |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `sonos_room`                                         | The Sonos room tags control (case-insensitive).                                                                                        |
| `sonos_seed_ip`                                      | Optional. IP of any one Sonos player, to skip multicast discovery if it's blocked on your network.                                     |
| `reset_repeat` / `reset_shuffle` / `reset_crossfade` | Reset these before queuing new music (default `true`).                                                                                 |
| `min_volume`                                         | If a music card is tapped while the speaker is near-muted (volume < 5), raise it to this so a tap never plays silently (default `10`). |

## 4. Run

```
$ ./tapdeck
```

It needs to be on the same LAN as your speakers (it uses UDP multicast to discover them).

# Supported tags

| Tag text                                                     | Action                                                                                                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `spotify:track:…` / `spotify:album:…` / `spotify:playlist:…` | Play that Spotify item.                                                                                                                          |
| `favorite:<name>`                                            | Play a Sonos favorite (works for any service set up in the Sonos app).                                                                           |
| `playlist:<name>`                                            | Play a Sonos playlist.                                                                                                                           |
| `command:<x>`                                                | Raw transport: `play`, `pause`, `next`, `previous`, `volume/40`, `volume/+5`, `repeat/all`, `shuffle/on`, `crossfade/off`, `mute`, `clearqueue`. |
| `room:<name>`                                                | Switch the active room.                                                                                                                          |

Other music services (Apple/Amazon/TuneIn/BBC) aren't built in — save them as Sonos favorites and
use `favorite:` instead.

# Run at boot

Run tapdeck under a process supervisor so it starts on boot and restarts if it exits. With
[pm2](https://pm2.keymetrics.io/):

```
$ pm2 start ./tapdeck --name tapdeck
$ pm2 save
$ pm2 startup   # follow the printed instructions to enable boot startup
```

(systemd works just as well — point a unit at the binary.)

# Programming cards

Cards hold an NDEF message; tapdeck reads the first **text** or **URI** record and uses it as the
tag text (see [Supported tags](#supported-tags)). This is compatible with
[Sonos Vinyl Emulator](https://github.com/hankhank10/vinylemulator)'s card format.

The easiest way to write cards is a phone app like
[NFC Tools](https://www.wakdev.com/en/apps/nfc-tools-pc-mac.html) (iOS/Android) — write a single
text or URI record containing e.g. `spotify:album:…` or `favorite:Coffee House`. Make sure the tag
is formatted for NDEF first (e.g. with NXP TagWriter) if it's brand new.

# Development

tapdeck is written in TypeScript and runs on [Deno](https://deno.com) — only needed to build or hack
on it, not to run a release binary.

```
$ deno task start     # run from source
$ deno task test      # run the test suite
$ deno task lint      # lint
$ deno task fmt       # format
$ deno task compile   # build the self-contained ./tapdeck binary
```

The NFC reader (`lib/nfc`) talks to `libpcsclite` directly via Deno's FFI — no native addon to
compile. The Sonos engine (`lib/sonos`) is a small, dependency-free UPnP/SOAP client. Running from
source needs three permissions, all wired into the `start` task: `--allow-ffi` (the reader),
`--allow-net` (Sonos), and `--allow-read` (your `usersettings.json`).
