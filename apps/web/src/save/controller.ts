import type { SimClient } from '../simClient';
import type { SaveMeta, SaveSlot, SaveStore } from './store';

/** Saves and loads games between the sim worker and a `SaveStore`. */
export class SaveController {
  constructor(
    private readonly sim: Pick<SimClient, 'save' | 'load'>,
    private readonly store: SaveStore,
    private readonly now: () => number = Date.now,
  ) {}

  list(): Promise<SaveMeta[]> {
    return this.store.list();
  }

  async hasSave(): Promise<boolean> {
    return (await this.store.list()).length > 0;
  }

  /** Snapshot the running game into `slot`. */
  async save(slot: SaveSlot, thumbnail?: string): Promise<SaveMeta> {
    const { bytes, info } = await this.sim.save();
    return this.store.write(slot, bytes, {
      savedAt: this.now(),
      info,
      ...(thumbnail ? { thumbnail } : {}),
    });
  }

  /** Resume the game in `slot`. Resolves false when the slot is empty; rejects on a bad save. */
  async load(slot: SaveSlot): Promise<boolean> {
    const bytes = await this.store.read(slot);
    if (!bytes) return false;
    await this.sim.load(bytes);
    return true;
  }

  /** Resume the most recently written slot (autosave included). */
  async loadLatest(): Promise<boolean> {
    const [latest] = await this.store.list();
    return latest ? this.load(latest.slot) : false;
  }
}
