import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SaveInfo } from '@ant/shared';
import { createIdbStore } from '../src/save/idbStore';
import { SaveController } from '../src/save/controller';
import { fromBase64, toBase64 } from '../src/save/nativeStore';
import type { SaveStore } from '../src/save/store';

const info = (tick: number): SaveInfo => ({
  version: 1,
  tick,
  seed: 7,
  winner: -1,
  populations: [100, 90],
  queensAlive: [true, true],
});

describe('IndexedDB save store', () => {
  let store: SaveStore;
  beforeEach(() => {
    store = createIdbStore(new IDBFactory());
  });

  it('starts empty', async () => {
    expect(await store.list()).toEqual([]);
    expect(await store.read('slot1')).toBeNull();
  });

  it('round-trips bytes and metadata, newest first', async () => {
    const a = Uint8Array.from([1, 2, 3, 250]);
    const b = new Uint8Array(300_000).map((_, i) => i % 251);
    const metaA = await store.write('slot1', a, { savedAt: 1000, info: info(10) });
    await store.write('auto', b, { savedAt: 2000, info: info(20), thumbnail: 'data:x' });
    expect(metaA).toMatchObject({ slot: 'slot1', size: 4 });
    expect(await store.read('slot1')).toEqual(a);
    expect(await store.read('auto')).toEqual(b);
    const list = await store.list();
    expect(list.map((m) => m.slot)).toEqual(['auto', 'slot1']);
    expect(list[0]).toMatchObject({ savedAt: 2000, size: 300_000, thumbnail: 'data:x' });
    expect(list[0]!.info.populations).toEqual([100, 90]);
  });

  it('overwrites a slot and deletes it', async () => {
    await store.write('slot2', Uint8Array.from([1]), { savedAt: 1, info: info(1) });
    await store.write('slot2', Uint8Array.from([9, 9]), { savedAt: 2, info: info(2) });
    expect(await store.read('slot2')).toEqual(Uint8Array.from([9, 9]));
    expect(await store.list()).toHaveLength(1);
    await store.delete('slot2');
    expect(await store.list()).toEqual([]);
    expect(await store.read('slot2')).toBeNull();
  });

  it('persists across store instances sharing a database', async () => {
    const factory = new IDBFactory();
    await createIdbStore(factory).write('slot3', Uint8Array.from([5]), {
      savedAt: 1,
      info: info(3),
    });
    expect(await createIdbStore(factory).read('slot3')).toEqual(Uint8Array.from([5]));
  });
});

describe('native store helpers', () => {
  it('base64 round-trips arbitrary bytes, including large ones', () => {
    const bytes = new Uint8Array(200_000).map((_, i) => (i * 31) & 255);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });
});

describe('SaveController', () => {
  it('saves from and loads into the sim', async () => {
    let loaded: Uint8Array | null = null;
    const sim = {
      save: () => Promise.resolve({ bytes: Uint8Array.from([4, 5, 6]), info: info(42) }),
      load: (bytes: Uint8Array) => {
        loaded = bytes;
        return Promise.resolve({} as never);
      },
    };
    let now = 100;
    const c = new SaveController(sim, createIdbStore(new IDBFactory()), () => now++);
    expect(await c.hasSave()).toBe(false);
    expect(await c.load('slot1')).toBe(false);
    expect(await c.loadLatest()).toBe(false);

    await c.save('slot1');
    await c.save('auto');
    expect(await c.hasSave()).toBe(true);
    expect((await c.list()).map((m) => [m.slot, m.savedAt])).toEqual([
      ['auto', 101],
      ['slot1', 100],
    ]);
    expect(await c.loadLatest()).toBe(true);
    expect(loaded).toEqual(Uint8Array.from([4, 5, 6]));
  });

  it('propagates a rejected load', async () => {
    const store = createIdbStore(new IDBFactory());
    await store.write('slot1', Uint8Array.from([0]), { savedAt: 1, info: info(1) });
    const c = new SaveController(
      {
        save: () => Promise.reject(new Error('x')),
        load: () => Promise.reject(new Error('bad save')),
      },
      store,
    );
    await expect(c.load('slot1')).rejects.toThrow('bad save');
    await expect(c.save('slot2')).rejects.toThrow('x');
  });
});
