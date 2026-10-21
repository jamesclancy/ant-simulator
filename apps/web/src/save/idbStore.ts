import type { SaveMeta, SaveSlot, SaveStore } from './store';

const DB_NAME = 'ant-simulator';
const META = 'save-meta';
const BLOBS = 'save-blobs';

function wrap<T>(req: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/**
 * Saves in IndexedDB. Metadata and blobs live in separate object stores, so listing slots
 * never loads the (hundreds of KB) blobs. A slot's two records are written in one
 * transaction, so a crash can't leave a slot with mismatched halves.
 */
export function createIdbStore(factory: IDBFactory = indexedDB): SaveStore {
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
      const metas = await wrap<SaveMeta[]>(tx.objectStore(META).getAll());
      return metas.sort((a, b) => b.savedAt - a.savedAt);
    },
    async read(slot) {
      const tx = (await open()).transaction(BLOBS, 'readonly');
      const bytes = await wrap<Uint8Array | undefined>(tx.objectStore(BLOBS).get(slot));
      return bytes ?? null;
    },
    async write(slot, bytes, meta) {
      const full: SaveMeta = { ...meta, slot, size: bytes.byteLength };
      const tx = (await open()).transaction([META, BLOBS], 'readwrite');
      tx.objectStore(BLOBS).put(bytes, slot);
      tx.objectStore(META).put(full, slot);
      await done(tx);
      return full;
    },
    async delete(slot: SaveSlot) {
      const tx = (await open()).transaction([META, BLOBS], 'readwrite');
      tx.objectStore(BLOBS).delete(slot);
      tx.objectStore(META).delete(slot);
      await done(tx);
    },
  };
}
