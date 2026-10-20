import {
  ANT_STRIDE,
  DEFAULT_ANT_COUNT,
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
import type { Command, SimConfig, Snapshot } from '@ant/shared';
import { createAntStore } from './ants';
import type { AntStore } from './ants';
import { PheromoneField } from './pheromones';
import { createRng } from './rng';
import { createWorld } from './world';
import type { World } from './world';
import { placeholderForage } from './world/placeholderForage';
import type { Rng } from './rng';

export interface Sim {
  readonly config: SimConfig;
  readonly tick: number;
  readonly ants: AntStore;
  /** Pheromone grids. Read via `sample`/`layer`; the sim step owns writes. */
  readonly pheromones: PheromoneField;
  /** Food piles and the nest. */
  readonly world: World;
  applyCommands(commands: readonly Command[]): void;
  /** Advance exactly one fixed tick. */
  step(): void;
  /**
   * Copy current state into a fresh, transferable snapshot. Pheromone data is
   * included when `options.pheromones` is true, or by default every
   * `PHEROMONE_SNAPSHOT_INTERVAL` ticks.
   */
  snapshot(options?: { pheromones?: boolean }): Snapshot;
}

const ANT_SPEED = 20; // world units per second
const TURN_JITTER = 0.5; // max radians turned per tick
const DEMO_HOME_DEPOSIT = 0.008; // placeholder trail strength per ant per tick

export function resolveConfig(partial: Partial<SimConfig> = {}): SimConfig {
  return {
    seed: DEFAULT_SEED,
    worldSize: DEFAULT_WORLD_SIZE,
    initialAnts: DEFAULT_ANT_COUNT,
    tickRate: TICK_RATE_HZ,
    pheromoneResolution: PHEROMONE_RESOLUTION,
    foodSources: DEFAULT_FOOD_SOURCES,
    foodAmount: DEFAULT_FOOD_AMOUNT,
    nestRadius: DEFAULT_NEST_RADIUS,
    ...partial,
  };
}

export function createSim(partial: Partial<SimConfig> = {}): Sim {
  const config = resolveConfig(partial);
  const rng = createRng(config.seed);
  const ants = createAntStore(Math.min(MAX_ANTS, Math.max(config.initialAnts, 1024)));
  const pheromones = new PheromoneField({
    worldSize: config.worldSize,
    resolution: config.pheromoneResolution,
  });
  // Separate stream so world layout doesn't depend on (or perturb) ant spawning.
  const world = createWorld(config, createRng(config.seed ^ 0x9e3779b9));
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
    }
  };

  const half = config.worldSize / 2;
  spawn(config.initialAnts, half, half, config.worldSize * 0.15);

  return {
    config,
    get tick() {
      return tick;
    },
    ants,
    pheromones,
    world,
    applyCommands(commands) {
      for (const cmd of commands) {
        switch (cmd.type) {
          case 'spawnAnts':
            spawn(cmd.count, cmd.x, cmd.y, 20);
            break;
          case 'clearAnts':
            ants.count = 0;
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
        }
      }
    },
    step() {
      randomWalk(ants, rng, config);
      // Placeholder until steering exists: walking ants lay a faint `home` trail.
      for (let i = 0; i < ants.count; i++) {
        pheromones.deposit('home', ants.x[i]!, ants.y[i]!, DEMO_HOME_DEPOSIT);
      }
      pheromones.update();
      placeholderForage(ants, world);
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
      };
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

/** Placeholder behaviour: correlated random walk with bouncing world edges. */
function randomWalk(ants: AntStore, rng: Rng, config: SimConfig): void {
  const step = ANT_SPEED / config.tickRate;
  const size = config.worldSize;
  const { x, y, heading } = ants;
  for (let i = 0; i < ants.count; i++) {
    let h = heading[i]! + rng.range(-TURN_JITTER, TURN_JITTER);
    let nx = x[i]! + Math.cos(h) * step;
    let ny = y[i]! + Math.sin(h) * step;
    if (nx < 0 || nx > size) {
      h = Math.PI - h;
      nx = clamp(nx, 0, size);
    }
    if (ny < 0 || ny > size) {
      h = -h;
      ny = clamp(ny, 0, size);
    }
    x[i] = nx;
    y[i] = ny;
    heading[i] = h;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
