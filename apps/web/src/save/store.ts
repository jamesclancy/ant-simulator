import type { SaveInfo } from '@ant/shared';

export const SLOTS = ['auto', 'slot1', 'slot2', 'slot3'] as const;
export type SaveSlot = (typeof SLOTS)[number];
export const MANUAL_SLOTS = ['slot1', 'slot2', 'slot3'] as const;

export function isSlot(v: string): v is SaveSlot {
  return (SLOTS as readonly string[]).includes(v);
}

/** What a slot list shows; stored next to (not inside) the save bytes. */
export interface SaveMeta {
  slot: SaveSlot;
  /** `Date.now()` when written. */
  savedAt: number;
  /** Size of the save blob in bytes. */
  size: number;
  info: SaveInfo;
  /** Optional PNG/JPEG data URL. */
  thumbnail?: string;
}

/**
 * Persistent storage for save blobs. One implementation per platform (IndexedDB on the
 * web, the app's data directory on native); all methods are async and slot-keyed.
 */
export interface SaveStore {
  list(): Promise<SaveMeta[]>;
  read(slot: SaveSlot): Promise<Uint8Array | null>;
  write(
    slot: SaveSlot,
    bytes: Uint8Array,
    meta: Omit<SaveMeta, 'slot' | 'size'>,
  ): Promise<SaveMeta>;
  delete(slot: SaveSlot): Promise<void>;
}
