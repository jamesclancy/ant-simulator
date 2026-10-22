import { describe, expect, it } from 'vitest';
import { PLAYER_COLONY } from '@ant/shared';
import type { SimConfigInput, SimEvent } from '@ant/shared';
import { createSim, restoreSim } from '../src';
import type { Sim } from '../src';
import { buildLayout } from '../src/campaign/layout';

const FROZEN = {
  maxLayRate: 0,
  upkeepPerAnt: 0,
  queenUpkeep: 0,
  behaviorRatio: { forage: 1, dig: 0, nurse: 0 },
};

/** One colony in an empty yard with every random hazard off unless asked for. */
function yard(extra: SimConfigInput = {}): Sim {
  return createSim({
    seed: 5,
    worldSize: 1024,
    initialAnts: 0,
    foodSources: 0,
    colonies: 1,
    spiders: 0,
    antlions: 0,
    rain: { enabled: false },
    lawnmower: { enabled: false },
    yardSteps: { enabled: false },
    colony: FROZEN,
    behavior: { speed: 0 },
    ...extra,
  });
}

function run(sim: Sim, ticks: number, events: SimEvent[] = []): SimEvent[] {
  for (let t = 0; t < ticks; t++) {
    sim.step();
    events.push(...sim.snapshot().events);
  }
  return events;
}

/** Plant an ant that stays where it is (no ticks pass before the hazard looks). */
function antAt(sim: Sim, x: number, y: number): number {
  sim.applyCommands([{ type: 'spawnAnts', count: 1, x, y, colony: 0 }]);
  const i = sim.ants.count - 1;
  sim.ants.x[i] = x;
  sim.ants.y[i] = y;
  return i;
}

const MOW = { width: 100, speed: 8, minPasses: 1, maxPasses: 1, warningTicks: 20 };

describe('lawnmower', () => {
  it('schedules deterministically from the seed, sooner on hard', () => {
    const firstWarning = (seed: number, difficulty: 'easy' | 'normal' | 'hard'): number => {
      const sim = yard({
        seed,
        difficulty,
        lawnmower: { enabled: true, minGap: 300, maxGap: 900 },
      });
      for (let t = 1; t < 5000; t++) {
        sim.step();
        if (sim.snapshot().events.some((e) => e.type === 'mowerWarning')) return t;
      }
      return -1;
    };
    const a = firstWarning(5, 'normal');
    expect(a).toBeGreaterThan(0);
    expect(firstWarning(5, 'normal')).toBe(a);
    expect(firstWarning(6, 'normal')).not.toBe(a);
    expect(firstWarning(5, 'hard')).toBeLessThan(firstWarning(5, 'easy'));
  });

  it('warns, telegraphs its lanes, then mows and ends', () => {
    const sim = yard({ lawnmower: MOW });
    sim.applyCommands([{ type: 'startMower' }]);
    let events = run(sim, 1);
    expect(events).toContainEqual({ type: 'mowerWarning', ticks: 20 });
    const info = sim.snapshot().mower!;
    expect(info.phase).toBe('warning');
    expect(info.lanes).toHaveLength(1);
    expect(info.startsIn).toBeGreaterThan(0);
    events = run(sim, 25);
    expect(events.filter((e) => e.type === 'mowerStarted')).toHaveLength(1);
    expect(sim.snapshot().mower?.phase).toBe('mowing');
    events = run(sim, 200);
    expect(events.filter((e) => e.type === 'mowerEnded')).toHaveLength(1);
    expect(sim.snapshot().mower).toBeUndefined();
  });

  it('kills surface ants in the swath only: not outside it, not underground', () => {
    const sim = yard({ lawnmower: MOW });
    sim.applyCommands([{ type: 'startMower', passes: 1 }]);
    run(sim, 1);
    const { axis, lanes } = sim.snapshot().mower!;
    const at = (along: number, across: number): [number, number] =>
      axis === 'x' ? [along, across] : [across, along];
    const lane = lanes[0]!;
    antAt(sim, ...at(500, lane));
    antAt(sim, ...at(500, lane + 45));
    antAt(sim, ...at(500, lane + 70));
    const below = antAt(sim, ...at(500, lane));
    sim.ants.layer[below] = 1; // underground
    const events = run(sim, 300);
    // Reaping compacts the store: what is left is the ant beside the swath and the buried one.
    expect(events.find((e) => e.type === 'mowerEnded')).toMatchObject({ kills: 2 });
    const left = Array.from({ length: sim.ants.count }, (_, i) => [
      sim.ants.layer[i]!,
      Math.round(axis === 'x' ? sim.ants.y[i]! : sim.ants.x[i]!),
    ]);
    expect(left.sort()).toEqual([
      [0, lane + 70],
      [1, lane],
    ]);
  });

  it('removes surface pheromone, small food and mounds in the swath, and spares the rest', () => {
    const sim = yard({ lawnmower: MOW });
    sim.applyCommands([{ type: 'startMower', passes: 1 }]);
    run(sim, 1);
    const { axis, lanes } = sim.snapshot().mower!;
    const lane = lanes[0]!;
    const at = (along: number, across: number): [number, number] =>
      axis === 'x' ? [along, across] : [across, along];
    for (let k = 0; k < 20; k++) {
      sim.applyCommands([
        {
          type: 'depositPheromone',
          pheromone: 'food',
          x: at(300 + k * 10, lane)[0],
          y: at(300 + k * 10, lane)[1],
          amount: 1,
        },
        {
          type: 'depositPheromone',
          pheromone: 'food',
          x: at(300 + k * 10, lane + 200)[0],
          y: at(300 + k * 10, lane + 200)[1],
          amount: 1,
        },
      ]);
    }
    const small = sim.world.food.add(...at(400, lane), 30);
    const big = sim.world.food.add(...at(450, lane), 400);
    const far = sim.world.food.add(...at(400, lane + 250), 30);
    sim.colony.dirt = 40;
    const mound = {
      x: sim.colony.nest.x + sim.colony.nest.radius * 1.9,
      y: sim.colony.nest.y + sim.colony.nest.radius * 0.4,
    };
    run(sim, 300);
    expect(sim.world.food.get(small)).toBeUndefined();
    expect(sim.world.food.get(big)!.amount).toBeCloseTo(400 * 0.7, 5);
    expect(sim.world.food.get(far)!.amount).toBe(30);
    // The lane is bare, the strip beside it still has scent (only evaporation touched it).
    const field = sim.pheromones;
    const layer = field.layer('food');
    const res = field.resolution;
    const cell = field.cellSize;
    const sum = (across: number): number => {
      let total = 0;
      for (let a = 0; a < res; a++) {
        const [x, y] = at(a * cell + cell / 2, across);
        total += layer[Math.floor(y / cell) * res + Math.floor(x / cell)]!;
      }
      return total;
    };
    expect(sum(lane)).toBe(0);
    expect(sum(lane + 200)).toBeGreaterThan(0);
    const half = MOW.width / 2;
    const [mx, my] = [mound.x, mound.y];
    const across = axis === 'x' ? my : mx;
    expect(sim.colony.dirt).toBe(Math.abs(across - lane) <= half ? 0 : 40);
  });

  it('flattens a dirt mound in its path', () => {
    const sim = yard({ lawnmower: MOW });
    sim.applyCommands([{ type: 'startMower', passes: 1 }]);
    run(sim, 1);
    sim.colony.dirt = 25;
    // Drive the lane over the mound by rebuilding the sim state with its lane at the mound.
    const state = sim.getState();
    const mower = state.modules['mower'] as { axis: 'x' | 'y'; lanes: number[] };
    const n = sim.colony.nest;
    mower.lanes = [mower.axis === 'x' ? n.y + n.radius * 0.4 : n.x + n.radius * 1.9];
    sim.setState(state);
    run(sim, 300);
    expect(sim.colony.dirt).toBe(0);
  });

  it('reports the player ant as killed', () => {
    const sim = yard({ lawnmower: MOW });
    sim.applyCommands([{ type: 'startMower', passes: 1 }]);
    run(sim, 1);
    const { axis, lanes } = sim.snapshot().mower!;
    const p = sim.ants.count > 0 ? sim.player.index : antAt(sim, 0, 0);
    const lane = lanes[0]!;
    sim.ants.x[p] = axis === 'x' ? 500 : lane;
    sim.ants.y[p] = axis === 'x' ? lane : 500;
    const events = run(sim, 300);
    expect(events).toContainEqual({ type: 'playerEaten', cause: 'mower' });
  });

  it('makes several alternating passes', () => {
    const sim = yard({ lawnmower: { ...MOW, minPasses: 3, maxPasses: 3 } });
    sim.applyCommands([{ type: 'startMower' }]);
    run(sim, 1);
    expect(sim.snapshot().mower!.lanes).toHaveLength(3);
    const dirs = new Set<number>();
    for (let t = 0; t < 800; t++) {
      sim.step();
      const m = sim.snapshot().mower;
      if (m?.phase === 'mowing') dirs.add(m.dir);
    }
    expect([...dirs].sort()).toEqual([-1, 1]);
  });

  it('survives a save round trip mid-pass and carries on identically', () => {
    const sim = yard({ lawnmower: MOW });
    antAt(sim, 300, 300);
    sim.applyCommands([{ type: 'startMower' }]);
    run(sim, 40);
    const copy = restoreSim(sim.serialize());
    expect(copy.snapshot().mower).toEqual(sim.snapshot().mower);
    const a = run(sim, 200);
    const b = run(copy, 200);
    expect(b).toEqual(a);
    expect(copy.ants.count).toBe(sim.ants.count);
  });
});

describe('yard footsteps', () => {
  const WALK = { minFeet: 8, maxFeet: 8, warningTicks: 10 };

  it('walks a line of feet: shadows one after another, then stamps', () => {
    const sim = yard({ yardSteps: WALK });
    sim.applyCommands([{ type: 'startYardSteps' }]);
    const shadows: number[] = [];
    const stamps: number[] = [];
    for (let t = 0; t < 400; t++) {
      sim.step();
      for (const e of sim.snapshot().events) {
        if (e.type === 'footstepWarning') shadows.push(t);
        if (e.type === 'footstep') stamps.push(t);
      }
    }
    expect(shadows).toHaveLength(8);
    expect(stamps).toHaveLength(8);
    // Shadow telegraph: each stamp lands exactly shadowTicks after its shadow appeared.
    const warn = sim.config.yardSteps.shadowTicks;
    stamps.forEach((t, k) => expect(t - shadows[k]!).toBe(warn));
    // Spaced a stride-time apart.
    for (let k = 1; k < shadows.length; k++) {
      expect(shadows[k]! - shadows[k - 1]!).toBe(sim.config.yardSteps.strideTicks);
    }
  });

  it('stamps only surface ants under a foot', () => {
    const sim = yard({ yardSteps: WALK });
    sim.applyCommands([{ type: 'startYardSteps' }]);
    sim.step();
    const feet = sim.snapshot().footsteps!;
    expect(feet.length).toBeGreaterThan(0);
    const f = feet[0]!;
    antAt(sim, f.x, f.y);
    antAt(sim, f.x, f.y > 500 ? f.y - f.radius - 25 : f.y + f.radius + 25);
    const buried = antAt(sim, f.x, f.y);
    sim.ants.layer[buried] = 1;
    const events = run(sim, 60);
    const first = events.find((e) => e.type === 'footstep');
    expect(first).toMatchObject({ kills: 1 });
    expect(sim.ants.count).toBe(2);
  });

  it('warns about a walk ahead of time and is deterministic', () => {
    const first = (seed: number): { t: number; ticks: number } => {
      const sim = yard({ seed, yardSteps: { enabled: true, minGap: 300, maxGap: 900 } });
      for (let t = 1; t < 5000; t++) {
        sim.step();
        const w = sim.snapshot().events.find((e) => e.type === 'humansWarning');
        if (w?.type === 'humansWarning') return { t, ticks: w.ticks };
      }
      return { t: -1, ticks: -1 };
    };
    const a = first(9);
    expect(a.t).toBeGreaterThan(0);
    expect(first(9)).toEqual(a);
  });

  it('survives a save round trip mid-walk', () => {
    const sim = yard({ yardSteps: WALK });
    antAt(sim, 400, 400);
    sim.applyCommands([{ type: 'startYardSteps' }]);
    run(sim, 60);
    const copy = restoreSim(sim.serialize());
    expect(copy.snapshot().footsteps).toEqual(sim.snapshot().footsteps);
    expect(run(copy, 200)).toEqual(run(sim, 200));
  });
});

describe('hazards in the campaign', () => {
  it('varies the visit frequency per yard patch and leaves rooms to the house footsteps', () => {
    const defs = buildLayout(11);
    const yards = defs.filter((d) => d.kind === 'yard');
    expect(new Set(yards.map((d) => d.mower)).size).toBeGreaterThan(3);
    expect(
      defs.filter((d) => d.kind === 'room').every((d) => d.mower === 0 && d.walkers === 0),
    ).toBe(true);
    expect(PLAYER_COLONY).toBe(0);
  });
});
