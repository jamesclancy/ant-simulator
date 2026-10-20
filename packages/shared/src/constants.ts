import type { AntBehaviorConfig, ColonyConfig } from './types';

/** Fixed simulation rate. The renderer interpolates between ticks. */
export const TICK_RATE_HZ = 20;
export const TICK_MS = 1000 / TICK_RATE_HZ;

/**
 * Floats per ant in a snapshot's `ants` buffer: x, y, heading (radians), carrying
 * (>0 food amount, <0 dirt), layer (0 surface, 1 underground). Underground x/y are in
 * nest-grid world units (`NEST_TILE` per tile), not surface units.
 */
export const ANT_STRIDE = 5;
/** Offset of the layer value inside one ant's snapshot record. */
export const ANT_LAYER_OFFSET = 4;

/** Underground nest grid: tiles per edge and world units per tile (side view, row 0 = surface). */
export const NEST_GRID_W = 96;
export const NEST_GRID_H = 64;
export const NEST_TILE = 12;

export const DEFAULT_SEED = 1337;
export const DEFAULT_WORLD_SIZE = 2048;
export const DEFAULT_ANT_COUNT = 500;
export const MAX_ANTS = 20000;

export const SPEED_STEPS = [0.5, 1, 2, 4] as const;

/** Pheromone layers: field resolution (cells per edge) and snapshot cadence. */
export const PHEROMONE_RESOLUTION = 256;
export const PHEROMONE_SNAPSHOT_INTERVAL = 4;
export const DEFAULT_FOOD_SOURCES = 5;
export const DEFAULT_FOOD_AMOUNT = 1500;
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

/** Colony economy defaults. Durations are ticks at 20Hz; rates are per tick. */
export const DEFAULT_COLONY: Readonly<ColonyConfig> = {
  behaviorRatio: { forage: 0.6, dig: 0.2, nurse: 0.2 },
  casteRatio: { worker: 1, soldier: 0, breeder: 0 },
  startFood: 30,
  eggCost: 1,
  maxLayRate: 1 / 12,
  layFoodTarget: 30,
  broodPerTile: 2,
  eggTicks: 200,
  larvaTicks: 400,
  pupaTicks: 300,
  larvaFeedRate: 0.0004,
  nurseBoost: 1.5,
  nursesPerBrood: 0.25,
  upkeepPerAnt: 0.0001,
  queenUpkeep: 0.002,
  starveRate: 0.0001,
  queenStarveTicks: 1200,
  digCost: 60,
  digMaxWorkers: 6,
  maxOpenFraction: 0.3,
  undergroundSpeedFactor: 1,
};
