import {
  ANT_STRIDE,
  AntRole,
  AntState,
  Caste,
  DEFAULT_ANTLION,
  DEFAULT_ANTLION_COUNT,
  DEFAULT_ANT_COUNT,
  DEFAULT_BEHAVIOR,
  DEFAULT_COLONY,
  DEFAULT_COLONY_COUNT,
  DEFAULT_COMBAT,
  DEFAULT_FOOD_AMOUNT,
  DEFAULT_FOOD_SOURCES,
  DEFAULT_NEST_RADIUS,
  DEFAULT_RAIN,
  DEFAULT_SEED,
  DEFAULT_SPIDER,
  DEFAULT_SPIDER_COUNT,
  DEFAULT_WORLD_SIZE,
  MAX_ANTS,
  PHEROMONE_RESOLUTION,
  PHEROMONE_SNAPSHOT_INTERVAL,
  PHEROMONE_TYPES,
  TICK_RATE_HZ,
  packAntFlags,
} from '@ant/shared';
import type {
  Command,
  PheromoneType,
  NestGridSnapshot,
  SimConfig,
  SimConfigInput,
  SandboxTuning,
  SimEvent,
  Snapshot,
} from '@ant/shared';
import { createAntStore, updateAnts } from './ants';
import { STARVED_HP, compactAnts } from './ants/store';
import type { AntStore } from './ants';
import { Director, DIRECTOR_PROFILES } from './ai';
import { Colony, takeCensus } from './colony';
import { Combat } from './combat';
import { PheromoneField } from './pheromones';
import { SpiderManager } from './predators';
import { AntlionManager, Weather, placeAntlions } from './hazards';
import { PlayerController, isPlayerCommand } from './player';
import { createRng } from './rng';
import { MAX_OBSTACLE_RADIUS, MIN_OBSTACLE_RADIUS, createWorld } from './world';
import { SAVE_VERSION, decodeSave, encodeSave } from './save/format';
import type { SaveInfo } from './save/format';
import { getAntsState, setAntsState } from './ants/store';
import type { AntsState } from './ants/store';
import type { PheromoneFieldState } from './pheromones/field';
import type { FoodFieldState } from './world/food';
import type { ColonyState } from './colony/colony';
import type { DirectorSaveState } from './ai/director';
import type { PlayerState } from './player';
import type { World } from './world';

type ColonyTuning = SandboxTuning['colonies'][number];
type PheromoneTuning = { evaporation?: number; diffusion?: number };

/** Corpse food within this distance of an existing pile is merged into it. */
const CORPSE_MERGE_RADIUS = 14;

/**
 * A part of the sim that owns state which must survive a save. Register one in `createSim`'s
 * `modules` list with a unique `key`; `getState` returns plain data (numbers, strings,
 * booleans, arrays, objects and typed arrays: no classes, Maps, undefined or functions) and
 * `setState` receives the same shape back on a freshly built sim. Saves written before a
 * module existed simply have no entry for its key, so `setState` is not called (the module
 * keeps its fresh-game state); bump `SAVE_VERSION` only when changing an existing shape.
 */
export interface SimModule {
  key: string;
  getState(): unknown;
  setState(state: never): void;
}

/**
 * Systems layered on top of a sim from outside it (the campaign): their modules are saved
 * and restored with the sim's own, and `saveInfo` adds fields to the save header.
 */
export interface SimExtras {
  modules?: readonly SimModule[];
  saveInfo?: () => Partial<SaveInfo>;
}

/** The sim's full state tree: what `serialize` writes and `restoreSim` reads. */
export interface SimState {
  config: SimConfig;
  tick: number;
  winner: number;
  rng: number;
  events: SimEvent[];
  ants: AntsState;
  fields: PheromoneFieldState[];
  food: FoodFieldState;
  colonies: ColonyState[];
  directors: DirectorSaveState[];
  player: PlayerState;
  /** `SimModule` states by key. */
  modules: Record<string, unknown>;
}

export interface Sim {
  readonly config: SimConfig;
  readonly tick: number;
  readonly ants: AntStore;
  /** The player colony's pheromone grids (`fields[0]`). */
  readonly pheromones: PheromoneField;
  /** One pheromone field per colony (index = colony id): ants only smell their own. */
  readonly fields: readonly PheromoneField[];
  /** Food piles and the nests. */
  readonly world: World;
  /** The yellow player ant and its recruits. */
  readonly player: PlayerController;
  /** Colonies (index = colony id). 0 is the player's (black), 1 the AI's (red). */
  readonly colonies: readonly Colony[];
  /** The player's colony (id 0). */
  readonly colony: Colony;
  /** AI directors, one per non-player colony. */
  readonly directors: readonly Director[];
  readonly combat: Combat;
  /** Surface predators. */
  readonly spiders: SpiderManager;
  /** Antlion pits on the surface. */
  readonly antlions: AntlionManager;
  /** Rain and the flooding it causes. */
  readonly weather: Weather;
  /** Sandbox live-tuning applied so far (a copy). */
  readonly tuning: SandboxTuning;
  /** -1 while running; else the winning colony id, or -2 if none is left. */
  readonly winner: number;
  applyCommands(commands: readonly Command[]): void;
  /** Complete, exact state (see `SimModule`). Typed arrays are copies. */
  getState(): SimState;
  /** Load a state from `getState` into a sim created with the same config. */
  setState(state: SimState): void;
  /** `getState` as a versioned, compressed binary save (`save/format.ts`). */
  serialize(): Uint8Array;
  /** Header summary of the current state, as stored in a save. */
  saveInfo(): SaveInfo;
  /** Advance exactly one fixed tick. */
  step(): void;
  /**
   * Copy current state into a fresh, transferable snapshot. Pheromone data (the player
   * colony's field) is included when `options.pheromones` is true, or by default every
   * `PHEROMONE_SNAPSHOT_INTERVAL` ticks. Nest grids are included when they changed since
   * the previous snapshot, or all of them when `options.nestGrid` is true. Sandbox rocks follow
   * the same rule (`options.obstacles`).
   */
  snapshot(options?: { pheromones?: boolean; nestGrid?: boolean; obstacles?: boolean }): Snapshot;
}

export function resolveConfig(partial: SimConfigInput = {}): SimConfig {
  const { behavior, colony, combat, spider, antlion, rain, ...rest } = partial;
  const merged = { ...DEFAULT_COMBAT, ...combat };
  return {
    seed: DEFAULT_SEED,
    worldSize: DEFAULT_WORLD_SIZE,
    initialAnts: DEFAULT_ANT_COUNT,
    maxAnts: MAX_ANTS,
    colonies: DEFAULT_COLONY_COUNT,
    difficulty: 'normal',
    tickRate: TICK_RATE_HZ,
    pheromoneResolution: PHEROMONE_RESOLUTION,
    foodSources: DEFAULT_FOOD_SOURCES,
    foodAmount: DEFAULT_FOOD_AMOUNT,
    nestRadius: DEFAULT_NEST_RADIUS,
    spiders: DEFAULT_SPIDER_COUNT,
    antlions: DEFAULT_ANTLION_COUNT,
    sandbox: false,
    ai: true,
    winLose: true,
    ...rest,
    spider: {
      ...DEFAULT_SPIDER,
      ...spider,
      damage: [...(spider?.damage ?? DEFAULT_SPIDER.damage)] as [number, number, number],
    },
    antlion: {
      ...DEFAULT_ANTLION,
      ...antlion,
      damage: [...(antlion?.damage ?? DEFAULT_ANTLION.damage)] as [number, number, number],
    },
    rain: { ...DEFAULT_RAIN, ...rain },
    behavior: { ...DEFAULT_BEHAVIOR, ...behavior },
    colony: { ...DEFAULT_COLONY, ...colony },
    combat: { ...merged, hp: [...merged.hp], damage: [...merged.damage] },
  };
}

/**
 * Build a deterministic sim. With two colonies (default) the black player colony and the
 * red AI colony start in opposite regions with `initialAnts` each; see `createWorld`.
 *
 * Tick order: census -> combat (hash, fights, damage) -> surface ants -> player ->
 * colonies (underground, economy) -> antlion pits -> weather (rain, flooding) -> remove the dead (corpses become food) -> AI directors
 * -> pheromone diffusion/evaporation -> game-over check.
 */
export function createSim(partial: SimConfigInput = {}, extras: SimExtras = {}): Sim {
  const config = resolveConfig(partial);
  config.colonies = Math.max(1, Math.min(2, Math.floor(config.colonies)));
  const n = config.colonies;
  const rng = createRng(config.seed);
  const ants = createAntStore(Math.max(1, Math.min(MAX_ANTS, Math.floor(config.maxAnts))));
  const fields = Array.from(
    { length: n },
    () =>
      new PheromoneField({
        worldSize: config.worldSize,
        resolution: config.pheromoneResolution,
        types: PHEROMONE_TYPES,
        // Trails and territory scent change slowly; alarm stays per tick (it must be quick).
        halfRate: ['food', 'home', 'enemy'],
      }),
  );
  // Separate stream so world layout doesn't depend on (or perturb) ant spawning.
  const world = createWorld(config, createRng(config.seed ^ 0x9e3779b9));
  let events: SimEvent[] = [];
  const onEvent = (e: SimEvent): void => {
    events.push(e);
  };
  const profile = DIRECTOR_PROFILES[config.difficulty] ?? DIRECTOR_PROFILES.normal;
  const colonies = world.nests.map((nest, id) => {
    const base = config.colony;
    const colonyConfig =
      id === 0
        ? base
        : {
            ...base,
            maxLayRate: base.maxLayRate * profile.layRateMult,
            startFood: base.startFood + profile.startFoodBonus,
            casteRatio: {
              worker: 1 - profile.soldierBase,
              soldier: profile.soldierBase,
              breeder: 0,
            },
          };
    return new Colony({
      id,
      config: colonyConfig,
      combat: config.combat,
      nest,
      seed: config.seed,
      onEvent,
    });
  });
  const colony = colonies[0]!;
  const directors = colonies.slice(1).map((c) => new Director(c, colonies, config.difficulty));
  const combat = new Combat(config.worldSize, n, ants.capacity);
  const spiders = new SpiderManager(config.spider, config.difficulty, config.worldSize);
  {
    // Lairs: seeded, away from the edges and well clear of every nest.
    const lair = createRng(config.seed ^ 0x5b1d3a7);
    const size = config.worldSize;
    for (let s = 0; s < Math.max(0, Math.floor(config.spiders)); s++) {
      let lx = size / 2;
      let ly = size / 2;
      for (let tries = 0; tries < 40; tries++) {
        lx = lair.range(size * 0.1, size * 0.9);
        ly = lair.range(size * 0.1, size * 0.9);
        if (world.nests.every((nest) => Math.hypot(nest.x - lx, nest.y - ly) > size * 0.25)) break;
      }
      spiders.add(lx, ly);
    }
  }
  const antlions = new AntlionManager(config.antlion, config.worldSize, config.seed);
  for (const site of placeAntlions(config.antlions, config.worldSize, config.seed, world.nests)) {
    antlions.add(site.x, site.y);
  }
  const weather = new Weather(config.rain, config.difficulty, config.seed, colonies);
  const remap = new Int32Array(ants.capacity);
  let tick = 0;
  let winner = -1;
  /** Obstacle list version last sent in a snapshot (-1: none yet). */
  let sentRocks = -1;

  const spawn = (
    count: number,
    cx: number,
    cy: number,
    spread: number,
    owner: number,
    caste?: number,
  ): void => {
    const col = colonies[owner];
    if (!col) return;
    const m = Math.min(count, ants.capacity - ants.count);
    for (let i = 0; i < m; i++) {
      const idx = ants.count++;
      const k = caste ?? col.nextCaste();
      ants.x[idx] = clamp(cx + rng.range(-spread, spread), 0, config.worldSize);
      ants.y[idx] = clamp(cy + rng.range(-spread, spread), 0, config.worldSize);
      ants.heading[idx] = rng.range(0, Math.PI * 2);
      ants.carrying[idx] = 0;
      ants.state[idx] = AntState.Wander;
      ants.strength[idx] = 0;
      ants.layer[idx] = 0;
      ants.role[idx] = k === Caste.Breeder ? AntRole.Nurse : AntRole.Forage;
      ants.colony[idx] = owner;
      ants.caste[idx] = k;
      ants.hp[idx] = config.combat.hp[k]!;
      col.population++;
      col.castes[k]!++;
    }
  };

  if (n === 1) {
    const half = config.worldSize / 2;
    spawn(config.initialAnts, half, half, config.worldSize * 0.15, 0);
  } else {
    for (const c of colonies) {
      spawn(config.initialAnts, c.nest.x, c.nest.y, config.worldSize * 0.06, c.id);
    }
  }
  const player = new PlayerController(
    ants,
    world,
    fields[0]!,
    config.behavior,
    rng,
    config.worldSize,
    config.combat,
  );
  // Starvation must not pick the player's slot.
  colony.protectedIndex = () => player.index;
  player.reset();

  /** Remove ants at <= 0 HP; combat deaths leave food (plus whatever they carried). */
  const reap = (): void => {
    const { hp, colony: owner, caste, layer, carrying, x, y } = ants;
    let dead = 0;
    for (let i = 0; i < ants.count; i++) {
      const h = hp[i]!;
      if (h > 0) continue;
      dead++;
      const c = colonies[owner[i]!]!;
      c.losses++;
      c.population--;
      c.castes[caste[i]!]!--;
      const load = carrying[i]! > 0 ? carrying[i]! : 0;
      const food = (h > STARVED_HP ? config.combat.corpseFood : 0) + load;
      if (food <= 0) continue;
      const l = layer[i]!;
      if (l === 0) world.food.addNear(x[i]!, y[i]!, food, CORPSE_MERGE_RADIUS);
      else colonies[l - 1]?.nest.depositFood(food);
    }
    if (!dead) return;
    const old = ants.count;
    compactAnts(ants, remap);
    player.applyRemap(remap, old);
  };

  /**
   * Sandbox tuning of the colonies' economy and the pheromone layers, remembered so a save
   * restores it exactly (a loaded sim rebuilds its colonies from the unmodified config).
   */
  const tuning: SandboxTuning = { colonies: colonies.map(() => ({})), pheromones: {} };
  const tuneColonies = (only: number | undefined, params: ColonyTuning): void => {
    for (const c of colonies) {
      if (only !== undefined && only !== c.id) continue;
      Object.assign(c.config, params);
      Object.assign(tuning.colonies[c.id]!, params);
    }
  };
  const tunePheromone = (type: PheromoneType, params: PheromoneTuning): void => {
    if (!fields[0]!.has(type)) return;
    for (const f of fields) Object.assign(f.config[type], params);
    tuning.pheromones[type] = { ...tuning.pheromones[type], ...params };
  };

  /** Largest gap kept between a rock and a nest entrance so colonies can't be walled in. */
  const NEST_CLEARANCE = 1.8;
  const MAX_ROCKS = 600;
  const placeRock = (x: number, y: number, radius: number): void => {
    const obs = world.obstacles;
    if (obs.count >= MAX_ROCKS || !(radius > 0)) return;
    const r = Math.min(MAX_OBSTACLE_RADIUS, Math.max(MIN_OBSTACLE_RADIUS, radius));
    for (const nest of world.nests) {
      if (Math.hypot(nest.x - x, nest.y - y) < nest.radius * NEST_CLEARANCE + r) return;
    }
    obs.add(x, y, r);
    // Rocks land on top of whatever was there: food is crushed, ants are pushed out.
    for (const f of [...world.food.list()]) {
      if (Math.hypot(f.x - x, f.y - y) < r + f.radius * 0.5) world.food.remove(f.id);
    }
    for (let i = 0; i < ants.count; i++) {
      if (ants.layer[i] !== 0) continue;
      // Overlapping rocks: keep pushing until the ant stands clear of all of them.
      for (let pass = 0; pass < 8; pass++) {
        const rock = obs.rockAt(ants.x[i]!, ants.y[i]!);
        if (!rock) break;
        const dx = ants.x[i]! - rock.x;
        const dy = ants.y[i]! - rock.y;
        const a = dx || dy ? Math.atan2(dy, dx) : (i * 2.399963) % (Math.PI * 2);
        ants.x[i] = clamp(rock.x + Math.cos(a) * (rock.radius + 1.5), 0, config.worldSize);
        ants.y[i] = clamp(rock.y + Math.sin(a) * (rock.radius + 1.5), 0, config.worldSize);
      }
    }
  };

  /** Sandbox eraser: surface ants (not the player), food, rocks, pits and spiders in the disc. */
  const erase = (x: number, y: number, radius: number): void => {
    const r2 = radius * radius;
    for (let i = 0; i < ants.count; i++) {
      if (ants.layer[i] !== 0 || i === player.index) continue;
      const dx = ants.x[i]! - x;
      const dy = ants.y[i]! - y;
      if (dx * dx + dy * dy <= r2) ants.hp[i] = STARVED_HP;
    }
    for (const f of [...world.food.list()]) {
      if (Math.hypot(f.x - x, f.y - y) <= radius + f.radius) world.food.remove(f.id);
    }
    world.obstacles.removeNear(x, y, radius);
    antlions.removeNear(x, y, radius);
    spiders.removeNear(x, y, radius);
  };

  const checkGameOver = (): void => {
    if (winner !== -1 || n < 2 || !config.winLose) return;
    const alive = colonies.filter((c) => c.queenAlive);
    if (alive.length > 1) return;
    winner = alive[0]?.id ?? -2;
    events.push({ type: 'gameOver', winner });
  };

  const modules: SimModule[] = [
    { key: 'spiders', getState: () => spiders.getState(), setState: (st) => spiders.setState(st) },
    {
      key: 'antlions',
      getState: () => antlions.getState(),
      setState: (st) => antlions.setState(st),
    },
    { key: 'weather', getState: () => weather.getState(), setState: (st) => weather.setState(st) },
    {
      key: 'obstacles',
      getState: () => world.obstacles.getState(),
      setState: (st) => world.obstacles.setState(st),
    },
    {
      key: 'tuning',
      getState: () => structuredClone(tuning),
      setState: (st: SandboxTuning) => {
        st.colonies.forEach((params, id) => tuneColonies(id, params));
        for (const [type, params] of Object.entries(st.pheromones)) {
          tunePheromone(type as PheromoneType, params);
        }
      },
    },
    // Add new stateful systems here.
    ...(extras.modules ?? []),
  ];

  const saveInfo = (): SaveInfo => ({
    version: SAVE_VERSION,
    tick,
    seed: config.seed,
    winner,
    populations: colonies.map((c) => c.population),
    queensAlive: colonies.map((c) => c.queenAlive),
    ...(config.sandbox ? { sandbox: true } : {}),
    ...extras.saveInfo?.(),
  });
  const getState = (): SimState => ({
    config: { ...config, behavior: { ...config.behavior } },
    tick,
    winner,
    rng: rng.getState(),
    events: events.map((e) => ({ ...e })),
    ants: getAntsState(ants),
    fields: fields.map((f) => f.getState()),
    food: world.food.getState(),
    colonies: colonies.map((c) => c.getState()),
    directors: directors.map((d) => d.getState()),
    player: player.getState(),
    modules: Object.fromEntries(modules.map((m) => [m.key, m.getState()])),
  });
  const setState = (s: SimState): void => {
    if (
      s.colonies.length !== n ||
      s.fields.length !== n ||
      s.directors.length !== directors.length
    ) {
      throw new Error('save does not match this sim (colony count)');
    }
    tick = s.tick;
    winner = s.winner;
    rng.setState(s.rng);
    events = s.events.map((e) => ({ ...e }));
    setAntsState(ants, s.ants);
    fields.forEach((f, i) => f.setState(s.fields[i]!));
    world.food.setState(s.food);
    colonies.forEach((c, i) => c.setState(s.colonies[i]!));
    directors.forEach((d, i) => d.setState(s.directors[i]!));
    player.setState(s.player);
    for (const m of modules) {
      if (m.key in s.modules) m.setState(s.modules[m.key] as never);
    }
    Object.assign(config.behavior, s.config.behavior);
  };

  return {
    config,
    get tick() {
      return tick;
    },
    get winner() {
      return winner;
    },
    ants,
    pheromones: fields[0]!,
    fields,
    world,
    player,
    colonies,
    colony,
    directors,
    combat,
    getState,
    setState,
    saveInfo,
    serialize: () => encodeSave(getState(), saveInfo()),
    spiders,
    antlions,
    weather,
    get tuning() {
      return structuredClone(tuning);
    },
    applyCommands(commands) {
      for (const cmd of commands) {
        if (isPlayerCommand(cmd)) {
          player.apply(cmd);
          continue;
        }
        switch (cmd.type) {
          case 'spawnAnts':
            spawn(cmd.count, cmd.x, cmd.y, 20, cmd.colony ?? 0, cmd.caste);
            break;
          case 'clearAnts':
            ants.count = 0;
            for (const c of colonies) {
              c.population = 0;
              c.castes[0] = c.castes[1] = c.castes[2] = 0;
            }
            player.reset();
            break;
          case 'depositPheromone': {
            const f = fields[cmd.colony ?? 0];
            if (f?.has(cmd.pheromone)) f.deposit(cmd.pheromone, cmd.x, cmd.y, cmd.amount);
            break;
          }
          case 'clearPheromones':
            for (const f of fields) {
              if (!cmd.pheromone || f.has(cmd.pheromone)) f.clear(cmd.pheromone);
            }
            break;
          case 'placeFood':
            world.food.add(cmd.x, cmd.y, cmd.amount);
            break;
          case 'removeFood':
            world.food.remove(cmd.id);
            break;
          case 'setBehavior':
            Object.assign(config.behavior, cmd.params);
            break;
          case 'setBehaviorRatio':
            colonies[cmd.colony ?? 0]?.setBehaviorRatio(cmd);
            break;
          case 'setCasteRatio':
            colonies[cmd.colony ?? 0]?.setCasteRatio(cmd);
            break;
          case 'spawnSpider':
            spiders.add(clamp(cmd.x, 0, config.worldSize), clamp(cmd.y, 0, config.worldSize));
            break;
          case 'startRain':
            weather.start(cmd.ticks, events);
            break;
          case 'stopRain':
            weather.stop();
            break;
          case 'addAntlion':
            antlions.add(clamp(cmd.x, 0, config.worldSize), clamp(cmd.y, 0, config.worldSize));
            break;
          case 'placeObstacle':
            if (config.sandbox) placeRock(cmd.x, cmd.y, cmd.radius);
            break;
          case 'clearObstacles':
            if (config.sandbox) world.obstacles.clear();
            break;
          case 'erase':
            if (config.sandbox) erase(cmd.x, cmd.y, cmd.radius);
            break;
          case 'setCombat':
            if (config.sandbox) Object.assign(config.combat, cmd.params);
            break;
          case 'setColonyParams':
            if (config.sandbox) tuneColonies(cmd.colony, cmd.params);
            break;
          case 'setPheromoneParams':
            if (config.sandbox) tunePheromone(cmd.pheromone, cmd.params);
            break;
          case 'setRaid': {
            const c = colonies[cmd.colony ?? 0];
            if (c) c.raid = cmd.on;
            break;
          }
        }
      }
    },
    step() {
      const { behavior, combat: combatCfg, tickRate } = config;
      takeCensus(ants, colonies, combatCfg);
      combat.resolve(ants, colonies, fields, combatCfg, behavior, tickRate, player.index);
      updateAnts(
        ants,
        fields,
        world,
        rng,
        weather.behaviorFor(behavior),
        combatCfg,
        tickRate,
        player.index,
        colonies,
      );
      player.step();
      if (spiders.count > 0) {
        if (n < 2) combat.hash.build(ants); // resolve() only builds it for rival colonies
        spiders.step({
          ants,
          hash: combat.hash,
          world,
          fields,
          combat: combatCfg,
          playerIndex: player.index,
          antStep: behavior.speed / tickRate,
          events,
        });
      }
      for (const c of colonies) c.step(ants, rng, behavior, tickRate);
      const antStep = behavior.speed / tickRate;
      if (antlions.count > 0) {
        antlions.step({ ants, world, playerIndex: player.index, antStep, events });
      }
      weather.step({ ants, colonies, fields, playerIndex: player.index, antStep, events });
      reap();
      if (config.ai) for (const d of directors) d.update(tick);
      for (const f of fields) f.update();
      checkGameOver();
      tick++;
    },
    snapshot(options) {
      const out = new Float32Array(ants.count * ANT_STRIDE);
      const { x, y, heading, carrying, layer, colony: owner, caste, state } = ants;
      for (let i = 0; i < ants.count; i++) {
        const o = i * ANT_STRIDE;
        out[o] = x[i]!;
        out[o + 1] = y[i]!;
        out[o + 2] = heading[i]!;
        out[o + 3] = carrying[i]!;
        out[o + 4] = layer[i]!;
        out[o + 5] = packAntFlags(owner[i]!, caste[i]!, state[i] === AntState.Fight);
      }
      const drained = player.drainEvents();
      if (events.length) {
        drained.push(...events);
        events = [];
      }
      const snap: Snapshot = {
        tick,
        antCount: ants.count,
        ants: out,
        food: [...world.food.list()].map(({ id, x, y, radius, amount }) => ({
          id,
          x,
          y,
          radius,
          amount,
        })),
        player: player.info(),
        events: drained,
        colonies: colonies.map((c) => c.snapshotColony()),
        winner,
        spiders: spiders.info(),
        antlions: antlions.info(),
        weather: weather.info(),
      };
      if (config.sandbox && (options?.obstacles || sentRocks !== world.obstacles.version)) {
        sentRocks = world.obstacles.version;
        snap.obstacles = world.obstacles
          .list()
          .map(({ id, x, y, radius }) => ({ id, x, y, radius }));
      }
      const water = weather.snapshotWater(tick, options?.nestGrid);
      if (water.length) snap.waterGrids = water;
      const grids: NestGridSnapshot[] = [];
      for (const c of colonies) {
        const g = c.snapshotGrid(options?.nestGrid);
        if (g) grids.push(g);
      }
      if (grids.length) snap.nestGrids = grids;
      if (options?.pheromones ?? tick % PHEROMONE_SNAPSHOT_INTERVAL === 0) {
        const f = fields[0]!;
        snap.pheromones = {
          resolution: f.resolution,
          types: [...f.types],
          data: f.quantize(),
        };
      }
      return snap;
    },
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Rebuild a sim from `Sim.serialize` bytes. Throws `SaveError` for foreign, damaged or
 * newer-format files. The world is regenerated from the saved config (cheap), then every
 * module's state is overwritten, so stepping it matches the original tick for tick.
 */
export function restoreSim(bytes: Uint8Array, extras?: SimExtras): Sim {
  const state = decodeSave(bytes) as unknown as SimState;
  const sim = createSim(state.config, extras);
  sim.setState(state);
  return sim;
}
