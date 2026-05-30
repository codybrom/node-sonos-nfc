// NFC reader monitor loop built on the Deno FFI PC/SC binding. Waits for the
// ACR122U, then on each card insertion reads the NTAG NDEF message and hands
// the payload to a callback. Replaces nfc-pcsc's Reader.

import * as pcsc from './pcsc.ts';
import { extractNdefMessage, firstPayload, parseNdef } from './ndef.ts';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Connect, retrying through the transient unpowered/unresponsive states that
// a card passes through for a moment right after it lands on the reader.
async function connectWithRetry(ctx: bigint, readerName: string): Promise<pcsc.Card> {
  for (let i = 0; i < 25; i++) {
    try {
      return await pcsc.connect(ctx, readerName);
    } catch (err) {
      // Retry only while the card is still powering up; bail if it's gone.
      if (err instanceof pcsc.PcscError && pcsc.POWERING_UP.has(err.code)) {
        await delay(80);
        continue;
      }
      throw err;
    }
  }
  throw new Error('card did not power up in time');
}

// Read the NTAG user memory (from page 4) via FF B0 read APDUs until we have a
// complete NDEF message, the tag ends, or a cap is hit. Returns the text/uri.
async function readTag(ctx: bigint, readerName: string): Promise<string | null> {
  const card = await connectWithRetry(ctx, readerName);
  try {
    const bytes: number[] = [];
    let page = 4;
    for (let chunk = 0; chunk < 64; chunk++) {
      const resp = await pcsc.transmit(card, new Uint8Array([0xff, 0xb0, 0x00, page & 0xff, 0x10]));
      if (resp.length < 2) break;
      const sw1 = resp[resp.length - 2];
      const data = resp.slice(0, resp.length - 2);
      if (sw1 !== 0x90 || data.length === 0) break; // error or end of memory
      for (const b of data) bytes.push(b);
      const msg = extractNdefMessage(new Uint8Array(bytes));
      if (msg) return firstPayload(parseNdef(msg));
      page += 4;
    }
    return null;
  } finally {
    pcsc.disconnect(card);
  }
}

// Run the reader loop forever, invoking onTag(text) for each scanned card.
export async function startReader(onTag: (text: string) => Promise<void> | void): Promise<void> {
  const ctx = pcsc.establishContext();
  console.log(
    'Control your Sonos with NFC cards. Searching for PCSC-compatible NFC reader devices...',
  );

  // Wait for a reader to appear.
  let readerName: string | undefined;
  while (!readerName) {
    readerName = pcsc.listReaders(ctx)[0];
    if (!readerName) await delay(1000);
  }
  console.log(`${readerName} device attached`);
  const readerBuf = pcsc.cstr(readerName);

  let currentState = pcsc.STATE_UNAWARE;
  for (;;) {
    let newState: number;
    try {
      newState = await pcsc.waitForChange(ctx, readerBuf, currentState);
    } catch (err) {
      console.error(`reader status error: ${(err as Error).message}`);
      await delay(1000);
      continue;
    }
    const wasPresent = (currentState & pcsc.STATE_PRESENT) !== 0;
    const isPresent = (newState & pcsc.STATE_PRESENT) !== 0;
    currentState = newState;

    if (isPresent && !wasPresent) {
      try {
        await delay(20); // connect almost immediately; retry handles power-up
        const text = await readTag(ctx, readerName);
        if (text) {
          console.log('Read from NFC tag with message: ', text);
          await onTag(text);
        } else {
          console.log('Could not parse anything from this tag.');
        }
      } catch (err) {
        console.error((err as Error).toString());
      }
    } else if (!isPresent && wasPresent) {
      console.log('Card removed');
    }
  }
}
