import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSim, ReplayRecorder } from '@ant/sim';
import { GameArchive, MIN_REPLAY_TICKS } from '../src/replay/archive';
import { createIdbReplayStore, saveReplay, type ReplayStore } from '../src/replay/store';
import { DailyStore } from '../src/daily/history';
import { decodeReplay, replayInfo } from '@ant/sim/replay-format';

function recorded(ticks: number): Uint8Array {
  const sim = createSim({ seed: 3, initialAnts: 10 });
  const rec = new ReplayRecorder(sim, { mode: 'quick' });
  for (let i = 0; i < ticks; i++) {
    sim.step();
    rec.afterStep(sim);
  }
  return rec.encode(sim);
}

const mem = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
};

describe('replay store', () => {
  let store: ReplayStore;
  beforeEach(() => {
    store = createIdbReplayStore(new IDBFactory());
  });

  it('keeps only the newest replays, sparing protected ones', async () => {
    const bytes = recorded(20);
    const info = replayInfo(decodeReplay(bytes));
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const protectedIds = new Set(ids.slice(0, 1));
      ids.push((await saveReplay(store, bytes, info, { keep: 3, now: i, protectedIds })).id);
    }
    const left = (await store.list()).map((m) => m.id);
    // Newest three plus the protected oldest.
    expect(left.sort()).toEqual([ids[0]!, ids[2]!, ids[3]!, ids[4]!].sort());
    expect(await store.read(ids[1]!)).toBeNull();
    expect(await store.read(ids[4]!)).toEqual(bytes);
  });
});

describe('game archive', () => {
  it('stores the replay and finishes the daily attempt once', async () => {
    const store = createIdbReplayStore(new IDBFactory());
    const daily = new DailyStore(mem());
    const attempt = daily.begin('2026-10-22');
    let requests = 0;
    const archive = new GameArchive(
      {
        getReplay: () => {
          requests++;
          return Promise.resolve(recorded(MIN_REPLAY_TICKS));
        },
      },
      store,
      daily,
    );
    archive.begin({ date: '2026-10-22', n: attempt.n });
    const result = await archive.end({ tick: 5000, winner: 0, population: 321 });
    expect(result.replayId).toBeDefined();
    expect(result.attempt).toMatchObject({ outcome: 'victory', ticks: 5000, population: 321 });
    expect(daily.attempts('2026-10-22')[0]?.replayId).toBe(result.replayId);
    expect(await store.list()).toHaveLength(1);
    // A second end (quit after game over) does nothing.
    expect(await archive.end({ tick: 6000, winner: 0, population: 1 })).toEqual({});
    expect(requests).toBe(1);
  });

  it('skips the replay of a tiny game but still records a quit attempt', async () => {
    const store = createIdbReplayStore(new IDBFactory());
    const daily = new DailyStore(mem());
    const archive = new GameArchive(
      { getReplay: () => Promise.reject(new Error('no')) },
      store,
      daily,
    );
    const a = daily.begin('2026-10-22');
    archive.begin({ date: '2026-10-22', n: a.n });
    const result = await archive.end({ tick: 50, winner: -1, population: 10 });
    expect(result.replayId).toBeUndefined();
    expect(result.attempt?.outcome).toBe('quit');
    expect(await store.list()).toEqual([]);
  });

  it('survives a worker that has no replay', async () => {
    const store = createIdbReplayStore(new IDBFactory());
    const archive = new GameArchive(
      { getReplay: () => Promise.reject(new Error('campaign')) },
      store,
      new DailyStore(mem()),
    );
    archive.begin();
    expect(await archive.end({ tick: 5000, winner: -1, population: 10 })).toEqual({});
  });
});
