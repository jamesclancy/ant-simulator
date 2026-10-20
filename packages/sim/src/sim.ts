import {
  ANT_STRIDE,
  DEFAULT_ANT_COUNT,
  DEFAULT_SEED,
  DEFAULT_WORLD_SIZE,
  MAX_ANTS,
  TICK_RATE_HZ,
} from '@ant/shared';
import type { Command, SimConfig, Snapshot } from '@ant/shared';
import { createAntStore } from './ants';
import type { AntStore } from './ants';
import { createRng } from './rng';
import type { Rng } from './rng';

export interface Sim {
  readonly config: SimConfig;
  readonly tick: number;
  readonly ants: AntStore;
  applyCommands(commands: readonly Command[]): void;
  /** Advance exactly one fixed tick. */
  step(): void;
  /** Copy current state into a fresh, transferable snapshot. */
  snapshot(): Snapshot;
}

const ANT_SPEED = 20; // world units per second
const TURN_JITTER = 0.5; // max radians turned per tick

export function resolveConfig(partial: Partial<SimConfig> = {}): SimConfig {
  return {
    seed: DEFAULT_SEED,
    worldSize: DEFAULT_WORLD_SIZE,
    initialAnts: DEFAULT_ANT_COUNT,
    tickRate: TICK_RATE_HZ,
    ...partial,
  };
}

export function createSim(partial: Partial<SimConfig> = {}): Sim {
  const config = resolveConfig(partial);
  const rng = createRng(config.seed);
  const ants = createAntStore(Math.min(MAX_ANTS, Math.max(config.initialAnts, 1024)));
  let tick = 0;

  const spawn = (count: number, cx: number, cy: number, spread: number): void => {
    const n = Math.min(count, ants.capacity - ants.count);
    for (let i = 0; i < n; i++) {
      const idx = ants.count++;
      ants.x[idx] = clamp(cx + rng.range(-spread, spread), 0, config.worldSize);
      ants.y[idx] = clamp(cy + rng.range(-spread, spread), 0, config.worldSize);
      ants.heading[idx] = rng.range(0, Math.PI * 2);
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
    applyCommands(commands) {
      for (const cmd of commands) {
        switch (cmd.type) {
          case 'spawnAnts':
            spawn(cmd.count, cmd.x, cmd.y, 20);
            break;
          case 'clearAnts':
            ants.count = 0;
            break;
        }
      }
    },
    step() {
      randomWalk(ants, rng, config);
      tick++;
    },
    snapshot() {
      const out = new Float32Array(ants.count * ANT_STRIDE);
      for (let i = 0; i < ants.count; i++) {
        const o = i * ANT_STRIDE;
        out[o] = ants.x[i]!;
        out[o + 1] = ants.y[i]!;
        out[o + 2] = ants.heading[i]!;
      }
      return { tick, antCount: ants.count, ants: out };
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
