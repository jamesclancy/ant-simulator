import {
  ANT_STRIDE,
  AntRole,
  AntState,
  Caste,
  DEFAULT_ANT_COUNT,
  DEFAULT_BEHAVIOR,
  DEFAULT_COLONY,
  DEFAULT_COLONY_COUNT,
  DEFAULT_COMBAT,
  DEFAULT_FOOD_AMOUNT,
  DEFAULT_FOOD_SOURCES,
  DEFAULT_NEST_RADIUS,
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
  NestGridSnapshot,
  SimConfig,
  SimConfigInput,
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
import { PlayerController, isPlayerCommand } from './player';
import { createRng } from './rng';
import { createWorld } from './world';
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
   * the previous snapshot, or all of them when `options.nestGrid` is true.
   */
  snapshot(options?: { pheromones?: boolean; nestGrid?: boolean }): Snapshot;
}

export function resolveConfig(partial: SimConfigInput = {}): SimConfig {
  const { behavior, colony, combat, spider, ...rest } = partial;
  const merged = { ...DEFAULT_COMBAT, ...combat };
  return {
    seed: DEFAULT_SEED,
    worldSize: DEFAULT_WORLD_SIZE,
    initialAnts: DEFAULT_ANT_COUNT,
    colonies: DEFAULT_COLONY_COUNT,
    difficulty: 'normal',
    tickRate: TICK_RATE_HZ,
    pheromoneResolution: PHEROMONE_RESOLUTION,
    foodSources: DEFAULT_FOOD_SOURCES,
    foodAmount: DEFAULT_FOOD_AMOUNT,
    nestRadius: DEFAULT_NEST_RADIUS,
    spiders: DEFAULT_SPIDER_COUNT,
    ...rest,
    spider: {
      ...DEFAULT_SPIDER,
      ...spider,
      damage: [...(spider?.damage ?? DEFAULT_SPIDER.damage)] as [number, number, number],
    },
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
 * colonies (underground, economy) -> remove the dead (corpses become food) -> AI directors
 * -> pheromone diffusion/evaporation -> game-over check.
 */
export function createSim(partial: SimConfigInput = {}): Sim {
  const config = resolveConfig(partial);
  config.colonies = Math.max(1, Math.min(2, Math.floor(config.colonies)));
  const n = config.colonies;
  const rng = createRng(config.seed);
  const ants = createAntStore(MAX_ANTS);
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
  const remap = new Int32Array(ants.capacity);
  let tick = 0;
  let winner = -1;

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

  const checkGameOver = (): void => {
    if (winner !== -1 || n < 2) return;
    const alive = colonies.filter((c) => c.queenAlive);
    if (alive.length > 1) return;
    winner = alive[0]?.id ?? -2;
    events.push({ type: 'gameOver', winner });
  };

  const modules: SimModule[] = [
    { key: 'spiders', getState: () => spiders.getState(), setState: (st) => spiders.setState(st) },
    // Add new stateful systems (weather, ...) here.
  ];

  const saveInfo = (): SaveInfo => ({
    version: SAVE_VERSION,
    tick,
    seed: config.seed,
    winner,
    populations: colonies.map((c) => c.population),
    queensAlive: colonies.map((c) => c.queenAlive),
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
      updateAnts(ants, fields, world, rng, behavior, combatCfg, tickRate, player.index, colonies);
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
      reap();
      for (const d of directors) d.update(tick);
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
      };
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
export function restoreSim(bytes: Uint8Array): Sim {
  const state = decodeSave(bytes) as unknown as SimState;
  const sim = createSim(state.config);
  sim.setState(state);
  return sim;
}
