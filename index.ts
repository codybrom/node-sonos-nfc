// tapdeck entry point: read NFC tags and drive Sonos.
// The FFI reader (lib/nfc) replaces nfc-pcsc; the Sonos engine (lib/sonos)
// talks to the speakers directly over the LAN.

import { startReader } from './lib/nfc/reader.ts';
import process_sonos_command from './lib/process_sonos_command.ts';

await startReader(async (text) => {
  try {
    await process_sonos_command(text);
  } catch (err) {
    console.error((err as Error).toString());
  }
});
