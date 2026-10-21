import { ANT_STRIDE } from './constants';

/** Pheromone layer names. Index in this list is the layer id. */
export const PHEROMONE_TYPES = ['food', 'home', 'alarm', 'enemy'] as const;
export type PheromoneType = (typeof PHEROMONE_TYPES)[number];

export interface SimConfig {
  /** PRNG seed. Same seed + same commands => identical snapshots. */
  seed: number;
  /** Square world edge length in world units. */
  worldSize: number;
  /** Ants spawned per colony at startup. */
  initialAnts: number;
  /**
   * Colonies on the map: 2 (default) = black player colony vs red AI colony in opposite
   * corners; 1 = the player's colony alone with its nest at the world centre.
   */
  colonies: number;
  /** Red colony AI strength. */
  difficulty: Difficulty;
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
  /** Colony economy + nest tuning. */
  colony: ColonyConfig;
  combat: CombatConfig;
}

export type Difficulty = 'easy' | 'normal' | 'hard';

/** Ant castes; value is stored in `ants.caste` and indexes per-caste tables. */
export const Caste = { Worker: 0, Soldier: 1, Breeder: 2 } as const;
export type Caste = (typeof Caste)[keyof typeof Caste];

/**
 * Combat tuning. Distances are world units (the same values apply in nest-grid units
 * underground), damage is HP per tick at the fixed tick rate. Per-caste tables are
 * indexed by `Caste`.
 */
export interface CombatConfig {
  /** Ants this close to an enemy fight it (and stand still). */
  contactRange: number;
  /** Idle workers walk towards enemies within this distance. */
  workerEngageRange: number;
  /** Soldiers walk towards enemies within this distance. */
  soldierEngageRange: number;
  hp: [number, number, number];
  damage: [number, number, number];
  /** Damage dealt by the player ant. */
  playerDamage: number;
  queenHp: number;
  /** Food left on the ground by an ant killed in combat. */
  corpseFood: number;
  /** `alarm` pheromone laid per tick by a fighting ant (its own colony's layer). */
  alarmDeposit: number;
  /** Alarm sensor readings at or above this pull idle ants in. */
  alarmThreshold: number;
  /** `enemy` scent each surface ant leaves per tick in the other colonies' fields. */
  presenceDeposit: number;
  /** Patrolling (non-raiding) soldiers stay within this distance of their nest. */
  patrolRadius: number;
  /** An ant this close to an enemy nest reveals it ("scouted"). */
  scoutRadius: number;
  /** Enemy ants this close to a nest count as a threat (AI director). */
  threatRadius: number;
}

/** Fractions of the (worker) population assigned to each job. Normalised on use. */
export interface BehaviorRatio {
  forage: number;
  dig: number;
  nurse: number;
}

/** Caste mix for newly emerging adults (normalised on use). Breeders stay in the nest for now. */
export interface CasteRatio {
  worker: number;
  soldier: number;
  breeder: number;
}

/** Ant jobs; value is the index into `ants.role` and `BehaviorRatio` order. */
export const AntRole = { Forage: 0, Dig: 1, Nurse: 2 } as const;
export type AntRole = (typeof AntRole)[keyof typeof AntRole];

/** Underground tile kinds. Row 0 is the surface line (`Air`) with one `Tunnel` entrance tile. */
export const TileType = { Soil: 0, Tunnel: 1, Chamber: 2, Rock: 3, Air: 4 } as const;
export type TileType = (typeof TileType)[keyof typeof TileType];

/** What a `Chamber` tile is used for. Queen and Nursery chambers hold brood. */
export const ChamberKind = { None: 0, Queen: 1, Food: 2, Nursery: 3 } as const;
export type ChamberKind = (typeof ChamberKind)[keyof typeof ChamberKind];

/** Colony economy knobs (ticks at `tickRate`; rates are per tick). Defaults: `DEFAULT_COLONY`. */
export interface ColonyConfig {
  behaviorRatio: BehaviorRatio;
  casteRatio: CasteRatio;
  /** Food in the colony store at start. */
  startFood: number;
  /** Food consumed by laying one egg. */
  eggCost: number;
  /** Eggs per tick when the store is at or above `layFoodTarget` (scales down linearly below). */
  maxLayRate: number;
  layFoodTarget: number;
  /** Brood capacity per queen/nursery chamber tile. */
  broodPerTile: number;
  eggTicks: number;
  larvaTicks: number;
  pupaTicks: number;
  /** Food eaten per larva per tick; larvae stall while the store is empty. */
  larvaFeedRate: number;
  /** Extra development speed (multiplier - 1) with full nursing. */
  nurseBoost: number;
  /** Tending nurses per brood item needed for full nursing. */
  nursesPerBrood: number;
  upkeepPerAnt: number;
  queenUpkeep: number;
  /** Fraction of ants dying per tick while the store is empty. */
  starveRate: number;
  /** Ticks of empty store before the queen starves. */
  queenStarveTicks: number;
  /** Digger-ticks needed to dig one soil tile. */
  digCost: number;
  /** Max diggers that contribute at the face per tick. */
  digMaxWorkers: number;
  /** Digging stops when this fraction of the grid is open. */
  maxOpenFraction: number;
  undergroundSpeedFactor: number;
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
export type SimConfigInput = Partial<Omit<SimConfig, 'behavior' | 'colony' | 'combat'>> & {
  behavior?: Partial<AntBehaviorConfig>;
  colony?: Partial<ColonyConfig>;
  combat?: Partial<CombatConfig>;
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
  /** Spawn surface ants at a point; `colony` defaults to 0, `caste` to worker. */
  | { type: 'spawnAnts'; count: number; x: number; y: number; colony?: number; caste?: Caste }
  | { type: 'clearAnts' }
  /** Deposit into colony `colony`'s field (default 0, the player's). */
  | {
      type: 'depositPheromone';
      pheromone: PheromoneType;
      x: number;
      y: number;
      amount: number;
      colony?: number;
    }
  /** Clears one layer, or all layers when `pheromone` is omitted, in every colony's field. */
  | { type: 'clearPheromones'; pheromone?: PheromoneType }
  | { type: 'placeFood'; x: number; y: number; amount: number }
  | { type: 'removeFood'; id: number }
  /** Live-tune behaviour parameters (merged over the current values). */
  | { type: 'setBehavior'; params: Partial<AntBehaviorConfig> }
  /** Walk the player ant to a world point (stops on arrival). Clears any held direction. */
  | { type: 'playerMoveTo'; x: number; y: number }
  /** Hold a direction (joystick / WASD); magnitude 0..1 scales speed. Zero stops it. */
  | { type: 'playerMoveDir'; dx: number; dy: number }
  | { type: 'playerToggleTrail'; on: boolean }
  /** Pick up food from a nearby pile, or drop what is carried (at the nest: into the colony store). */
  | { type: 'playerPickupDrop' }
  /** Recruit the nearest idle ants to follow the player. */
  | { type: 'playerRecruit'; count: 5 | 10 }
  /** Release all recruited ants back to normal foraging. */
  | { type: 'playerRelease' }
  /** Set the forage/dig/nurse allocation (normalised). `colony` defaults to 0 (the player's). */
  | ({ type: 'setBehaviorRatio'; colony?: number } & BehaviorRatio)
  | ({ type: 'setCasteRatio'; colony?: number } & CasteRatio)
  /** Raid mode: the colony's soldiers follow enemy scent to the enemy nest and attack the queen. */
  | { type: 'setRaid'; colony?: number; on: boolean };

/** One-shot notifications from the sim, delivered in the snapshot of the tick they happened. */
export type SimEvent =
  | { type: 'playerSwapped'; from: number; to: number }
  /** A colony's queen died. When only one colony is left standing, `gameOver` follows. */
  | { type: 'queenKilled'; colony: number; cause: 'combat' | 'starvation' }
  /** The game ended; the sim stops stepping. `winner` is -2 if no colony is left. */
  | { type: 'gameOver'; winner: number };

/** The player-controlled (yellow) ant. */
export interface PlayerInfo {
  /** Index into the snapshot `ants` buffer. */
  index: number;
  x: number;
  y: number;
  heading: number;
  carrying: number;
  trail: boolean;
  /** Number of ants currently following the player. */
  recruits: number;
  /** Ant indices of the recruited ants (length === recruits). Transferable. */
  recruitedIndices: Uint32Array;
}

/** Quantized pheromone layers, `layers.length * resolution^2` bytes, layer-major then row-major. */
export interface PheromoneSnapshot {
  resolution: number;
  /** Layer order inside `data`. */
  types: PheromoneType[];
  /** 0..255 intensity per cell (sqrt-compressed, see `PheromoneField.quantize`). Transferable. */
  data: Uint8Array;
}

/** Underground tile grid. `cells[i] = TileType | ChamberKind << 3`. Sent only when it changes. */
export interface NestGridSnapshot {
  /** Colony that owns this nest. */
  colony: number;
  version: number;
  width: number;
  height: number;
  /** Column of the surface entrance in row 0. */
  entranceX: number;
  cells: Uint8Array;
}

export interface ColonySnapshot {
  id: number;
  /** Surface entrance. */
  nest: NestInfo;
  /** Food in the colony store. */
  food: number;
  queenAlive: boolean;
  queenHp: number;
  queenMaxHp: number;
  /** Queen's tile (grid coordinates). */
  queenX: number;
  queenY: number;
  /** True once the queen has died: the colony is lost. */
  lost: boolean;
  eggs: number;
  larvae: number;
  pupae: number;
  /** Total adult ants. */
  population: number;
  /** Ants of this colony underground (in any nest). */
  underground: number;
  /** Adults per caste, indexed by `Caste`. */
  castes: [number, number, number];
  casteRatio: CasteRatio;
  /** Ants of this colony currently fighting. */
  fighting: number;
  /** Ants of this colony killed so far (combat and starvation). */
  losses: number;
  /** Enemy ants inside this colony's nest. */
  intruders: number;
  /** Soldiers are raiding the enemy nest. */
  raid: boolean;
  /** An enemy ant has come close to this colony's nest (it is known to the enemy). */
  scouted: boolean;
  /** Workers per role, indexed by `AntRole`. */
  roles: [number, number, number];
  ratio: BehaviorRatio;
  /** Brood slots left in nursery chambers. */
  broodCapacity: number;
  /** Dirt hauled out so far (drives the surface mound). */
  dirt: number;
  /** Open (dug) tiles in the nest. */
  openTiles: number;
}

export interface Snapshot {
  tick: number;
  antCount: number;
  /** Interleaved `[x, y, heading, carrying, layer, flags]` per ant, see `ANT_STRIDE`. Transferable. */
  ants: Float32Array;
  /** The player colony's pheromone field. Present only on some snapshots (every few ticks, or when requested). */
  pheromones?: PheromoneSnapshot;
  /** Live food piles (small; sent every tick). */
  food: FoodInfo[];
  /** The player ant, or null when the colony has no ants. */
  player: PlayerInfo | null;
  events: SimEvent[];
  /** Index = colony id; 0 is the player's (black) colony, 1 the red one. */
  colonies: ColonySnapshot[];
  /** Nest grids that changed since the previous snapshot (or all, on request). */
  nestGrids?: NestGridSnapshot[];
  /** -1 while the game is running, else the winning colony id (or -2 for nobody). */
  winner: number;
}

/** Header summary of a save (also what the slot list shows). */
export interface SaveInfo {
  /** Save format version. */
  version: number;
  tick: number;
  seed: number;
  /** -1 while running, else the winner (see `Snapshot.winner`). */
  winner: number;
  /** Live ants per colony (index = colony id). */
  populations: number[];
  queensAlive: boolean[];
}

/** Main thread -> worker. */
export type WorkerInMessage =
  | { type: 'init'; config: SimConfigInput }
  | { type: 'commands'; commands: Command[] }
  | { type: 'setPaused'; paused: boolean }
  | { type: 'setSpeed'; speed: number }
  /** Scent vision on/off: pheromone data is only snapshotted while enabled. */
  | { type: 'setScentVision'; enabled: boolean }
  /** Serialize the running sim; answered with `saved` (or `error`). */
  | { type: 'save'; requestId: number }
  /** Replace the sim with a saved one; answered with `ready` + a snapshot (or `error`). */
  | { type: 'load'; requestId: number; bytes: Uint8Array };

/** Worker -> main thread. */
export type WorkerOutMessage =
  | {
      type: 'ready';
      config: SimConfig;
      /** Set when this is the answer to a `load`. */ requestId?: number;
    }
  | { type: 'snapshot'; snapshot: Snapshot; speed: number }
  | { type: 'saved'; requestId: number; bytes: Uint8Array; info: SaveInfo }
  | {
      type: 'error';
      requestId: number;
      operation: 'save' | 'load';
      /** `SaveError.code` for load failures, else 'failed'. */
      code: string;
      message: string;
    };

export { ANT_STRIDE };
