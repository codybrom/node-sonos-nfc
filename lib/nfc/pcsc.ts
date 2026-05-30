// Minimal PC/SC (winscard) binding via Deno FFI to libpcsclite — replaces the
// nan-based nfc-pcsc native addon, which can't load under Deno.
//
// ABI notes (pcsc-lite on 64-bit Linux): DWORD/LONG are `unsigned long`/`long`
// = 8 bytes; SCARDCONTEXT/SCARDHANDLE are 8-byte handles. Blocking calls
// (GetStatusChange, Transmit, Connect) are declared `nonblocking` so they run
// off the main thread and return Promises.

const LIB_PATH = Deno.env.get('PCSC_LIB') ?? 'libpcsclite.so.1';

const lib = Deno.dlopen(
  LIB_PATH,
  {
    SCardEstablishContext: { parameters: ['u64', 'pointer', 'pointer', 'buffer'], result: 'i32' },
    SCardReleaseContext: { parameters: ['u64'], result: 'i32' },
    SCardListReaders: { parameters: ['u64', 'pointer', 'buffer', 'buffer'], result: 'i32' },
    SCardGetStatusChange: {
      parameters: ['u64', 'u64', 'buffer', 'u64'],
      result: 'i32',
      nonblocking: true,
    },
    SCardConnect: {
      parameters: ['u64', 'buffer', 'u64', 'u64', 'buffer', 'buffer'],
      result: 'i32',
      nonblocking: true,
    },
    SCardTransmit: {
      parameters: ['u64', 'pointer', 'buffer', 'u64', 'pointer', 'buffer', 'buffer'],
      result: 'i32',
      nonblocking: true,
    },
    SCardDisconnect: { parameters: ['u64', 'u64'], result: 'i32' },
  } as const,
);

// Constants (from /usr/include/PCSC/pcsclite.h).
export const SCARD_SCOPE_SYSTEM = 2n;
export const SCARD_SHARE_SHARED = 2n;
export const SCARD_PROTOCOL_T0_T1 = 3n; // T0 | T1
export const SCARD_LEAVE_CARD = 0n;
export const STATE_UNAWARE = 0x0000;
export const STATE_EMPTY = 0x0010;
export const STATE_PRESENT = 0x0020;
export const INFINITE = 0xFFFFFFFFn;
const S_SUCCESS = 0;

// SCARD_READERSTATE layout (8-byte fields, MAX_ATR_SIZE=33):
//   szReader* @0, pvUserData* @8, dwCurrentState @16, dwEventState @24,
//   cbAtr @32, rgbAtr[33] @40  -> 73 bytes, allocate 80 for alignment.
const RS_SIZE = 80;
const RS_CURRENT = 16;
const RS_EVENT = 24;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class PcscError extends Error {
  readonly code: number;
  constructor(op: string, rv: number) {
    super(`${op} failed: 0x${(rv >>> 0).toString(16)}`);
    this.code = rv >>> 0;
  }
}

// A card that just landed passes through these transient states while pcscd
// powers it up — worth retrying. Anything else (e.g. NO_SMARTCARD/REMOVED) means
// the card is gone.
export const POWERING_UP = new Set([
  0x8010000b, // SCARD_E_NOT_READY
  0x80100066, // SCARD_W_UNRESPONSIVE_CARD
  0x80100067, // SCARD_W_UNPOWERED_CARD
  0x80100068, // SCARD_W_RESET_CARD
]);

function check(rv: number, op: string): void {
  if (rv !== S_SUCCESS) throw new PcscError(op, rv);
}

// Deno FFI 'buffer' params want Uint8Array backed by a plain ArrayBuffer.
type Buf = Uint8Array<ArrayBuffer>;

export function cstr(s: string): Buf {
  return Uint8Array.from(encoder.encode(s + '\0'));
}

export function establishContext(): bigint {
  const ctx = new Uint8Array(8);
  check(lib.symbols.SCardEstablishContext(SCARD_SCOPE_SYSTEM, null, null, ctx), 'EstablishContext');
  return new DataView(ctx.buffer).getBigUint64(0, true);
}

export function releaseContext(ctx: bigint): void {
  lib.symbols.SCardReleaseContext(ctx);
}

// Returns the reader names (the API returns a multi-string: NUL-separated, double-NUL terminated).
export function listReaders(ctx: bigint): string[] {
  const len = new Uint8Array(8);
  const rv1 = lib.symbols.SCardListReaders(ctx, null, null, len);
  if (rv1 !== S_SUCCESS) return []; // e.g. SCARD_E_NO_READERS_AVAILABLE
  const size = Number(new DataView(len.buffer).getBigUint64(0, true));
  if (!size) return [];
  const buf = new Uint8Array(size);
  check(lib.symbols.SCardListReaders(ctx, null, buf, len), 'ListReaders');
  return decoder.decode(buf).split('\0').filter((s) => s.length > 0);
}

// Build a READERSTATE buffer pointing at `readerName`, with the given current state.
function readerState(readerName: Buf, currentState: number): Buf {
  const buf = new Uint8Array(RS_SIZE);
  const view = new DataView(buf.buffer);
  const ptr = Deno.UnsafePointer.value(Deno.UnsafePointer.of(readerName));
  view.setBigUint64(0, BigInt(ptr), true); // szReader
  view.setBigUint64(RS_CURRENT, BigInt(currentState), true);
  return buf;
}

// Block (off-thread) until the reader's card state changes from `currentState`.
// Returns the new event state (mask STATE_PRESENT / STATE_EMPTY).
export async function waitForChange(
  ctx: bigint,
  readerName: Buf,
  currentState: number,
  timeoutMs: bigint = INFINITE,
): Promise<number> {
  const rs = readerState(readerName, currentState);
  const rv = await lib.symbols.SCardGetStatusChange(ctx, timeoutMs, rs, 1n);
  // 0x8010000A = SCARD_E_TIMEOUT — treat as "no change".
  if ((rv >>> 0) === 0x8010000a) return currentState;
  check(rv, 'GetStatusChange');
  return Number(new DataView(rs.buffer).getBigUint64(RS_EVENT, true) & 0xffffffffn);
}

export interface Card {
  handle: bigint;
  protocol: bigint;
}

export async function connect(ctx: bigint, readerName: string): Promise<Card> {
  const hCard = new Uint8Array(8);
  const proto = new Uint8Array(8);
  const rv = await lib.symbols.SCardConnect(
    ctx,
    cstr(readerName),
    SCARD_SHARE_SHARED,
    SCARD_PROTOCOL_T0_T1,
    hCard,
    proto,
  );
  check(rv, 'Connect');
  return {
    handle: new DataView(hCard.buffer).getBigUint64(0, true),
    protocol: new DataView(proto.buffer).getBigUint64(0, true),
  };
}

export function disconnect(card: Card): void {
  lib.symbols.SCardDisconnect(card.handle, SCARD_LEAVE_CARD);
}

// SCARD_IO_REQUEST { DWORD dwProtocol; DWORD cbPciLength; } = 16 bytes.
function ioRequest(protocol: bigint): Buf {
  const buf = new Uint8Array(16);
  const view = new DataView(buf.buffer);
  view.setBigUint64(0, protocol, true);
  view.setBigUint64(8, 16n, true);
  return buf;
}

// Send one APDU and return the response bytes (incl. the trailing SW1 SW2).
export async function transmit(card: Card, apdu: Buf): Promise<Uint8Array> {
  const send = ioRequest(card.protocol);
  const recv = new Uint8Array(264);
  const recvLen = new Uint8Array(8);
  new DataView(recvLen.buffer).setBigUint64(0, BigInt(recv.length), true);
  const rv = await lib.symbols.SCardTransmit(
    card.handle,
    Deno.UnsafePointer.of(send),
    apdu,
    BigInt(apdu.length),
    null,
    recv,
    recvLen,
  );
  check(rv, 'Transmit');
  const got = Number(new DataView(recvLen.buffer).getBigUint64(0, true));
  return recv.slice(0, got);
}
