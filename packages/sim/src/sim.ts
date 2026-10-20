import {
  ANT_STRIDE,
  DEFAULT_ANT_COUNT,
  DEFAULT_BEHAVIOR,
  DEFAULT_COLONY,
  DEFAULT_FOOD_AMOUNT,
  DEFAULT_FOOD_SOURCES,
  DEFAULT_NEST_RADIUS,
  DEFAULT_SEED,
  DEFAULT_WORLD_SIZE,
  MAX_ANTS,
  PHEROMONE_RESOLUTION,
  PHEROMONE_SNAPSHOT_INTERVAL,
  TICK_RATE_HZ,
} from '@ant/shared';
import { AntState } from '@ant/shared';
import type { Command, SimConfig, SimConfigInput, Snapshot } from '@ant/shared';
import { createAntStore, updateAnts } from './ants';
import { Colony } from './colony';
import type { AntStore } from './ants';
import { PheromoneField } from './pheromones';
import { PlayerController, isPlayerCommand } from './player';
import { createRng } from './rng';
import { createWorld } from './world';
import type { World } from './world';

export interface Sim {
  readonly config: SimConfig;
  readonly tick: number;
  readonly ants: AntStore;
  /** Pheromone grids. Read via `sample`/`layer`; the sim step owns writes. */
  readonly pheromones: PheromoneField;
  /** Food piles and the nest. */
  readonly world: World;
  /** The yellow player ant and its recruits. */
  readonly player: PlayerController;
  /** Colonies (index = colony id). Currently just the player's. */
  readonly colonies: readonly Colony[];
  /** The player's colony (id 0). */
  readonly colony: Colony;
  applyCommands(commands: readonly Command[]): void;
  /** Advance exactly one fixed tick. */
  step(): void;
  /**
   * Copy current state into a fresh, transferable snapshot. Pheromone data is
   * included when `options.pheromones` is true, or by default every
   * `PHEROMONE_SNAPSHOT_INTERVAL` ticks. The nest grid is included when it changed since
   * the previous snapshot, or when `options.nestGrid` is true.
   */
  snapshot(options?: { pheromones?: boolean; nestGrid?: boolean }): Snapshot;
}

export function resolveConfig(partial: SimConfigInput = {}): SimConfig {
  const { behavior, colony, ...rest } = partial;
  return {
    seed: DEFAULT_SEED,
    worldSize: DEFAULT_WORLD_SIZE,
    initialAnts: DEFAULT_ANT_COUNT,
    tickRate: TICK_RATE_HZ,
    pheromoneResolution: PHEROMONE_RESOLUTION,
    foodSources: DEFAULT_FOOD_SOURCES,
    foodAmount: DEFAULT_FOOD_AMOUNT,
    nestRadius: DEFAULT_NEST_RADIUS,
    ...rest,
    behavior: { ...DEFAULT_BEHAVIOR, ...behavior },
    colony: { ...DEFAULT_COLONY, ...colony },
  };
}

export function createSim(partial: SimConfigInput = {}): Sim {
  const config = resolveConfig(partial);
  const rng = createRng(config.seed);
  const ants = createAntStore(MAX_ANTS);
  const pheromones = new PheromoneField({
    worldSize: config.worldSize,
    resolution: config.pheromoneResolution,
  });
  // Separate stream so world layout doesn't depend on (or perturb) ant spawning.
  const world = createWorld(config, createRng(config.seed ^ 0x9e3779b9));
  const colony = new Colony({ id: 0, config: config.colony, nest: world.nest, seed: config.seed });
  const colonies = [colony];
  let tick = 0;

  const spawn = (count: number, cx: number, cy: number, spread: number): void => {
    const n = Math.min(count, ants.capacity - ants.count);
    for (let i = 0; i < n; i++) {
      const idx = ants.count++;
      ants.x[idx] = clamp(cx + rng.range(-spread, spread), 0, config.worldSize);
      ants.y[idx] = clamp(cy + rng.range(-spread, spread), 0, config.worldSize);
      ants.heading[idx] = rng.range(0, Math.PI * 2);
      ants.carrying[idx] = 0;
      ants.state[idx] = AntState.Wander;
      ants.strength[idx] = 0;
      ants.layer[idx] = 0;
      ants.role[idx] = 0;
    }
  };

  const half = config.worldSize / 2;
  spawn(config.initialAnts, half, half, config.worldSize * 0.15);
  const player = new PlayerController(
    ants,
    world,
    pheromones,
    config.behavior,
    rng,
    config.worldSize,
  );
  // Starvation swap-removes ants: keep the player's slot safe and keep it pointing at the player.
  colony.protectedIndex = () => player.index;
  colony.onAntMoved = (from, to) => player.remap(from, to);
  player.reset();

  return {
    config,
    get tick() {
      return tick;
    },
    ants,
    pheromones,
    world,
    player,
    colonies,
    colony,
    applyCommands(commands) {
      for (const cmd of commands) {
        if (isPlayerCommand(cmd)) {
          player.apply(cmd);
          continue;
        }
        switch (cmd.type) {
          case 'spawnAnts':
            spawn(cmd.count, cmd.x, cmd.y, 20);
            break;
          case 'clearAnts':
            ants.count = 0;
            player.reset();
            break;
          case 'depositPheromone':
            if (pheromones.has(cmd.pheromone)) {
              pheromones.deposit(cmd.pheromone, cmd.x, cmd.y, cmd.amount);
            }
            break;
          case 'clearPheromones':
            if (!cmd.pheromone || pheromones.has(cmd.pheromone)) pheromones.clear(cmd.pheromone);
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
          case 'setCasteRatio': {
            const c = colonies[cmd.colony ?? 0];
            if (c)
              c.casteRatio = { worker: cmd.worker, soldier: cmd.soldier, breeder: cmd.breeder };
            break;
          }
        }
      }
    },
    step() {
      updateAnts(
        ants,
        pheromones,
        world,
        rng,
        config.behavior,
        config.tickRate,
        player.index,
        colony,
      );
      player.step();
      for (const c of colonies) c.step(ants, rng, config.behavior, config.tickRate);
      pheromones.update();
      tick++;
    },
    snapshot(options) {
      const out = new Float32Array(ants.count * ANT_STRIDE);
      for (let i = 0; i < ants.count; i++) {
        const o = i * ANT_STRIDE;
        out[o] = ants.x[i]!;
        out[o + 1] = ants.y[i]!;
        out[o + 2] = ants.heading[i]!;
        out[o + 3] = ants.carrying[i]!;
        out[o + 4] = ants.layer[i]!;
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
        nest: { x: world.nest.x, y: world.nest.y, radius: world.nest.radius },
        colonyFood: world.nest.store,
        player: player.info(),
        events: player.drainEvents(),
        colony: colony.snapshotColony(ants),
      };
      const grid = colony.snapshotGrid(options?.nestGrid);
      if (grid) snap.nestGrid = grid;
      if (options?.pheromones ?? tick % PHEROMONE_SNAPSHOT_INTERVAL === 0) {
        snap.pheromones = {
          resolution: pheromones.resolution,
          types: [...pheromones.types],
          data: pheromones.quantize(),
        };
      }
      return snap;
    },
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
