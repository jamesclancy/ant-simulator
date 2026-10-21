import { Capacitor } from '@capacitor/core';
import { createIdbStore } from './idbStore';
import { createNativeStore } from './nativeStore';
import { SaveController } from './controller';
import type { SimClient } from '../simClient';
import type { SaveStore } from './store';

export { SaveController } from './controller';
export { MANUAL_SLOTS, SLOTS } from './store';
export type { SaveMeta, SaveSlot, SaveStore } from './store';

let store: SaveStore | null = null;

/** IndexedDB in browsers, the app data directory under Capacitor. */
export function getSaveStore(): SaveStore {
  return (store ??= Capacitor.isNativePlatform() ? createNativeStore() : createIdbStore());
}

let controller: SaveController | null = null;

/** Called once by the app after the sim worker exists; enables `loadLatest`. */
export function bindSaves(sim: SimClient): SaveController {
  return (controller = new SaveController(sim, getSaveStore()));
}

/** Is there any save (autosave or manual) to continue from? Safe to call before `bindSaves`. */
export async function hasSave(): Promise<boolean> {
  try {
    return await (controller?.hasSave() ??
      getSaveStore()
        .list()
        .then((l) => l.length > 0));
  } catch {
    return false;
  }
}

/** Resume the most recent save. False if there is none; throws if the save can't be loaded. */
export async function loadLatest(): Promise<boolean> {
  if (!controller) throw new Error('saves are not bound to a sim yet');
  return controller.loadLatest();
}
