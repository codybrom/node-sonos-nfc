// Minimal NDEF parsing — just the text and URI records the jukebox uses.
// Replaces nfccard-tool/ndef-lib (which we no longer depend on).

export type NdefRecord =
  | { type: 'text'; text: string }
  | { type: 'uri'; uri: string }
  | { type: 'unknown' };

// NDEF URI abbreviation table (subset; index 0 = no prefix, which is what
// `spotify:` tags use).
const URI_PREFIXES = [
  '',
  'http://www.',
  'https://www.',
  'http://',
  'https://',
  'tel:',
  'mailto:',
];

const decoder = new TextDecoder();

// Extract the NDEF message bytes from raw tag memory (TLV-framed). The user
// memory is a sequence of TLVs; we want the NDEF TLV (tag 0x03).
export function extractNdefMessage(mem: Uint8Array): Uint8Array | null {
  let i = 0;
  while (i < mem.length) {
    const tag = mem[i++]!;
    if (tag === 0x00) continue; // NULL TLV — padding
    if (tag === 0xfe) break; // Terminator TLV
    // Length: 1 byte, or 0xFF followed by 2-byte length.
    let len = mem[i++]!;
    if (len === 0xff) {
      len = (mem[i]! << 8) | mem[i + 1]!;
      i += 2;
    }
    if (tag === 0x03) {
      if (i + len > mem.length) return null; // not fully read yet — caller reads more
      return mem.slice(i, i + len); // NDEF message
    }
    i += len; // skip other TLVs (e.g. 0x01 lock control)
  }
  return null;
}

// Parse an NDEF message into its records (text/uri only).
export function parseNdef(message: Uint8Array): NdefRecord[] {
  const records: NdefRecord[] = [];
  let i = 0;
  while (i < message.length) {
    const header = message[i++]!;
    const tnf = header & 0x07;
    const il = (header & 0x08) !== 0;
    const sr = (header & 0x10) !== 0;
    const me = (header & 0x40) !== 0;

    const typeLen = message[i++]!;
    let payloadLen: number;
    if (sr) {
      payloadLen = message[i++]!;
    } else {
      payloadLen = (message[i]! << 24) |
        (message[i + 1]! << 16) |
        (message[i + 2]! << 8) |
        message[i + 3]!;
      i += 4;
    }
    const idLen = il ? message[i++]! : 0;
    const type = decoder.decode(message.slice(i, i + typeLen));
    i += typeLen + idLen;
    const payload = message.slice(i, i + payloadLen);
    i += payloadLen;

    if (tnf === 0x01 && type === 'T') {
      const langLen = (payload[0] ?? 0) & 0x3f; // status byte: low 6 bits = lang code length
      records.push({
        type: 'text',
        text: decoder.decode(payload.slice(1 + langLen)),
      });
    } else if (tnf === 0x01 && type === 'U') {
      const prefix = URI_PREFIXES[payload[0] ?? 0] ?? '';
      records.push({
        type: 'uri',
        uri: prefix + decoder.decode(payload.slice(1)),
      });
    } else {
      records.push({ type: 'unknown' });
    }
    if (me) break; // Message End
  }
  return records;
}

// Convenience: the text/uri string from the first usable record, or null.
export function firstPayload(records: NdefRecord[]): string | null {
  for (const r of records) {
    if (r.type === 'text') return r.text;
    if (r.type === 'uri') return r.uri;
  }
  return null;
}
