# Tapdeck

[![CI](https://github.com/codybrom/tapdeck/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/codybrom/tapdeck/actions/workflows/ci.yml)

## Getting Started

There's something that just feels right about using your hands and physical objects to play music. Tapdeck was built to make the software side of reading NFC tags and play Spotify to a Sonos system as easy as possible. A self-contained binary interfaces with a USB NFC reader to control Sonos speakers over the local network without API keys or logins.

### Items You'll Need

- A Raspberry Pi (or other always-on Linux machine)
- A USB ACR122U RFID/NFC reader
- Programmable NFC tags, like cheap NTAG213 stickers
- A smartphone to program the tags

Tapdeck was specifically built for use with the ACR122U because it is an inexpensive and widely available USB reader. You can find it online from a variety of sellers, sometimes with included tags.

### Setting up the NFC reader

On your Raspberry Pi (or any Debian/Ubuntu machine), install the reader's driver, middleware and daemon:

```bash
sudo apt install libacsccid1 libpcsclite1 pcscd
```

Linux will sometimes try to claim the ACR122U with its own kernel NFC modules, so before going any further, blacklist them and reboot:

```bash
printf '%s\n' 'pn533' 'pn533_usb' 'nfc' | sudo tee /etc/modprobe.d/blacklist-nfc.conf
sudo reboot
```

### Installing Tapdeck

Grab the binary for your platform from [Releases](https://github.com/codybrom/tapdeck/releases), make it executable, and move it onto your `PATH`:

| Device Type                                  | Filename               |
| -------------------------------------------- | ---------------------- |
| Raspberry Pi or other Arm-based Linux device | `tapdeck-linux-arm64`  |
| Intel/AMD-based Linux devices                | `tapdeck-linux-x86_64` |

```bash
chmod +x tapdeck-linux-arm64
sudo mv tapdeck-linux-arm64 /usr/local/bin/tapdeck
```

For other platforms, or to build it yourself, see [Development](#development).

### Configuring

Run `tapdeck setup`. It finds your system, asks which room and Spotify account you want to use, and writes your config to `~/.tapdeck/config.json`.

#### Example Config

```json
{
  "sonos_room": "Living Room",
  "sonos_seed_ip": "",
  "reset_repeat": true,
  "reset_shuffle": true,
  "reset_crossfade": true,
  "min_volume": 10,
  "spotify_account_sn": 1
}
```

### Troubleshooting Setup

If you have any issues, you can run `tapdeck status` to get a readout of what tapdeck can see on your system.

```bash
$ tapdeck status
Connected to Sonos at 192.168.0.195

Rooms — set "sonos_room" to the one your cards should control:
  Kitchen              192.168.0.96
  Living Room          192.168.0.153
  Office               192.168.0.195

Spotify accounts — set "spotify_account_sn" to the one you want:
  spotify_account_sn: 2 [token 0]
      • Songs
```

- Only `sonos_room` is required for Tapdeck to work. It is matched case-insensitively.
- If Tapdeck can't automatically discover your speakers, you can use the `sonos_seed_ip` on the config to bootstrap discovery with a known IP of a speaker. Sleeping speakers may not appear if something hasn't been played recently.
- The `reset_*` flags clear repeat, shuffle, and crossfade before each tap so playback starts predictably, and `min_volume` raises a near-silent speaker so a tap is never inaudible.
- `spotify_account_sn` chooses which linked Spotify account to play from. If you have more than one Spotify account tied to your Sonos system and are having trouble setting the right account, try playing from the account you wish to use using the Sonos app and then check the value in `tapdeck status`.

## Running Tapdeck

Make sure your reader is plugged in and active, then run `tapdeck` and tap a tag. You will most likely hear the reader beep or see the reader's LED turn green when it has successfully detected a tag. If you have issues with tag reads, please note that a successful read may require hovering over the reader for about 1-2 seconds after it beeps/LED turns green.

### Running Tapdeck at Boot / In the Background

To start it at boot and bring it back if it exits, run it under a supervisor like pm2:

```bash
pm2 start tapdeck --name tapdeck
pm2 save
pm2 startup
```

## Programming Tags

Tapdeck reads the first text or URI record on a tag and acts on it. To get a Spotify item's ID, copy its share URL and take the part before any query params (i.e. ignore anything after the `?`, like `?si=6f54337b83214964`):

```txt
https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=6f54337b83214964 -> spotify:track:4cOdK2wGLETKBW3PvgPWqT
```

- `spotify:<type>:<id>` - Spotify media items
  - `spotify:track:<id>` - Single song
  - `spotify:album:<id>` - Single album
  - `spotify:playlist:<id>` — Spotify Playlist (account must have access)
- `room:<name>` — Change which room your taps control from then on.
- `command:<verb>` — transport commands
  - `command:play`
  - `command:pause`
  - `command:next`
  - `command:previous`
  - `command:volume/40`
  - `command:volume/+5`
  - `command:repeat/all`
  - `command:shuffle/on`
  - `command:crossfade/off`
  - `command:mute`
  - `command:clearqueue`

This is the same card format used by [Sonos Vinyl Emulator](https://github.com/hankhank10/vinylemulator). Write tags with a phone app like [NFC Tools](https://www.wakdev.com/en/apps/nfc-tools-pc-mac.html): a single text or URI record holding the text above. Format brand-new tags for NDEF first (NXP TagWriter handles that).

## Development

Tapdeck is written in TypeScript and runs on [Deno](https://deno.com). From source it needs FFI access (the reader), network access (Sonos), read and write access (the config file `setup` creates), permission to run `pm2` (setup's optional autostart step) and env access, all of which are baked into the start task in `deno.json` (run it with `deno task start`).

## Acknowledgements

Tapdeck started as a fork of Ryan Olf's [node-sonos-nfc](https://github.com/ryanolf/node-sonos-nfc), which itself traces back to hankhank10's [Sonos Vinyl Emulator](https://github.com/hankhank10/vinylemulator). Major thanks to both, and to the maintainers of the open-source PC/SC and ACR122U tooling.

## License

[MIT License](LICENSE).
