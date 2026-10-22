import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import type { ReplayInfo } from '@ant/sim/replay-format';
import { fromBase64, toBase64 } from '../save/nativeStore';

/** Replays kept automatically; the oldest are dropped past this. */
export const KEEP_REPLAYS = 12;

/** What the replay list shows; stored next to (not inside) the replay bytes. */
export interface ReplayMeta {
  id: string;
  /** `Date.now()` when stored. */
  savedAt: number;
  size: number;
  info: ReplayInfo;
}

/**
 * Persistent storage for replay files, beside (but separate from) the save slots: replays
 * are keyed by id, not a fixed slot. IndexedDB on the web, the app data directory on native.
 */
export interface ReplayStore {
  list(): Promise<ReplayMeta[]>;
  read(id: string): Promise<Uint8Array | null>;
  write(id: string, bytes: Uint8Array, meta: Omit<ReplayMeta, 'id' | 'size'>): Promise<ReplayMeta>;
  delete(id: string): Promise<void>;
}

export const newReplayId = (): string =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const DB_NAME = 'ant-simulator-replays';
const META = 'replay-meta';
const BLOBS = 'replay-blobs';

const wrap = <T>(req: IDBRequest): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });

const done = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });

export function createIdbReplayStore(factory: IDBFactory = indexedDB): ReplayStore {
  let db: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> =>
    (db ??= new Promise((resolve, reject) => {
      const req = factory.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(META);
        req.result.createObjectStore(BLOBS);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        db = null;
        reject(req.error ?? new Error('could not open IndexedDB'));
      };
    }));
  return {
    async list() {
      const tx = (await open()).transaction(META, 'readonly');
      const metas = await wrap<ReplayMeta[]>(tx.objectStore(META).getAll());
      return metas.sort((a, b) => b.savedAt - a.savedAt);
    },
    async read(id) {
      const tx = (await open()).transaction(BLOBS, 'readonly');
      return (await wrap<Uint8Array | undefined>(tx.objectStore(BLOBS).get(id))) ?? null;
    },
    async write(id, bytes, meta) {
      const full: ReplayMeta = { ...meta, id, size: bytes.byteLength };
      const tx = (await open()).transaction([META, BLOBS], 'readwrite');
      tx.objectStore(BLOBS).put(bytes, id);
      tx.objectStore(META).put(full, id);
      await done(tx);
      return full;
    },
    async delete(id) {
      const tx = (await open()).transaction([META, BLOBS], 'readwrite');
      tx.objectStore(BLOBS).delete(id);
      tx.objectStore(META).delete(id);
      await done(tx);
    },
  };
}

const DIR = 'replays';

/** `<id>.bin` + `<id>.json` in the app data directory; the metadata is written last. */
export function createNativeReplayStore(): ReplayStore {
  const opts = { directory: Directory.Data };
  const bin = (id: string): string => `${DIR}/${id}.bin`;
  const json = (id: string): string => `${DIR}/${id}.json`;
  return {
    async list() {
      let files: { name: string }[];
      try {
        files = (await Filesystem.readdir({ ...opts, path: DIR })).files;
      } catch {
        return [];
      }
      const metas: ReplayMeta[] = [];
      for (const f of files) {
        if (!f.name.endsWith('.json')) continue;
        try {
          const r = await Filesystem.readFile({
            ...opts,
            path: `${DIR}/${f.name}`,
            encoding: Encoding.UTF8,
          });
          metas.push(JSON.parse(r.data as string) as ReplayMeta);
        } catch {
          // Unreadable: not listed.
        }
      }
      return metas.sort((a, b) => b.savedAt - a.savedAt);
    },
    async read(id) {
      try {
        const r = await Filesystem.readFile({ ...opts, path: bin(id) });
        return typeof r.data === 'string'
          ? fromBase64(r.data)
          : new Uint8Array(await r.data.arrayBuffer());
      } catch {
        return null;
      }
    },
    async write(id, bytes, meta) {
      const full: ReplayMeta = { ...meta, id, size: bytes.byteLength };
      await Filesystem.writeFile({
        ...opts,
        path: bin(id),
        data: toBase64(bytes),
        recursive: true,
      });
      await Filesystem.writeFile({
        ...opts,
        path: json(id),
        data: JSON.stringify(full),
        encoding: Encoding.UTF8,
        recursive: true,
      });
      return full;
    },
    async delete(id) {
      for (const path of [json(id), bin(id)]) {
        await Filesystem.deleteFile({ ...opts, path }).catch(() => {});
      }
    },
  };
}

let store: ReplayStore | null = null;

export function getReplayStore(): ReplayStore {
  return (store ??= Capacitor.isNativePlatform()
    ? createNativeReplayStore()
    : createIdbReplayStore());
}

/**
 * Store a replay and drop the oldest beyond `keep`. Replays of daily attempts that are
 * still referenced (`protectedIds`) are never dropped.
 */
export async function saveReplay(
  store: ReplayStore,
  bytes: Uint8Array,
  info: ReplayInfo,
  options: { keep?: number; protectedIds?: ReadonlySet<string>; now?: number } = {},
): Promise<ReplayMeta> {
  const meta = await store.write(newReplayId(), bytes, {
    savedAt: options.now ?? Date.now(),
    info,
  });
  const keep = options.keep ?? KEEP_REPLAYS;
  const all = await store.list();
  const extra = all.filter((m) => !options.protectedIds?.has(m.id)).slice(keep);
  for (const m of all.length > keep ? extra : []) await store.delete(m.id);
  return meta;
}
