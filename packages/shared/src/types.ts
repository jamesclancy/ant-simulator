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
  /** Food piles placed at startup. */
  foodSources: number;
  /** Food in each starting pile. */
  foodAmount: number;
  /** Nest entrance radius in world units. */
  nestRadius: number;
  /** Ant steering + foraging tuning. Live-tunable via the `setBehavior` command. */
  behavior: AntBehaviorConfig;
}

/**
 * Foraging behaviour knobs. Distances are world units, angles radians, rates per tick
 * (fixed `tickRate`), pheromone amounts in layer units (layer max is 1).
 * Defaults: `DEFAULT_BEHAVIOR`.
 */
export interface AntBehaviorConfig {
  /** Walking speed, world units per second. */
  speed: number;
  /** Speed multiplier while carrying food. */
  carrySpeedFactor: number;
  /** Angle between the centre sensor and each side sensor. */
  sensorAngle: number;
  /** How far ahead the sensors sample. */
  sensorDistance: number;
  /** Max heading change per tick towards the strongest sensor. */
  turnRate: number;
  /** Uniform random heading noise per tick, +/- this. */
  jitter: number;
  /** Sensor readings below this count as "no trail" (pure wander). */
  trailThreshold: number;
  /** Pheromone laid per tick right after leaving the nest (`home`) or a food pile (`food`). */
  depositHome: number;
  depositFood: number;
  /**
   * Per-tick multiplier on an ant's deposit strength since it last touched the nest/food,
   * so trails are strongest at their source and gradients point back towards it.
   */
  depositDecay: number;
  /** Ants see food piles whose edge is within this distance and head straight for them. */
  foodSenseRadius: number;
  /** Carrying ants within this distance of the nest centre head straight in. */
  nestSenseRadius: number;
  /**
   * Path integration: max heading change per tick pulling carrying ants towards the nest,
   * on top of trail steering. Keeps ants that found food off-trail from getting lost.
   */
  homingBias: number;
  /** Master switch: when false ants neither lay nor follow pheromones (baseline for tests). */
  pheromones: boolean;
}

/** Input accepted by `createSim` / the worker `init` message: everything optional. */
export type SimConfigInput = Partial<Omit<SimConfig, 'behavior'>> & {
  behavior?: Partial<AntBehaviorConfig>;
};

/** Per-ant behaviour state, stored in `AntStore.state`. Steering logic lives elsewhere. */
export const AntState = {
  Wander: 0,
  FollowTrail: 1,
  CarryFood: 2,
  Dig: 3,
  Nurse: 4,
  Fight: 5,
  Flee: 6,
  Recruited: 7,
} as const;
export type AntState = (typeof AntState)[keyof typeof AntState];

export interface FoodInfo {
  id: number;
  x: number;
  y: number;
  radius: number;
  amount: number;
}

export interface NestInfo {
  x: number;
  y: number;
  radius: number;
}

/** Commands flow main thread -> sim. The main thread never mutates sim state directly. */
export type Command =
  | { type: 'spawnAnts'; count: number; x: number; y: number }
  | { type: 'clearAnts' }
  | { type: 'depositPheromone'; pheromone: PheromoneType; x: number; y: number; amount: number }
  /** Clears one layer, or all layers when `pheromone` is omitted. */
  | { type: 'clearPheromones'; pheromone?: PheromoneType }
  | { type: 'placeFood'; x: number; y: number; amount: number }
  | { type: 'removeFood'; id: number }
  /** Live-tune behaviour parameters (merged over the current values). */
  | { type: 'setBehavior'; params: Partial<AntBehaviorConfig> };

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
  /** Interleaved `[x, y, heading, carrying]` per ant, see `ANT_STRIDE`. Transferable. */
  ants: Float32Array;
  /** Present only on some snapshots (every few ticks, or when requested). */
  pheromones?: PheromoneSnapshot;
  /** Live food piles (small; sent every tick). */
  food: FoodInfo[];
  nest: NestInfo;
  /** Food in the colony store. */
  colonyFood: number;
}

/** Main thread -> worker. */
export type WorkerInMessage =
  | { type: 'init'; config: SimConfigInput }
  | { type: 'commands'; commands: Command[] }
  | { type: 'setPaused'; paused: boolean }
  | { type: 'setSpeed'; speed: number }
  /** Scent vision on/off: pheromone data is only snapshotted while enabled. */
  | { type: 'setScentVision'; enabled: boolean };

/** Worker -> main thread. */
export type WorkerOutMessage =
  { type: 'ready'; config: SimConfig } | { type: 'snapshot'; snapshot: Snapshot; speed: number };

export { ANT_STRIDE };
