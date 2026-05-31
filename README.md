[![CI](https://github.com/codybrom/tapdeck/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/codybrom/tapdeck/actions/workflows/ci.yml)

# tapdeck

Tap an NFC tag to play Spotify, a Sonos favorite, or a playlist on your Sonos — like dropping a
record on a deck. A small, **zero-dependency TypeScript app on [Deno](https://deno.com)** that reads
your NFC reader via FFI and talks to Sonos **directly over your LAN** (UPnP/SOAP): no separate API
server, no cloud, no credentials, no native addons.

# About

tapdeck turns NFC tags into a physical remote for your Sonos: stick an NTAG sticker on a card (or
anything else), program it with a Spotify URI, a Sonos favorite or playlist, or a transport command,
and tap it on a cheap PC/SC reader to play. There's a nice aesthetic to controlling streaming with
physical media, and making the cards is a fun project — NTAG213 stickers run under $15 for 50. (For
the parents out there: it's a hit with kids at least as young as 4.)

It's tested with the **ACR122U** — an inexpensive, widely available reader. The ACR122U isn't great
for general NFC, but it's a solid PC/SC smart-card reader, which is all tapdeck needs: it reads tags
through `libpcsclite` over Deno's FFI.

## Thanks

tapdeck started as a fork of Ryan Olf's [node-sonos-nfc](https://github.com/ryanolf/node-sonos-nfc)
— **thank you, Ryan**, for the original version that got this rolling. It has since been rewritten
from the ground up: it runs on Deno/TypeScript, reads the card reader directly via FFI (no native
addon), and drives Sonos with an in-house, zero-dependency UPnP engine instead of an external HTTP
API. The original tap-a-card-to-play idea comes from
[Sonos Vinyl Emulator](https://github.com/hankhank10/vinylemulator) by hankhank10.

# Install

## You need a computer

The basic setup here involves a PC/SC card reader attached to a computer on the same network as your
Sonos. The computer could be any computer that runs Node.js (so, any computer) and has drivers
available for your card reader (depends on the card reader). If you have the ACR122U, you can use
pretty much any computer with USB and networking capability. A popular option if you don't want to
hook up to an existing computer is to purchase a Raspberry Pi. I _think_ pretty much any model will
do if it can properly power the card reader. I've used a version 3 and 4. There is a super cheap and
tiny Pi Zero that could probably run the software but may struggle to source enough power for the
card reader when it's actually reading cards. Check out
[the Raspberry Pi documentation](https://www.raspberrypi.org/documentation/) if you want to setup a
Raspberry Pi.

## Card reader setup

This program uses the [nfc-pcsc] library to read (and someday?) write to PC/SC compatible smart card
readers. The library is tested with the ACR122U but _should_ work with any PC/SC compatible reader.
Instructions here are mainly focused on ACR122U because that's what has been tested.

Make sure your card reader can be detected by your system by installing drivers as needed. For
ACR122U on Ubuntu/Debian/Raspberry Pi OS:

```
$ sudo apt install libacsccid1
```

You also need to make sure your computer can speak PC/SC. In Ubuntu/Debian, install the PC/SC
library and daemon (tapdeck calls `libpcsclite` directly via Deno FFI, so there's no addon to
compile — just the runtime library):

```
$ sudo apt install libpcsclite1 pcscd
```

If you're running a version of Linux, your computer may try to use the nfc kernel module to talk to
tyour ACR122U. You don't want it to do this, so make sure the nfc and enabling modules are not
loaded. In Ubuntu/Debian/Raspberry Pi OS, blacklist pn533, pn533_usb, nfc modules so that they don't
hijack the card reader.

```
$ printf '%s\n' 'pn533' 'pn533_usb' 'nfc' | sudo tee /etc/modprobe.d/blacklist-nfc.conf
```

To make sure everything is square, it's probably a good idea to reboot. In Ubuntu/Debian/Raspberry
Pi OS:

```
$ sudo reboot
```

## Setup Deno

tapdeck runs on [Deno](https://deno.com) (TypeScript, no build step, no `node_modules`). Install it:

```
$ curl -fsSL https://deno.land/install.sh | sh
```

## Setup this code

Install git and clone this repo. In Ubuntu/Debian/Raspberry Pi OS,

```
$ sudo apt install git
$ git clone https://github.com/codybrom/tapdeck.git
```

There's nothing to install — Deno caches its few standard-library imports on first run. The NFC
reader talks to your card reader through `libpcsclite` directly via Deno's FFI (no native addon to
compile), and the Sonos side is pure TypeScript.

```
$ cd tapdeck
$ deno task start   # reads NFC tags and controls Sonos
```

This app talks to your Sonos players **directly over the local network** (UPnP/SOAP) using a small,
dependency-free engine built into the project — there's no separate API server to run and no
Spotify/Apple credentials to configure. It just needs to be on the same LAN as your speakers (UDP
multicast is used to discover them). It needs three Deno permissions: `--allow-ffi` (the card
reader, via libpcsclite), `--allow-net` (Sonos), and `--allow-read` (your `usersettings.json`) — all
wired into the `start` task.

Copy `usersettings.json.example` to `usersettings.json` and set `sonos_room` to the room you want to
control. If multicast discovery is blocked on your network, set `sonos_seed_ip` to the IP of any one
Sonos player to skip discovery. `min_volume` (default 10) raises a near-muted speaker (volume < 5)
to an audible level when a music card is scanned, so a tap never plays silently.

**Supported tags:** `spotify:` (track/album/playlist), `favorite:<name>` and `playlist:<name>`
(anything saved in your Sonos app — works for any service), `command:<x>` (raw transport: `play`,
`pause`, `next`, `previous`, `volume/40`, `volume/+5`, `repeat/all`, `shuffle/on`, `crossfade/off`,
`mute`, `clearqueue`), and `room:<name>` to switch rooms. Other music services
(Apple/Amazon/TuneIn/BBC) are not built in — use a Sonos favorite instead.

## Run all the time

To run continuously and at boot, you'll want to run under some supervisor program. There are lots of
options, like systemd (built-in already), supervisord, and pm2. I have found pm2, recommended by the
author of Vinyl Emulator, to be very easy to use. To have pm2 spin-up tapdeck at boot and keep it
running, install pm2 globally:

```
$ sudo npm install -g pm2
```

and spin-up tapdeck:

```
$ pm2 start deno --name tapdeck -- task start
```

Then, to configure your system to run the startup, follow the instructions given when you run

```
$ pm2 startup
```

e.g.

```
$ sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u pi --hp /home/pi
```

## Debug

You can monitor the process output to see what's going on. If you're using pm2, you can see the
process output via

```
$ pm2 log
```

# Programming cards

## Card record format

The cards are programmed per the instructions at
[Sonos Vinyl Emulator](https://github.com/hankhank10/vinylemulator). One minor difference with this
program compared to Vinyl Emulator is that this program turns off shuffle, repeat, and crossfade
whenever new music is queued by default. This is configurable in `usersettings.json`, you can turn
off this behaviour by adding and/or setting `reset_repeat`, `reset_shuffle` and, `reset_crossfade`
parameters to False. You can also enable cross fade, shuffle, or repeat on a card-by-card basis by
adding records to enable these features to the card.

## Writing cards

You can probably use the card reader/writer you plan to use to write the cards using software like
[NFC Tools](https://www.wakdev.com/en/apps/nfc-tools-pc-mac.html) on your Mac or PC. I like to use
my iPhone. Most modern smartphones can read and write NFC with the right app.

It's important that before you write, the card is properly erased and formatted. On my iPhone, I
format the cards for NDEF using "NXP Tagwriter." Once the cards are formatted, I use NFC Tools on
iOS to write the record(s).
