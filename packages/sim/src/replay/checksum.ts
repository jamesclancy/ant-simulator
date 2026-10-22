const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * 32-bit FNV-1a over a plain state tree (what `Sim.getState` returns): numbers, strings,
 * booleans, null, arrays, objects (keys sorted, so insertion order doesn't matter) and
 * typed arrays (hashed by their bytes). Identical states hash identically; any differing
 * float bit changes the hash with overwhelming probability.
 */
export function hashState(value: unknown): number {
  let h = FNV_OFFSET;
  const f64 = new Float64Array(1);
  const words = new Uint32Array(f64.buffer);
  const mix = (n: number): void => {
    h = Math.imul(h ^ (n >>> 0), FNV_PRIME);
  };
  const walk = (v: unknown): void => {
    switch (typeof v) {
      case 'number':
        f64[0] = v;
        mix(1);
        mix(words[0]!);
        mix(words[1]!);
        return;
      case 'string':
        mix(2);
        mix(v.length);
        for (let i = 0; i < v.length; i++) mix(v.charCodeAt(i));
        return;
      case 'boolean':
        mix(v ? 3 : 4);
        return;
      case 'object':
        break;
      default:
        mix(5);
        return;
    }
    if (v === null) {
      mix(6);
    } else if (ArrayBuffer.isView(v)) {
      mix(7);
      mix(v.byteLength);
      if (v.byteOffset % 4 === 0 && v.byteLength % 4 === 0) {
        const w = new Uint32Array(v.buffer, v.byteOffset, v.byteLength / 4);
        for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w[i]!, FNV_PRIME);
      } else {
        const b = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
        for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i]!, FNV_PRIME);
      }
    } else if (Array.isArray(v)) {
      mix(8);
      mix(v.length);
      for (const item of v) walk(item);
    } else {
      mix(9);
      for (const key of Object.keys(v).sort()) {
        const item = (v as Record<string, unknown>)[key];
        if (item === undefined) continue;
        walk(key);
        walk(item);
      }
    }
  };
  walk(value);
  return h >>> 0;
}
