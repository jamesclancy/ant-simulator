import { ANT_STRIDE } from './constants';

export interface SimConfig {
  /** PRNG seed. Same seed + same commands => identical snapshots. */
  seed: number;
  /** Square world edge length in world units. */
  worldSize: number;
  /** Ants spawned at startup. */
  initialAnts: number;
  /** Fixed ticks per second. */
  tickRate: number;
}

/** Commands flow main thread -> sim. The main thread never mutates sim state directly. */
export type Command =
  { type: 'spawnAnts'; count: number; x: number; y: number } | { type: 'clearAnts' };

export interface Snapshot {
  tick: number;
  antCount: number;
  /** Interleaved `[x, y, heading]` per ant, see `ANT_STRIDE`. Transferable. */
  ants: Float32Array;
}

/** Main thread -> worker. */
export type WorkerInMessage =
  | { type: 'init'; config: Partial<SimConfig> }
  | { type: 'commands'; commands: Command[] }
  | { type: 'setPaused'; paused: boolean }
  | { type: 'setSpeed'; speed: number };

/** Worker -> main thread. */
export type WorkerOutMessage =
  { type: 'ready'; config: SimConfig } | { type: 'snapshot'; snapshot: Snapshot; speed: number };

export { ANT_STRIDE };
