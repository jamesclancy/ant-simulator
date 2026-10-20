import { ANT_STRIDE } from './constants';

/** Pheromone layer names. Index in this list is the layer id. */
export const PHEROMONE_TYPES = ['food', 'home', 'alarm', 'enemy'] as const;
export type PheromoneType = (typeof PHEROMONE_TYPES)[number];

export interface SimConfig {
  /** PRNG seed. Same seed + same commands => identical snapshots. */
  seed: number;
  /** Square world edge length in world units. */
  worldSize: number;
  /** Ants spawned at startup. */
  initialAnts: number;
  /** Fixed ticks per second. */
  tickRate: number;
  /** Pheromone grid cells per world edge (cell size = worldSize / resolution). */
  pheromoneResolution: number;
}

/** Commands flow main thread -> sim. The main thread never mutates sim state directly. */
export type Command =
  | { type: 'spawnAnts'; count: number; x: number; y: number }
  | { type: 'clearAnts' }
  | { type: 'depositPheromone'; pheromone: PheromoneType; x: number; y: number; amount: number }
  /** Clears one layer, or all layers when `pheromone` is omitted. */
  | { type: 'clearPheromones'; pheromone?: PheromoneType };

/** Quantized pheromone layers, `layers.length * resolution^2` bytes, layer-major then row-major. */
export interface PheromoneSnapshot {
  resolution: number;
  /** Layer order inside `data`. */
  types: PheromoneType[];
  /** 0..255 intensity per cell (sqrt-compressed, see `PheromoneField.quantize`). Transferable. */
  data: Uint8Array;
}

export interface Snapshot {
  tick: number;
  antCount: number;
  /** Interleaved `[x, y, heading]` per ant, see `ANT_STRIDE`. Transferable. */
  ants: Float32Array;
  /** Present only on some snapshots (every few ticks, or when requested). */
  pheromones?: PheromoneSnapshot;
}

/** Main thread -> worker. */
export type WorkerInMessage =
  | { type: 'init'; config: Partial<SimConfig> }
  | { type: 'commands'; commands: Command[] }
  | { type: 'setPaused'; paused: boolean }
  | { type: 'setSpeed'; speed: number }
  /** Scent vision on/off: pheromone data is only snapshotted while enabled. */
  | { type: 'setScentVision'; enabled: boolean };

/** Worker -> main thread. */
export type WorkerOutMessage =
  { type: 'ready'; config: SimConfig } | { type: 'snapshot'; snapshot: Snapshot; speed: number };

export { ANT_STRIDE };
