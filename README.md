[![CI](https://github.com/codybrom/tapdeck/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/codybrom/tapdeck/actions/workflows/ci.yml)

# tapdeck

tapdeck lets you tap an NFC tag to play Spotify, a Sonos favorite, or a playlist on your Sonos — like dropping a record on a deck. Stick a cheap NFC sticker on a card (or a coaster, or a printed photo, or really anything), program it with what you want to hear, and tap it on a card reader to play. It ships as a single self-contained binary that reads your NFC reader and talks to your Sonos speakers directly over the local network, so there's no cloud service, no separate API server to babysit, no account credentials to configure, and no runtime to install.

## About

There's a genuinely nice aesthetic to controlling a streaming service with physical media, and honestly making the cards is half the fun — NTAG213 stickers run well under $15 for fifty, so you can make a big stack of them and decorate them however you like. It's also a hit with kids: little ones who can't read yet can absolutely learn that tapping the dinosaur card plays the dinosaur songs.

tapdeck is tested with the ACR122U, an inexpensive and widely available USB reader. The ACR122U has a bit of a reputation for being awkward with general-purpose NFC libraries, but it's a perfectly good PC/SC smart-card reader, and PC/SC is all tapdeck needs — so it works reliably here, and should work with any other PC/SC-compatible reader too.

## Thanks

tapdeck began life as a fork of Ryan Olf's [node-sonos-nfc](https://github.com/ryanolf/node-sonos-nfc), and a big thank-you goes to Ryan for the original version that got this whole thing rolling. It has since been rewritten from the ground up: where the original leaned on a native Node addon to read the card reader and an external HTTP API to control Sonos, tapdeck now reads the reader directly through libpcsclite via FFI with no native addon at all, and drives Sonos with its own small, dependency-free UPnP engine. The original tap-a-card-to-play idea traces back to hankhank10's [Sonos Vinyl Emulator](https://github.com/hankhank10/vinylemulator), which is well worth a look.

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

That's the whole install — the binary is self-contained, loads libpcsclite at runtime, and talks to Sonos over the network, so there's nothing else to set up. If you'd rather build it yourself, or you're on a platform without a prebuilt binary, see [Development](#development) below.

## Configuring

Drop a usersettings.json next to the binary (start from the included example file) and, at the very least, set the room you want your cards to control. A full settings file looks like this:

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

The room name is really the only thing you have to set, and it's matched without worrying about capitalization. If multicast discovery is blocked on your network and tapdeck can't find your speakers on its own, fill in a seed IP — the address of any one Sonos player — and it'll bootstrap from there. The three reset options control whether tapdeck turns off repeat, shuffle, and crossfade before it queues up new music, which it does by default so that a fresh tap behaves predictably. And the minimum volume is a small kindness: if you tap a music card while the speaker is turned almost all the way down, tapdeck nudges it back up so a card never seems to do nothing.

## Running it

```
$ ./tapdeck
```

It needs to be on the same network as your speakers, since it discovers them with UDP multicast. Tap a card and the matching music plays.

# What you can put on a card

The text you write to a tag is what decides what it does. A Spotify URI — something like spotify:track:…, spotify:album:…, or spotify:playlist:… — plays that item from Spotify. A tag that reads "favorite:" followed by the name of one of your saved Sonos favorites plays that favorite, and since favorites can point at any service you've connected in the Sonos app, that's also how you reach Apple Music, Amazon, radio stations, and the rest — none of those are built in on their own, so the trick is to save them as Sonos favorites. A "playlist:" tag followed by a Sonos playlist name plays that playlist, and a "room:" tag followed by a room name changes which room your taps control from then on. Finally, anything that starts with "command:" is passed straight through as a transport command — play, pause, next, previous, volume/40, volume/+5, repeat/all, shuffle/on, crossfade/off, mute, clearqueue, and so on.

# Keeping it running

For day-to-day use you'll want tapdeck under a process supervisor so it starts at boot and comes back if it ever exits. pm2 is an easy option:

```
$ pm2 start ./tapdeck --name tapdeck
$ pm2 save
$ pm2 startup
```

Run the command that pm2 startup prints to wire it into your init system. systemd works just as well if you'd rather point a unit file at the binary.

# Programming cards

Each card holds an NDEF message, and tapdeck reads the first text or URI record off it and treats that as the tag text described above. This matches the card format used by [Sonos Vinyl Emulator](https://github.com/hankhank10/vinylemulator), so cards made for that will work here unchanged.

The simplest way to write cards is a phone app — [NFC Tools](https://www.wakdev.com/en/apps/nfc-tools-pc-mac.html) on iOS or Android does the job nicely. Write a single text or URI record containing whatever you want, like spotify:album:… or favorite:Coffee House. If a tag is brand new, format it for NDEF first (NXP TagWriter is handy for that) and then write your record.

# Development

tapdeck is written in TypeScript and runs on [Deno](https://deno.com), which you only need if you want to build it or hack on it — running a release binary needs nothing at all. With Deno installed, the usual tasks are there:

```
$ deno task start     # run from source
$ deno task test      # run the tests
$ deno task lint
$ deno task fmt
$ deno task compile   # build the self-contained ./tapdeck binary
```

The NFC layer speaks to libpcsclite directly through Deno's FFI, so there's no native addon to compile, and the Sonos engine is a small, dependency-free UPnP/SOAP client. Running from source needs three permissions, all baked into the start task: FFI access for the reader, network access for Sonos, and read access for your settings file.
