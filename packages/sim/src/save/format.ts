import type { SaveInfo } from '@ant/shared';
import { deflateSync, inflateSync } from 'fflate';

export type { SaveInfo };

/**
 * Binary save container.
 *
 * ```
 * offset  size  field
 * 0       4     magic "ANTS"
 * 4       2     format version (u16 LE)
 * 6       2     reserved (0)
 * 8       4     info length N (u32 LE)
 * 12      N     info: UTF-8 JSON `SaveInfo` (readable without inflating the payload)
 * 12+N    ...   payload: zlib-deflated
 * ```
 *
 * The inflated payload is `[u32 json length][json][pad to 4][binary]`. The JSON is the
 * sim's state tree; every typed array in it is replaced by `{ "$t": kind, "o": byteOffset,
 * "n": length }` pointing into the binary section, so floats round-trip bit-for-bit.
 * Non-finite numbers and -0 are escaped as `{ "$n": "NaN" | "Infinity" | "-Infinity" | "-0" }`.
 * Typed arrays are stored little-endian (every target platform).
 */
export const SAVE_MAGIC = 'ANTS';
/** Bump when the state tree changes shape, and add a step to `MIGRATIONS`. */
export const SAVE_VERSION = 1;

export class SaveError extends Error {
  constructor(
    readonly code: 'badMagic' | 'truncated' | 'corrupt' | 'newerVersion' | 'unsupportedVersion',
    message: string,
  ) {
    super(message);
    this.name = 'SaveError';
  }
}

/** Upgrades a state tree from version `n` to `n + 1`. */
export const MIGRATIONS: Record<
  number,
  (state: Record<string, unknown>) => Record<string, unknown>
> = {};

const KINDS = {
  u8: Uint8Array,
  u16: Uint16Array,
  i32: Int32Array,
  f32: Float32Array,
} as const;
type Kind = keyof typeof KINDS;

function kindOf(v: ArrayBufferView): Kind | null {
  if (v instanceof Float32Array) return 'f32';
  if (v instanceof Uint8Array) return 'u8';
  if (v instanceof Int32Array) return 'i32';
  if (v instanceof Uint16Array) return 'u16';
  return null;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeSave(state: unknown, info: SaveInfo): Uint8Array {
  const blobs: Uint8Array[] = [];
  let binLen = 0;
  const json = JSON.stringify(state, (_key, value: unknown) => {
    if (typeof value === 'number') {
      if (Number.isFinite(value) && !Object.is(value, -0)) return value;
      return { $n: Object.is(value, -0) ? '-0' : String(value) };
    }
    if (ArrayBuffer.isView(value)) {
      const kind = kindOf(value);
      if (!kind) throw new Error('unsupported typed array in save state');
      const n = value.byteLength / KINDS[kind].BYTES_PER_ELEMENT;
      const o = binLen;
      blobs.push(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
      binLen += (value.byteLength + 3) & ~3;
      return { $t: kind, o, n };
    }
    return value;
  });
  const jsonBytes = encoder.encode(json);
  const binStart = (4 + jsonBytes.length + 3) & ~3;
  const raw = new Uint8Array(binStart + binLen);
  new DataView(raw.buffer).setUint32(0, jsonBytes.length, true);
  raw.set(jsonBytes, 4);
  let at = binStart;
  for (const b of blobs) {
    raw.set(b, at);
    at += (b.length + 3) & ~3;
  }
  const payload = deflateSync(raw, { level: 6 });
  const infoBytes = encoder.encode(JSON.stringify(info));
  const out = new Uint8Array(12 + infoBytes.length + payload.length);
  const dv = new DataView(out.buffer);
  out.set(encoder.encode(SAVE_MAGIC), 0);
  dv.setUint16(4, SAVE_VERSION, true);
  dv.setUint32(8, infoBytes.length, true);
  out.set(infoBytes, 12);
  out.set(payload, 12 + infoBytes.length);
  return out;
}

function parseHeader(bytes: Uint8Array): { version: number; infoLen: number } {
  if (bytes.length < 12) throw new SaveError('truncated', 'save is too short');
  if (decoder.decode(bytes.subarray(0, 4)) !== SAVE_MAGIC) {
    throw new SaveError('badMagic', 'not an ant simulator save');
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = dv.getUint16(4, true);
  const infoLen = dv.getUint32(8, true);
  if (12 + infoLen > bytes.length) throw new SaveError('truncated', 'save header is cut short');
  return { version, infoLen };
}

/** Header summary only (no inflate). Throws `SaveError` for foreign / newer files. */
export function readSaveInfo(bytes: Uint8Array): SaveInfo {
  const { version, infoLen } = parseHeader(bytes);
  checkVersion(version);
  try {
    return JSON.parse(decoder.decode(bytes.subarray(12, 12 + infoLen))) as SaveInfo;
  } catch {
    throw new SaveError('corrupt', 'save header is unreadable');
  }
}

function checkVersion(version: number): void {
  if (version > SAVE_VERSION) {
    throw new SaveError(
      'newerVersion',
      `save was written by a newer game (format ${version}, this build reads up to ${SAVE_VERSION})`,
    );
  }
  for (let v = version; v < SAVE_VERSION; v++) {
    if (!MIGRATIONS[v])
      throw new SaveError('unsupportedVersion', `save format ${version} is too old`);
  }
}

/** Inflate, rebuild typed arrays and migrate to the current version. */
export function decodeSave(bytes: Uint8Array): Record<string, unknown> {
  const { version, infoLen } = parseHeader(bytes);
  checkVersion(version);
  let raw: Uint8Array;
  try {
    raw = inflateSync(bytes.subarray(12 + infoLen));
  } catch {
    throw new SaveError('corrupt', 'save data is damaged');
  }
  try {
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const jsonLen = dv.getUint32(0, true);
    const binStart = (4 + jsonLen + 3) & ~3;
    const bin = raw.slice(binStart).buffer;
    let state = JSON.parse(decoder.decode(raw.subarray(4, 4 + jsonLen)), (_k, v: unknown) => {
      if (v && typeof v === 'object') {
        const o = v as { $t?: Kind; o: number; n: number; $n?: string };
        if (o.$t) {
          const T = KINDS[o.$t];
          return new T(bin.slice(o.o, o.o + o.n * T.BYTES_PER_ELEMENT));
        }
        if (o.$n !== undefined) return o.$n === '-0' ? -0 : Number(o.$n);
      }
      return v;
    }) as Record<string, unknown>;
    for (let v = version; v < SAVE_VERSION; v++) state = MIGRATIONS[v]!(state);
    return state;
  } catch (e) {
    if (e instanceof SaveError) throw e;
    throw new SaveError('corrupt', 'save data is damaged');
  }
}
