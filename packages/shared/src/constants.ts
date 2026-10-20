import type { AntBehaviorConfig } from './types';

/** Fixed simulation rate. The renderer interpolates between ticks. */
export const TICK_RATE_HZ = 20;
export const TICK_MS = 1000 / TICK_RATE_HZ;

/** Floats per ant in a snapshot's `ants` buffer: x, y, heading (radians), carrying (food amount). */
export const ANT_STRIDE = 4;

export const DEFAULT_SEED = 1337;
export const DEFAULT_WORLD_SIZE = 2048;
export const DEFAULT_ANT_COUNT = 2000;
export const MAX_ANTS = 20000;

export const SPEED_STEPS = [0.5, 1, 2, 4] as const;

/** Pheromone layers: field resolution (cells per edge) and snapshot cadence. */
export const PHEROMONE_RESOLUTION = 256;
export const PHEROMONE_SNAPSHOT_INTERVAL = 4;
export const DEFAULT_FOOD_SOURCES = 5;
export const DEFAULT_FOOD_AMOUNT = 400;
export const DEFAULT_NEST_RADIUS = 24;
/** Food an ant can carry at once. */
export const ANT_CARRY_CAPACITY = 1;

/** Default foraging behaviour. See `AntBehaviorConfig` for units; tuned at 20Hz. */
export const DEFAULT_BEHAVIOR: Readonly<AntBehaviorConfig> = {
  speed: 40,
  carrySpeedFactor: 0.9,
  sensorAngle: Math.PI / 4,
  sensorDistance: 24,
  turnRate: 0.35,
  jitter: 0.25,
  trailThreshold: 0.002,
  depositHome: 0.05,
  depositFood: 0.12,
  depositDecay: 0.996,
  foodSenseRadius: 30,
  nestSenseRadius: 60,
  homingBias: 0.05,
  pheromones: true,
};
