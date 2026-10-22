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
  /** Hard cap on live ants (all colonies); the performance governor lowers it on weak devices. */
  maxAnts: number;
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
  /** Spiders on the surface at startup (0 disables the predator). */
  spiders: number;
  /** Spider tuning (see `DEFAULT_SPIDER`); `difficulty` scales hp and speed on top. */
  spider: SpiderConfig;
  /** Antlion pits placed on the surface at startup (0 disables them). */
  antlions: number;
  /** Antlion tuning (see `DEFAULT_ANTLION`). */
  antlion: AntlionConfig;
  /** Rain / flooding tuning (see `DEFAULT_RAIN`); `difficulty` scales frequency and length. */
  rain: RainConfig;
  /** Lawnmower tuning (see `DEFAULT_LAWNMOWER`); `difficulty` scales frequency and passes. */
  lawnmower: LawnmowerConfig;
  /** Yard footsteps tuning (see `DEFAULT_YARD_STEPS`); `difficulty` scales frequency. */
  yardSteps: YardStepsConfig;
  /** Sandbox game: enables the sandbox-only commands (rocks, live colony / combat / scent tuning). */
  sandbox: boolean;
  /** The red colony's AI director runs. Off = the other colonies keep their starting ratios. */
  ai: boolean;
  /** The game ends (and the sim stops) when only one queen is left. Sandboxes turn this off. */
  winLose: boolean;
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

/** Spider predator tuning. Distances in world units, rates per tick at the fixed tick rate. */
export interface SpiderConfig {
  hp: number;
  /** Walking speed as a multiple of the ant walking speed. */
  huntSpeed: number;
  /** Ants within this distance of the spider's mouth get bitten (one kill per bite). */
  biteRange: number;
  /** Ticks the spider stands still eating after a kill. */
  eatTicks: number;
  /** Ants this close to the spider hurt it (and flee if the group is too small). */
  contactRange: number;
  /** HP removed per tick by an ant in contact, indexed by `Caste`. */
  damage: [number, number, number];
  /** The spider notices (and hunts) ants within this distance of itself. */
  senseRadius: number;
  /** Hunting never strays further than this from home. */
  leash: number;
  /** Retreats to its lair when hp falls below this fraction of max. */
  retreatFraction: number;
  /** HP regained per tick while retreating/lurking at home. */
  regen: number;
  /** Non-soldier ants within this distance flee unless the group is big enough. */
  fleeRadius: number;
  /** Ants within this distance of the spider are counted as the mob. */
  mobRadius: number;
  /** Mob strength (worker 1, soldier `soldierMobWeight`) needed for workers to stand and fight. */
  mobSize: number;
  soldierMobWeight: number;
  /** Alarm laid per tick around the spider (in every colony's field). */
  alarmDeposit: number;
  /** Food dropped when it dies. */
  foodDrop: number;
  /** Ticks until a dead spider respawns at its lair. */
  respawnTicks: number;
}

/**
 * Antlion pit tuning. Distances in world units, rates per tick at the fixed tick rate.
 * Ants inside `radius` slide towards the centre and die within `killRadius`, unless they
 * escape or a big enough mob swarms the antlion.
 */
export interface AntlionConfig {
  /** Slope radius: surface ants inside it are pulled in. */
  radius: number;
  /** Ants this close to the centre are eaten. */
  killRadius: number;
  /** Pull towards the centre, as a multiple of the ant walking step. */
  pull: number;
  /** Chance per tick that a sliding worker scrambles out. */
  escape: number;
  /** Escape chance multiplier for soldiers. */
  soldierEscape: number;
  /** Escape chance multiplier for the player ant. */
  playerEscape: number;
  /** Each other ant in the pit adds this fraction to everyone's escape chance. */
  crowdEscape: number;
  hp: number;
  /** Mob strength (worker 1, soldier `soldierMobWeight`) in the pit that overwhelms the antlion. */
  mobSize: number;
  soldierMobWeight: number;
  /** HP removed per tick by each ant of a swarming mob, indexed by `Caste`. */
  damage: [number, number, number];
  /** Food dropped when the antlion dies (the pit stays as inert sand). */
  foodDrop: number;
}

/** Rain tuning. Durations are ticks at the fixed tick rate, rates are per tick. */
export interface RainConfig {
  /** Showers happen at all (the `startRain` command works regardless). */
  enabled: boolean;
  /** Ticks of clear weather between showers (uniform in the range). */
  minGap: number;
  maxGap: number;
  minDuration: number;
  maxDuration: number;
  /** A warning event is sent this many ticks before a shower. */
  warningTicks: number;
  /** Ticks for the rain to build up to full strength (and to die away). */
  rampTicks: number;
  /** Surface pheromone evaporation is multiplied by up to this at full strength. */
  evaporationMult: number;
  /** Surface ant speed is multiplied by down to this at full strength. */
  surfaceSpeed: number;
  /** Water level added at each nest entrance per tick at full strength (levels are 0..1). */
  inflow: number;
  /** Water exchange between neighbouring tunnel tiles per tick (0..~0.3). */
  flow: number;
  /** Fraction of the water in a tile soaked into the soil per tick. */
  seep: number;
  /** Extra water lost per tick once the rain has stopped. */
  drain: number;
  /** Ants in tiles wetter than this take `drownDamage` per tick (scaled by the level). */
  drownLevel: number;
  drownDamage: number;
  /** Brood in a nursery counts as flooded above this level. */
  broodLevel: number;
  /** Per tick, fraction of brood lost when every nursery tile is flooded. */
  broodKill: number;
}

/** Lawnmower tuning. Durations are ticks at the fixed tick rate, lengths world units. */
export interface LawnmowerConfig {
  /** Mowing happens on its own (the `startMower` command works regardless). */
  enabled: boolean;
  /** Frequency multiplier: gaps are divided by it (campaign patches vary it). */
  frequency: number;
  /** Ticks of quiet between mowings (uniform in the range). */
  minGap: number;
  maxGap: number;
  /** A warning event (and the lane telegraph) comes this many ticks before the mower starts. */
  warningTicks: number;
  /** Width of the swath in world units. */
  width: number;
  /** World units travelled per tick. */
  speed: number;
  /** Straight passes per mowing (uniform integer in the range, scaled by difficulty). */
  minPasses: number;
  maxPasses: number;
  /** Ticks between passes while the mower turns round off-screen. */
  turnTicks: number;
  /** Food piles of at most this amount are swept away; bigger ones lose `bigFoodLoss` of it. */
  smallFood: number;
  bigFoodLoss: number;
}

/** Yard footsteps tuning: a human walks a line across the yard, one foot at a time. */
export interface YardStepsConfig {
  /** Walks happen on their own (the `startYardSteps` command works regardless). */
  enabled: boolean;
  /** Frequency multiplier: gaps are divided by it. */
  frequency: number;
  minGap: number;
  maxGap: number;
  /** A warning event comes this many ticks before the first foot's shadow. */
  warningTicks: number;
  /** Feet per walk (uniform integer in the range). */
  minFeet: number;
  maxFeet: number;
  /** Distance between consecutive feet, ticks between their shadows appearing, left/right offset. */
  stride: number;
  strideTicks: number;
  offset: number;
  /** Foot radius in world units, shadow time before the stamp, and how long the print stays. */
  radius: number;
  shadowTicks: number;
  showTicks: number;
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
export type SimConfigInput = Partial<
  Omit<
    SimConfig,
    'behavior' | 'colony' | 'combat' | 'spider' | 'antlion' | 'rain' | 'lawnmower' | 'yardSteps'
  >
> & {
  behavior?: Partial<AntBehaviorConfig>;
  colony?: Partial<ColonyConfig>;
  combat?: Partial<CombatConfig>;
  spider?: Partial<SpiderConfig>;
  antlion?: Partial<AntlionConfig>;
  rain?: Partial<RainConfig>;
  lawnmower?: Partial<LawnmowerConfig>;
  yardSteps?: Partial<YardStepsConfig>;
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
  | { type: 'setRaid'; colony?: number; on: boolean }
  /** Spawn an extra spider (debug / sandbox). Its lair is where it spawns. */
  | { type: 'spawnSpider'; x: number; y: number }
  /** Start a shower now (debug / sandbox); `ticks` defaults to a random duration. */
  | { type: 'startRain'; ticks?: number }
  /** End the current shower (it fades out). */
  | { type: 'stopRain' }
  /** Send the lawnmower now (debug / sandbox); `passes` defaults to a random number. */
  | { type: 'startMower'; passes?: number }
  /** A human walks across the yard now (debug / sandbox). */
  | { type: 'startYardSteps' }
  /** Dig an antlion pit at a surface point (debug / sandbox). */
  | { type: 'addAntlion'; x: number; y: number }
  /** Sandbox: place a rock (impassable disc for surface ants; radius is clamped). */
  | { type: 'placeObstacle'; x: number; y: number; radius: number }
  /** Sandbox: erase everything on the surface inside the brush disc (ants, food, rocks, pits, spiders). */
  | { type: 'erase'; x: number; y: number; radius: number }
  /** Sandbox: remove all rocks. */
  | { type: 'clearObstacles' }
  /** Sandbox: live-tune combat (merged over the current values). */
  | { type: 'setCombat'; params: Partial<CombatConfig> }
  /** Sandbox: live-tune the economy of one colony, or of all when `colony` is omitted. */
  | {
      type: 'setColonyParams';
      colony?: number;
      params: Partial<Omit<ColonyConfig, 'behaviorRatio' | 'casteRatio'>>;
    }
  /** Sandbox: live-tune a pheromone layer in every colony's field. */
  | {
      type: 'setPheromoneParams';
      pheromone: PheromoneType;
      params: { evaporation?: number; diffusion?: number };
    };

/** One-shot notifications from the sim, delivered in the snapshot of the tick they happened. */
export type SimEvent =
  | { type: 'playerSwapped'; from: number; to: number }
  /** A colony's queen died. When only one colony is left standing, `gameOver` follows. */
  | { type: 'queenKilled'; colony: number; cause: 'combat' | 'starvation' }
  /** The game ended; the sim stops stepping. `winner` is -2 if no colony is left. */
  | { type: 'gameOver'; winner: number }
  /**
   * The player's ant was lost: eaten by a spider (no `cause`), pulled into an antlion pit or
   * drowned in a flooded tunnel (`playerSwapped` follows when another ant takes over).
   */
  | { type: 'playerEaten'; cause?: 'antlion' | 'drowned' | 'mower' | 'stomped' }
  /** A spider was killed; it leaves a food pile and respawns after a cooldown. */
  | { type: 'spiderKilled'; x: number; y: number }
  /** Rain is about to start (`warningTicks` ahead). */
  | { type: 'rainWarning'; ticks: number }
  | { type: 'rainStarted' }
  | { type: 'rainEnded' }
  /** A mob killed an antlion; it left food and its pit is now inert sand. */
  | { type: 'antlionKilled'; x: number; y: number }
  /** The lawnmower starts in `ticks`: its lanes are on `Snapshot.mower`. */
  | { type: 'mowerWarning'; ticks: number }
  | { type: 'mowerStarted' }
  /** The last pass is done; the mower killed `kills` surface ants in total. */
  | { type: 'mowerEnded'; kills: number }
  /** A human is about to walk across the yard (`ticks` before the first shadow). */
  | { type: 'humansWarning'; ticks: number }
  /** Campaign: breeders of `colony` left on a mating flight; `founded` lists the patches that got a new colony. */
  | { type: 'matingFlight'; colony: number; breeders: number; founded: number[] }
  /** Campaign: a new colony of `colony` was founded in yard/house patch `patch`. */
  | { type: 'colonyFounded'; colony: number; patch: number }
  /** Campaign: the colony of `colony` in patch `patch` died out. */
  | { type: 'colonyDestroyed'; colony: number; patch: number }
  /** Campaign: the player switched to patch `patch` (the detailed world was rebuilt). */
  | { type: 'patchEntered'; patch: number }
  /** Campaign, house rooms: a human foot's shadow appears; it stamps down after `ticks`. */
  | { type: 'footstepWarning'; x: number; y: number; ticks: number }
  /** Campaign, house rooms: a foot stamped down, killing `kills` surface ants. */
  | { type: 'footstep'; x: number; y: number; kills: number }
  /** Campaign: a new season began (the seasonal mating flights happen at its start). */
  | { type: 'season'; season: number }
  /** Campaign: the campaign ended (`humansLeft` = victory, `lastColony` = defeat). */
  | { type: 'campaignOver'; won: boolean; reason: 'humansLeft' | 'lastColony' };

/** Spider behaviour states (`SpiderInfo.state`). */
export const SpiderState = { Lurk: 0, Hunt: 1, Eat: 2, Retreat: 3, Dead: 4 } as const;
export type SpiderState = (typeof SpiderState)[keyof typeof SpiderState];

/** A spider as shown to the UI. Dead spiders are listed too (state `Dead`, hp 0). */
export interface SpiderInfo {
  id: number;
  x: number;
  y: number;
  heading: number;
  state: SpiderState;
  hp: number;
  maxHp: number;
}

/** An antlion pit as shown to the UI. Dead ones stay listed (`alive` false): inert sand. */
export interface AntlionInfo {
  id: number;
  x: number;
  y: number;
  /** Slope radius. */
  radius: number;
  alive: boolean;
  hp: number;
  maxHp: number;
}

/** Sandbox economy and scent overrides applied on top of the config (also what a save restores). */
export interface SandboxTuning {
  /** Overrides applied to each colony's config (index = colony id). */
  colonies: Partial<Omit<ColonyConfig, 'behaviorRatio' | 'casteRatio'>>[];
  pheromones: Partial<Record<PheromoneType, { evaporation?: number; diffusion?: number }>>;
}

/** A rock as shown to the UI. */
export interface ObstacleInfo {
  id: number;
  x: number;
  y: number;
  radius: number;
}

export interface WeatherInfo {
  raining: boolean;
  /** 0..1 rain strength (ramps up and down at the edges of a shower). */
  intensity: number;
  /** Ticks until the next shower, or -1 while it rains / rain is off. */
  ticksToRain: number;
}

/** Water levels of one nest, `round(level * 255)` per tile in the nest-grid layout. */
export interface WaterGridSnapshot {
  colony: number;
  version: number;
  levels: Uint8Array;
}

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
  /** Nest water levels that changed since the previous snapshot (flooding is throttled to a few updates per second). */
  waterGrids?: WaterGridSnapshot[];
  /** -1 while the game is running, else the winning colony id (or -2 for nobody). */
  winner: number;
  spiders: SpiderInfo[];
  antlions: AntlionInfo[];
  weather: WeatherInfo;
  /** The full rock list: sent on the first snapshot of a sim and whenever it changes. */
  obstacles?: ObstacleInfo[];
  /** Campaign games: the map overview, when it changed since the previous snapshot. */
  campaign?: CampaignSnapshot;
  /** The lawnmower, while it is warming up or mowing. */
  mower?: MowerInfo;
  /** Campaign house rooms and yard walks: human feet over the patch (every snapshot while any are present). */
  footsteps?: FootstepInfo[];
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
  /** Saved from a sandbox game (absent in older saves). */
  sandbox?: boolean;
  /** Saved from a campaign: patches with a black colony, out of `patches`. */
  campaign?: { owned: number; patches: number; difficulty: Difficulty };
}

/** Campaign setup (main menu → Campaign → New). */
export interface CampaignConfig {
  seed: number;
  difficulty: Difficulty;
  /** Ant cap for the detailed patch (the performance governor's value). */
  maxAnts?: number;
}

/** What a campaign patch is: open yard, or a room of the house. */
export type PatchKind = 'yard' | 'room';

/** One patch of the campaign map, as shown on the yard map screen. */
export interface PatchInfo {
  id: number;
  /** Map cell; yard rows are 0..rows-1, the house sits above them (negative rows). */
  col: number;
  row: number;
  kind: PatchKind;
  /** Room name for house patches ('' in the yard). */
  name: string;
  /** Adult ants of each colony (0 = no colony there). */
  black: number;
  red: number;
  /** Breeders waiting in each colony's nests. */
  blackBreeders: number;
  redBreeders: number;
  /** Natural food lying around (not in nests). */
  food: number;
}

/** Campaign overview: sent on entering a patch and whenever the map changes. */
export interface CampaignSnapshot {
  /** Bumped on every change; the UI redraws only when it moves. */
  version: number;
  difficulty: Difficulty;
  cols: number;
  rows: number;
  patches: PatchInfo[];
  /** The patch simulated in detail right now. */
  active: number;
  /** Patches with a black colony. */
  owned: number;
  /** Patches with a red colony. */
  redOwned: number;
  /** Black breeders across all colonies, and the minimum needed for a mating flight. */
  breeders: number;
  flightMin: number;
  season: number;
  /** 0..1 progress through the current season (the seasonal flights happen at 1). */
  seasonProgress: number;
  /** House infestation meter, 0..1: humans move out at 1. */
  infestation: number;
  /** Black ants in the house, and how many it takes to raise the meter. */
  indoor: number;
  indoorTarget: number;
  /** '' while running. */
  outcome: '' | 'victory' | 'defeat';
}

/** The lawnmower between its warning and its last pass. */
export interface MowerInfo {
  /** Warming up (lanes telegraphed) or cutting. */
  phase: 'warning' | 'mowing';
  /** Ticks until the first pass while warming up, else 0. */
  startsIn: number;
  /** The mower travels along this axis; lanes are positions on the other one. */
  axis: 'x' | 'y';
  /** Lane centres, in pass order, and the swath width. */
  lanes: number[];
  width: number;
  /** Current pass index (-1 while warming up), travel direction (+1/-1) and front position on the axis. */
  pass: number;
  dir: 1 | -1;
  pos: number;
  /** False while turning round between passes. */
  onField: boolean;
}

/** A human foot over a house room: a growing shadow, then a stamp. */
export interface FootstepInfo {
  id: number;
  x: number;
  y: number;
  radius: number;
  /** 0..1 while the shadow grows; 1 at the stamp. */
  progress: number;
  /** True for the few ticks after it stamped down. */
  stamped: boolean;
  /** Walking direction in radians (yard walks; absent for the random house feet). */
  angle?: number;
}

/** Campaign-only actions (main thread -> worker `campaign` message). */
export type CampaignAction =
  /** Collapse the current patch into its summary and build `patch` in detail (needs a black colony there). */
  | { type: 'enterPatch'; patch: number }
  /** Send every black colony's breeders on a mating flight now. */
  | { type: 'matingFlight' };

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
  | { type: 'load'; requestId: number; bytes: Uint8Array }
  /** Start a new campaign (replaces any running game); answered like `init`. */
  | { type: 'initCampaign'; config: CampaignConfig }
  /** A campaign action (ignored outside campaigns). Entering a patch answers with `ready`. */
  | { type: 'campaign'; action: CampaignAction };

/** Worker -> main thread. */
export type WorkerOutMessage =
  | {
      type: 'ready';
      config: SimConfig;
      /** Sandbox live-tuning in effect (see `SandboxTuning`); absent outside sandbox games. */
      tuning?: SandboxTuning;
      /** Set when this is the answer to a `load`. */ requestId?: number;
      /** Present in campaign games: the overview (the active patch's kind decides its look). */
      campaign?: CampaignSnapshot;
    }
  | {
      type: 'snapshot';
      snapshot: Snapshot;
      speed: number;
      /** Mean wall-clock ms the sim spent per tick since the previous snapshot. */
      simMs?: number | undefined;
    }
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
