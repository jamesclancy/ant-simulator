import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import type { SaveMeta, SaveSlot, SaveStore } from './store';
import { SLOTS, isSlot } from './store';

const DIR = 'saves';

/** Capacitor Filesystem exchanges binary as base64 strings. */
export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/**
 * Saves as files in the app's private data directory (`Directory.Data`): `<slot>.bin` for
 * the blob and `<slot>.json` for its metadata. Preferences would be the wrong tool: it is a
 * string key-value store (UserDefaults / SharedPreferences) and not meant for MB-sized
 * values. The metadata is written last, so a slot only appears in the list once its blob
 * is complete.
 */
export function createNativeStore(): SaveStore {
  const opts = { directory: Directory.Data };
  const bin = (slot: SaveSlot): string => `${DIR}/${slot}.bin`;
  const json = (slot: SaveSlot): string => `${DIR}/${slot}.json`;
  return {
    async list() {
      const metas: SaveMeta[] = [];
      for (const slot of SLOTS) {
        try {
          const r = await Filesystem.readFile({
            ...opts,
            path: json(slot),
            encoding: Encoding.UTF8,
          });
          const meta = JSON.parse(r.data as string) as SaveMeta;
          if (isSlot(meta.slot)) metas.push(meta);
        } catch {
          // Slot is empty (or unreadable): not listed.
        }
      }
      return metas.sort((a, b) => b.savedAt - a.savedAt);
    },
    async read(slot) {
      try {
        const r = await Filesystem.readFile({ ...opts, path: bin(slot) });
        return typeof r.data === 'string'
          ? fromBase64(r.data)
          : new Uint8Array(await r.data.arrayBuffer());
      } catch {
        return null;
      }
    },
    async write(slot, bytes, meta) {
      const full: SaveMeta = { ...meta, slot, size: bytes.byteLength };
      await Filesystem.writeFile({
        ...opts,
        path: bin(slot),
        data: toBase64(bytes),
        recursive: true,
      });
      await Filesystem.writeFile({
        ...opts,
        path: json(slot),
        data: JSON.stringify(full),
        encoding: Encoding.UTF8,
        recursive: true,
      });
      return full;
    },
    async delete(slot) {
      for (const path of [json(slot), bin(slot)]) {
        await Filesystem.deleteFile({ ...opts, path }).catch(() => {});
      }
    },
  };
}
