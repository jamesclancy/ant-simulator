import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PHEROMONE_SNAPSHOT_INTERVAL } from '@ant/shared';
import type { WorkerInMessage, WorkerOutMessage } from '@ant/shared';
import { runSimWorker } from '../src/worker';
import type { WorkerScope } from '../src/worker';

const TICK_MS = 50; // tickRate 20

function setup() {
  const posted: { message: WorkerOutMessage; transfer?: Transferable[] }[] = [];
  const scope: WorkerScope = {
    postMessage: (message: WorkerOutMessage, transfer?: Transferable[]) => {
      posted.push(transfer ? { message, transfer } : { message });
    },
    onmessage: null,
  };
  runSimWorker(scope);
  const send = (data: WorkerInMessage) => scope.onmessage?.({ data });
  const snapshots = () => posted.flatMap((p) => (p.message.type === 'snapshot' ? [p.message] : []));
  return { posted, send, snapshots };
}

describe('sim worker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('replies to init with ready + an initial snapshot', () => {
    const { posted, send } = setup();
    send({ type: 'init', config: { seed: 1, initialAnts: 10, tickRate: 20 } });
    expect(posted[0]?.message).toMatchObject({ type: 'ready', config: { seed: 1 } });
    const snap = posted[1]?.message;
    expect(snap).toMatchObject({ type: 'snapshot', speed: 1, snapshot: { tick: 0, antCount: 10 } });
    // Ant, recruit-index and (first snapshot only) nest-grid buffers are transferred, not copied.
    expect(posted[1]?.transfer).toHaveLength(3);
  });

  it('advances ticks with wall-clock time, scaled by speed', () => {
    const { send, snapshots } = setup();
    send({ type: 'init', config: { initialAnts: 1, tickRate: 20 } });
    vi.advanceTimersByTime(TICK_MS * 10);
    const tickAt1x = snapshots().at(-1)!.snapshot.tick;
    expect(tickAt1x).toBeGreaterThanOrEqual(8);
    expect(tickAt1x).toBeLessThanOrEqual(10);

    send({ type: 'setSpeed', speed: 4 });
    vi.advanceTimersByTime(TICK_MS * 10);
    const tickAt4x = snapshots().at(-1)!.snapshot.tick - tickAt1x;
    expect(tickAt4x).toBeGreaterThanOrEqual(36);
    expect(tickAt4x).toBeLessThanOrEqual(40);
  });

  it('does not step while paused, but applies commands immediately', () => {
    const { send, snapshots } = setup();
    send({ type: 'init', config: { initialAnts: 5, tickRate: 20 } });
    send({ type: 'setPaused', paused: true });
    const pausedAt = snapshots().at(-1)!;
    expect(pausedAt.speed).toBe(0);

    vi.advanceTimersByTime(TICK_MS * 20);
    expect(snapshots().at(-1)!.snapshot.tick).toBe(pausedAt.snapshot.tick);

    send({ type: 'commands', commands: [{ type: 'clearAnts' }] });
    const after = snapshots().at(-1)!.snapshot;
    expect(after.antCount).toBe(0);
    expect(after.tick).toBe(pausedAt.snapshot.tick);
  });

  it('queues commands while running and applies them on the next tick', () => {
    const { send, snapshots } = setup();
    send({ type: 'init', config: { initialAnts: 5, tickRate: 20 } });
    send({ type: 'commands', commands: [{ type: 'spawnAnts', count: 3, x: 10, y: 10 }] });
    expect(snapshots().at(-1)!.snapshot.antCount).toBe(5);
    vi.advanceTimersByTime(TICK_MS * 2);
    expect(snapshots().at(-1)!.snapshot.antCount).toBe(8);
  });

  it('only includes pheromones while scent vision is on, at the snapshot interval', () => {
    const { send, snapshots } = setup();
    send({ type: 'init', config: { initialAnts: 5, tickRate: 20, pheromoneResolution: 8 } });
    vi.advanceTimersByTime(TICK_MS * 10);
    expect(snapshots().some((s) => s.snapshot.pheromones)).toBe(false);

    const before = snapshots().length;
    send({ type: 'setScentVision', enabled: true });
    vi.advanceTimersByTime(TICK_MS * 20);
    const withScent = snapshots()
      .slice(before)
      .filter((s) => s.snapshot.pheromones);
    // First snapshot after enabling carries scent, then roughly every interval.
    expect(snapshots()[before]?.snapshot.pheromones).toBeDefined();
    expect(withScent.length).toBeGreaterThanOrEqual(20 / PHEROMONE_SNAPSHOT_INTERVAL - 1);
    expect(withScent.length).toBeLessThanOrEqual(20 / PHEROMONE_SNAPSHOT_INTERVAL + 1);
    const scent = withScent[0]!.snapshot.pheromones!;
    expect(scent.data.length).toBe(scent.types.length * 8 * 8);
  });

  it('caps catch-up after a long stall instead of spiralling', () => {
    const { send, snapshots } = setup();
    send({ type: 'init', config: { initialAnts: 1, tickRate: 20 } });
    vi.setSystemTime(Date.now() + 60_000);
    vi.advanceTimersByTime(5);
    // dt is clamped to 250ms and at most 8 ticks run per loop iteration.
    expect(snapshots().at(-1)!.snapshot.tick).toBeLessThanOrEqual(8);
  });
});
