[![CI](https://github.com/codybrom/tapdeck/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/codybrom/tapdeck/actions/workflows/ci.yml)

# tapdeck

tapdeck lets you tap an NFC tag to play Spotify, a Sonos favorite, or a playlist on your Sonos — like dropping a record on a deck. Stick a cheap NFC sticker on a card (or a coaster, or a printed photo, or really anything), program it with what you want to hear, and tap it on a card reader to play. It ships as a single self-contained binary that reads your NFC reader and talks to your Sonos speakers directly over the local network, so there's no cloud service, no separate API server to babysit, no account credentials to configure, and no runtime to install.

## About

There's a genuinely nice aesthetic to controlling a streaming service with physical media, and honestly making the cards is half the fun — NTAG213 stickers run well under $15 for fifty, so you can make a big stack of them and decorate them however you like. It's also a hit with kids: little ones who can't read yet can absolutely learn that tapping the dinosaur card plays the dinosaur songs.

tapdeck is tested with the ACR122U, an inexpensive and widely available USB reader. The ACR122U has a bit of a reputation for being awkward with general-purpose NFC libraries, but it's a perfectly good PC/SC smart-card reader, and PC/SC is all tapdeck needs — so it works reliably here, and should work with any other PC/SC-compatible reader too.

## Thanks

tapdeck began life as a fork of Ryan Olf's [node-sonos-nfc](https://github.com/ryanolf/node-sonos-nfc), and a big thank-you goes to Ryan for the original version that got this whole thing rolling. It has since been rewritten from the ground up: where the original leaned on a native Node addon to read the card reader and an external HTTP API to control Sonos, tapdeck now reads the reader directly through `libpcsclite` via FFI with no native addon at all, and drives Sonos with its own small, dependency-free UPnP engine. The original tap-a-card-to-play idea traces back to hankhank10's [Sonos Vinyl Emulator](https://github.com/hankhank10/vinylemulator), which is well worth a look.

## What you'll need

You'll need a PC/SC card reader — an ACR122U is the safe bet — plugged into any always-on computer that sits on the same network as your Sonos. People often use a Raspberry Pi for this, but any spare machine will do. You'll also want a handful of NFC tags; the cheap NTAG213 stickers are perfect.

# Installing

## Setting up the reader

On a Linux box (Ubuntu, Debian, or Raspberry Pi OS), install the reader driver along with the PC/SC library and daemon:

```
$ sudo apt install libacsccid1 libpcsclite1 pcscd
```

Linux will sometimes try to claim the ACR122U with its own kernel NFC modules, which gets in the way, so blacklist them and reboot to be safe:

```
$ printf '%s\n' 'pn533' 'pn533_usb' 'nfc' | sudo tee /etc/modprobe.d/blacklist-nfc.conf
$ sudo reboot
```

## Getting tapdeck

Grab the binary for your platform from the [Releases](https://github.com/codybrom/tapdeck/releases) page and mark it executable:

```
$ chmod +x tapdeck
```

That's the whole install — the binary is self-contained, loads `libpcsclite` at runtime, and talks to Sonos over the LAN, so there's nothing else to set up. If you'd rather build it yourself, or you're on a platform without a prebuilt binary, see [Development](#development) below.

## Configuring

Drop a `usersettings.json` next to the binary (start from [`usersettings.json.example`](usersettings.json.example)) and, at minimum, set `sonos_room` to the room you want your cards to control. A full settings file looks like this:

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

`sonos_room` is really the only setting you need, and it's matched case-insensitively. If multicast discovery is blocked on your network and tapdeck can't find your speakers on its own, set `sonos_seed_ip` to the IP address of any one Sonos player and it'll bootstrap from there. The three `reset_*` options control whether tapdeck turns off repeat, shuffle, and crossfade before it queues up new music, which it does by default so that a fresh tap behaves predictably. And `min_volume` guards against a near-silent tap: if you scan a music card while the speaker is turned almost all the way down (below 5), tapdeck nudges the volume up to this value so a card never seems to do nothing.

## Running it

```
$ ./tapdeck
```

It needs to be on the same network as your speakers, since it discovers them with UDP multicast. Tap a card and the matching music plays.

# What you can put on a card

The text you write to a tag decides what it does. A `spotify:track:`, `spotify:album:`, or `spotify:playlist:` URI plays that item from Spotify. A `favorite:Name` tag plays one of your saved Sonos favorites — and because favorites can point at any service you've set up in the Sonos app, that's also how you play Apple Music, Amazon, radio stations, and so on (those aren't built in directly, so save them as favorites). A `playlist:Name` tag plays a saved Sonos playlist. A `room:Name` tag switches which room your following taps control. And a `command:` tag sends a raw transport command, for things like `command:play`, `command:pause`, `command:next`, `command:volume/40`, `command:volume/+5`, `command:repeat/all`, `command:shuffle/on`, `command:crossfade/off`, `command:mute`, or `command:clearqueue`.

# Keeping it running

For day-to-day use you'll want tapdeck under a process supervisor so it starts at boot and comes back if it ever exits. pm2 is an easy option:

```
$ pm2 start ./tapdeck --name tapdeck
$ pm2 save
$ pm2 startup
```

Run the command that `pm2 startup` prints to wire it into your init system. systemd works just as well if you'd rather point a unit file at the binary.

# Programming cards

Each card holds an NDEF message, and tapdeck reads the first text or URI record off it and treats that as the tag text described above. This matches the card format used by [Sonos Vinyl Emulator](https://github.com/hankhank10/vinylemulator), so cards made for that will work here unchanged.

The simplest way to write cards is a phone app — [NFC Tools](https://www.wakdev.com/en/apps/nfc-tools-pc-mac.html) on iOS or Android does the job nicely. Write a single text or URI record containing whatever you want, like `spotify:album:...` or `favorite:Coffee House`. If a tag is brand new, format it for NDEF first (NXP TagWriter is handy for that) and then write your record.

# Development

tapdeck is written in TypeScript and runs on [Deno](https://deno.com), which you only need if you want to build it or hack on it — running a release binary needs nothing. With Deno installed, the usual tasks are:

```
$ deno task start     # run from source
$ deno task test      # run the tests
$ deno task lint
$ deno task fmt
$ deno task compile   # build the self-contained ./tapdeck binary
```

The NFC layer in `lib/nfc` speaks to `libpcsclite` directly through Deno's FFI, so there's no native addon to compile, and the Sonos engine in `lib/sonos` is a small, dependency-free UPnP/SOAP client. Running from source needs three permissions, all baked into the `start` task: `--allow-ffi` for the reader, `--allow-net` for Sonos, and `--allow-read` for your `usersettings.json`.
