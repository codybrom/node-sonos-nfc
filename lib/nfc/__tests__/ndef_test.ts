import { assertEquals } from '@std/assert';
import { extractNdefMessage, firstPayload, parseNdef } from '../ndef.ts';

const enc = (s: string) => new TextEncoder().encode(s);

// Build a short-record NDEF URI record (identifier code 0x00 = no prefix).
function uriRecord(uri: string): Uint8Array {
  const u = enc(uri);
  const payload = new Uint8Array([0x00, ...u]);
  return new Uint8Array([0xd1, 0x01, payload.length, 0x55, ...payload]); // MB|ME|SR|TNF1, type 'U'
}

// Build a short-record NDEF text record (UTF-8, lang "en").
function textRecord(text: string): Uint8Array {
  const payload = new Uint8Array([0x02, ...enc('en'), ...enc(text)]); // status 0x02 = lang len 2
  return new Uint8Array([0xd1, 0x01, payload.length, 0x54, ...payload]); // type 'T'
}

// Wrap an NDEF message in tag memory: NDEF TLV (0x03) + terminator (0xFE).
function tlv(msg: Uint8Array): Uint8Array {
  return new Uint8Array([0x03, msg.length, ...msg, 0xfe, 0, 0]);
}

Deno.test('parses a URI record (spotify: tag)', () => {
  const mem = tlv(uriRecord('spotify:track:abc123'));
  const msg = extractNdefMessage(mem)!;
  assertEquals(firstPayload(parseNdef(msg)), 'spotify:track:abc123');
});

Deno.test('parses a text record (room tag)', () => {
  const mem = tlv(textRecord('room:Kitchen'));
  assertEquals(
    firstPayload(parseNdef(extractNdefMessage(mem)!)),
    'room:Kitchen',
  );
});

Deno.test('skips a lock-control TLV before the NDEF TLV', () => {
  const ndef = tlv(uriRecord('command:play'));
  const mem = new Uint8Array([0x01, 0x03, 0xaa, 0xbb, 0xcc, ...ndef]); // 0x01 lock TLV, len 3
  assertEquals(
    firstPayload(parseNdef(extractNdefMessage(mem)!)),
    'command:play',
  );
});

Deno.test('returns null when the NDEF message is not fully read yet', () => {
  const mem = new Uint8Array([0x03, 20, 1, 2, 3, 4, 5]); // claims 20, only 5 present
  assertEquals(extractNdefMessage(mem), null);
});
