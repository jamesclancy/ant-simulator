import type {
  AntBehaviorConfig,
  AntlionConfig,
  ColonyConfig,
  CombatConfig,
  PheromoneType,
  RainConfig,
  SpiderConfig,
} from './types';

/** Fixed simulation rate. The renderer interpolates between ticks. */
export const TICK_RATE_HZ = 20;
export const TICK_MS = 1000 / TICK_RATE_HZ;

/**
 * Floats per ant in a snapshot's `ants` buffer: x, y, heading (radians), carrying
 * (>0 food amount, <0 dirt), layer, flags. `layer` is 0 on the surface and `1 + c` inside
 * colony `c`'s nest (see `undergroundLayer`); underground x/y are in nest-grid world units
 * (`NEST_TILE` per tile), not surface units. `flags` packs colony, caste and fighting, see
 * `packAntFlags`.
 */
export const ANT_STRIDE = 6;
/** Offset of the layer value inside one ant's snapshot record. */
export const ANT_LAYER_OFFSET = 4;
/** Offset of the packed colony/caste/fighting flags inside one ant's snapshot record. */
export const ANT_FLAGS_OFFSET = 5;

/** Ant layer value for "underground in colony `colony`'s nest". The surface is 0. */
export function undergroundLayer(colony: number): number {
  return 1 + colony;
}

/** Snapshot flags: bits 0-1 colony, bits 2-3 caste, bit 4 fighting. */
export function packAntFlags(colony: number, caste: number, fighting: boolean): number {
  return colony | (caste << 2) | (fighting ? 16 : 0);
}
export const flagColony = (flags: number): number => flags & 3;
export const flagCaste = (flags: number): number => (flags >> 2) & 3;
export const flagFighting = (flags: number): boolean => (flags & 16) !== 0;

/** Colony ids. The player's (black) colony is always 0. */
export const PLAYER_COLONY = 0;
export const RED_COLONY = 1;

/** Underground nest grid: tiles per edge and world units per tile (side view, row 0 = surface). */
export const NEST_GRID_W = 96;
export const NEST_GRID_H = 64;
export const NEST_TILE = 12;

export const DEFAULT_SEED = 1337;
export const DEFAULT_WORLD_SIZE = 2048;
/** Ants spawned per colony at startup. */
export const DEFAULT_ANT_COUNT = 500;
export const DEFAULT_COLONY_COUNT = 2;
export const MAX_ANTS = 20000;

export const SPEED_STEPS = [0.5, 1, 2, 4] as const;
/** Sandbox games add 8x. */
export const SANDBOX_SPEED_STEPS = [0.5, 1, 2, 4, 8] as const;

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
  casteRatio: { worker: 0.85, soldier: 0.15, breeder: 0 },
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

/** Combat defaults. HP in hit points, damage per tick at 20Hz, distances in world units. */
export const DEFAULT_COMBAT: Readonly<CombatConfig> = {
  contactRange: 6,
  workerEngageRange: 14,
  soldierEngageRange: 32,
  hp: [10, 20, 10],
  damage: [0.15, 0.35, 0.05],
  playerDamage: 0.5,
  queenHp: 1500,
  corpseFood: 2,
  alarmDeposit: 0.5,
  alarmThreshold: 0.02,
  presenceDeposit: 0.01,
  patrolRadius: 360,
  scoutRadius: 220,
  threatRadius: 420,
};

/** Per-layer pheromone defaults: `evaporation` and `diffusion` per tick (see the sim's `PheromoneLayerConfig`). */
export const DEFAULT_PHEROMONE_LAYERS: Readonly<
  Record<PheromoneType, { evaporation: number; diffusion: number; max: number }>
> = {
  food: { evaporation: 0.006, diffusion: 0.08, max: 1 },
  home: { evaporation: 0.01, diffusion: 0.05, max: 1 },
  alarm: { evaporation: 0.01, diffusion: 0.4, max: 1 },
  enemy: { evaporation: 0.01, diffusion: 0.1, max: 1 },
};

/** Spider defaults: roughly a 3-soldier / 12-worker mob to bring one down. */
export const DEFAULT_SPIDER: Readonly<SpiderConfig> = {
  hp: 120,
  huntSpeed: 1.3,
  biteRange: 9,
  eatTicks: 30,
  contactRange: 14,
  damage: [0.12, 0.4, 0.04],
  senseRadius: 110,
  leash: 600,
  retreatFraction: 0.3,
  regen: 0.05,
  fleeRadius: 70,
  mobRadius: 110,
  mobSize: 8,
  soldierMobWeight: 3,
  alarmDeposit: 0.3,
  foodDrop: 160,
  respawnTicks: 2400,
};

export const DEFAULT_SPIDER_COUNT = 1;

/** Antlion pit: a few workers or two soldiers walking in together can overwhelm it. */
export const DEFAULT_ANTLION: Readonly<AntlionConfig> = {
  radius: 46,
  killRadius: 7,
  pull: 1.5,
  escape: 0.012,
  soldierEscape: 3,
  playerEscape: 3,
  crowdEscape: 0.15,
  hp: 90,
  mobSize: 10,
  soldierMobWeight: 3,
  damage: [0.15, 0.4, 0.05],
  foodDrop: 100,
};

export const DEFAULT_ANTLION_COUNT = 2;

/** Rain: a shower every 3-6 minutes lasting 35-70 seconds. */
export const DEFAULT_RAIN: Readonly<RainConfig> = {
  enabled: true,
  minGap: 3600,
  maxGap: 7200,
  minDuration: 700,
  maxDuration: 1400,
  warningTicks: 200,
  rampTicks: 100,
  evaporationMult: 8,
  surfaceSpeed: 0.7,
  inflow: 0.5,
  flow: 0.25,
  seep: 0.0015,
  drain: 0.002,
  drownLevel: 0.3,
  drownDamage: 0.1,
  broodLevel: 0.25,
  broodKill: 0.003,
};
