import { describe, expect, it } from 'vitest';
import { Caste, NEST_TILE, TileType } from '@ant/shared';
import type { SimConfigInput, SimEvent } from '@ant/shared';
import { createSim, placeAntlions, restoreSim } from '../src';
import type { Sim } from '../src';

const FROZEN = {
  maxLayRate: 0,
  upkeepPerAnt: 0,
  queenUpkeep: 0,
  behaviorRatio: { forage: 1, dig: 0, nurse: 0 },
};

/** One colony in an empty yard; no spiders, pits or scheduled rain unless asked for. */
function yard(extra: SimConfigInput = {}): Sim {
  return createSim({
    seed: 3,
    worldSize: 1024,
    initialAnts: 0,
    foodSources: 0,
    colonies: 1,
    spiders: 0,
    antlions: 0,
    rain: { enabled: false },
    colony: FROZEN,
    ...extra,
  });
}

function run(sim: Sim, ticks: number, events?: SimEvent[]): void {
  for (let t = 0; t < ticks; t++) {
    sim.step();
    if (events) events.push(...sim.snapshot().events);
  }
}

function levelAt(sim: Sim, ex: number, row: number, colony = 0): number {
  const g = sim.colonies[colony]!.grid;
  return sim.weather.waterOf(colony)!.at(g.idx(ex, row));
}

/** Extends the entrance shaft of colony 0 down to `row`. */
function digShaft(sim: Sim, row: number): void {
  const g = sim.colony.grid;
  for (let y = 0; y <= row; y++) g.set(g.idx(g.entranceX, y), TileType.Tunnel);
  g.refresh();
}

describe('rain', () => {
  it('washes pheromone trails away much faster than dry weather', () => {
    const trail = (rain: boolean): number => {
      const sim = yard();
      for (let i = 0; i < 30; i++) {
        sim.applyCommands([
          { type: 'depositPheromone', pheromone: 'food', x: 300 + i * 4, y: 300, amount: 1 },
        ]);
      }
      if (rain) sim.applyCommands([{ type: 'startRain', ticks: 400 }]);
      run(sim, 120);
      return sim.pheromones.total('food');
    };
    const dry = trail(false);
    const wet = trail(true);
    expect(dry).toBeGreaterThan(5);
    expect(wet).toBeLessThan(dry * 0.25);
  });

  it('slows surface ants and restores their speed afterwards', () => {
    const travelled = (rain: boolean): number => {
      const sim = yard({ behavior: { jitter: 0, pheromones: false } });
      sim.applyCommands([{ type: 'spawnAnts', count: 20, x: 512, y: 512 }]);
      if (rain) sim.applyCommands([{ type: 'startRain', ticks: 1000 }]);
      run(sim, 150);
      const x0 = sim.snapshot().ants;
      run(sim, 40);
      const x1 = sim.snapshot().ants;
      let d = 0;
      for (let i = 0; i < sim.ants.count; i++) {
        d += Math.hypot(x1[i * 6]! - x0[i * 6]!, x1[i * 6 + 1]! - x0[i * 6 + 1]!);
      }
      return d / sim.ants.count;
    };
    expect(travelled(true)).toBeLessThan(travelled(false) * 0.8);
  });

  it('warns about 10 seconds ahead, then rains for a seeded duration', () => {
    const sim = yard({
      rain: { enabled: true, minGap: 400, maxGap: 400, minDuration: 300, maxDuration: 300 },
    });
    const events: SimEvent[] = [];
    const at: Record<string, number> = {};
    for (let t = 0; t < 1000; t++) {
      sim.step();
      for (const e of sim.snapshot().events) {
        if (e.type === 'rainWarning' || e.type === 'rainStarted' || e.type === 'rainEnded') {
          at[e.type] ??= t;
          events.push(e);
        }
      }
    }
    expect(at.rainWarning).toBeGreaterThanOrEqual(190);
    expect(at.rainWarning).toBeLessThanOrEqual(210);
    expect(at.rainStarted! - at.rainWarning!).toBeGreaterThanOrEqual(190);
    expect(at.rainEnded! - at.rainStarted!).toBeGreaterThanOrEqual(295);
    expect(at.rainEnded! - at.rainStarted!).toBeLessThanOrEqual(305);
  });

  it('is rarer on easy and more frequent on hard', () => {
    const firstGap = (difficulty: 'easy' | 'normal' | 'hard') =>
      yard({ difficulty, rain: { enabled: true } }).weather.info().ticksToRain;
    expect(firstGap('easy')).toBeGreaterThan(firstGap('hard'));
  });

  it('floods down the shaft from the entrance, thinning with depth, then drains', () => {
    const sim = yard();
    digShaft(sim, 40);
    const ex = sim.colony.grid.entranceX;
    sim.applyCommands([{ type: 'startRain', ticks: 800 }]);
    run(sim, 20);
    const early = levelAt(sim, ex, 6);
    run(sim, 700);
    expect(levelAt(sim, ex, 0)).toBeGreaterThan(0.8);
    expect(levelAt(sim, ex, 3)).toBeGreaterThan(levelAt(sim, ex, 8));
    expect(levelAt(sim, ex, 8)).toBeGreaterThan(levelAt(sim, ex, 16));
    // The front takes time to arrive, and deep tunnels stay (almost) dry.
    expect(early).toBeLessThan(levelAt(sim, ex, 6));
    expect(levelAt(sim, ex, 8)).toBeGreaterThan(0.04);
    expect(levelAt(sim, ex, 30)).toBeLessThan(0.01);
    expect(sim.weather.wetTiles).toBeGreaterThan(10);

    run(sim, 100);
    expect(sim.weather.raining).toBe(false);
    run(sim, 1500);
    expect(sim.weather.wetTiles).toBe(0);
  });

  it('only sends water to the client when it changed', () => {
    const sim = yard();
    expect(sim.snapshot().waterGrids).toBeUndefined();
    sim.applyCommands([{ type: 'startRain', ticks: 200 }]);
    run(sim, 8);
    const wet = sim.snapshot();
    expect(wet.waterGrids?.[0]?.colony).toBe(0);
    expect(wet.waterGrids?.[0]?.levels.some((v) => v > 0)).toBe(true);
    run(sim, 1);
    expect(sim.snapshot().waterGrids).toBeUndefined(); // throttled between updates
    run(sim, 1800);
    sim.snapshot(); // final "dry" update
    run(sim, 8);
    expect(sim.snapshot().waterGrids).toBeUndefined();
  });

  it('floods both colonies', () => {
    const sim = createSim({ seed: 3, worldSize: 1024, initialAnts: 0, spiders: 0, antlions: 0 });
    sim.applyCommands([{ type: 'startRain', ticks: 300 }]);
    run(sim, 200);
    for (const c of sim.colonies) {
      expect(sim.weather.waterOf(c.id)!.at(c.grid.entranceIndex)).toBeGreaterThan(0.5);
    }
  });

  it('drowns ants in flooded tunnels (and not in dry ones)', () => {
    const lost = (flood: boolean): number => {
      const sim = yard();
      sim.applyCommands([{ type: 'spawnAnts', count: 12, x: 0, y: 0, caste: Caste.Breeder }]);
      const { grid } = sim.colony;
      const lv = new Float32Array(grid.size);
      for (let i = 0; i < grid.size; i++) if (flood && grid.isOpenIndex(i)) lv[i] = 0.95;
      sim.weather.waterOf(0)!.setState({ levels: lv, version: 5 });
      // Everyone is in the nest, in the nursery.
      const t = grid.nurseryTiles[0]!;
      for (let i = 0; i < sim.ants.count; i++) {
        sim.ants.layer[i] = 1;
        sim.ants.x[i] = ((t % grid.width) + 0.5) * NEST_TILE;
        sim.ants.y[i] = (Math.floor(t / grid.width) + 0.5) * NEST_TILE;
      }
      sim.ants.hp.fill(3, 0, 12);
      run(sim, 120);
      return 12 - sim.colony.population;
    };
    expect(lost(false)).toBe(0);
    expect(lost(true)).toBeGreaterThan(8);
  });

  it('kills brood in a flooded nursery only', () => {
    const brood = (flood: boolean): number => {
      const sim = yard();
      for (let i = 0; i < 40; i++) sim.colony.brood.add();
      const { grid } = sim.colony;
      const lv = new Float32Array(grid.size);
      if (flood) for (const t of grid.nurseryTiles) lv[t] = 0.9;
      sim.weather.waterOf(0)!.setState({ levels: lv, version: 5 });
      run(sim, 150);
      return sim.colony.brood.count;
    };
    expect(brood(false)).toBe(40);
    expect(brood(true)).toBeLessThan(30);
  });

  it('the player ant drowns into a swap, not a crash', () => {
    const sim = yard();
    sim.applyCommands([{ type: 'spawnAnts', count: 5, x: 500, y: 500 }]);
    sim.step(); // the player ant is picked on the first step
    const p = sim.player.index;
    const { grid } = sim.colony;
    const lv = new Float32Array(grid.size);
    for (let i = 0; i < grid.size; i++) if (grid.isOpenIndex(i)) lv[i] = 1;
    sim.weather.waterOf(0)!.setState({ levels: lv, version: 5 });
    sim.ants.layer[p] = 1;
    sim.ants.hp[p] = 0.05;
    sim.ants.x[p] = (grid.entranceX + 0.5) * NEST_TILE;
    sim.ants.y[p] = 5.5 * NEST_TILE;
    const events: SimEvent[] = [];
    run(sim, 5, events);
    expect(events.some((e) => e.type === 'playerEaten' && e.cause === 'drowned')).toBe(true);
    expect(events.some((e) => e.type === 'playerSwapped')).toBe(true);
  });
});

describe('antlion pit', () => {
  const PIT = { x: 500, y: 500 };
  const pit = (extra: SimConfigInput = {}): Sim => {
    const sim = yard({ behavior: { pheromones: false }, ...extra });
    sim.antlions.add(PIT.x, PIT.y);
    return sim;
  };
  const dist = (sim: Sim, i: number): number =>
    Math.hypot(sim.ants.x[i]! - PIT.x, sim.ants.y[i]! - PIT.y);

  it('pulls ants in and eats them', () => {
    const sim = pit({ antlion: { escape: 0 } });
    sim.applyCommands([{ type: 'spawnAnts', count: 5, x: PIT.x + 30, y: PIT.y }]);
    for (let i = 0; i < 5; i++) {
      sim.ants.x[i] = PIT.x + 40;
      sim.ants.y[i] = PIT.y;
    }
    const start = Array.from({ length: 5 }, (_, i) => dist(sim, i));
    run(sim, 6);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(Array.from({ length: 5 }, (_, i) => dist(sim, i)))).toBeLessThan(mean(start));
    run(sim, 400);
    expect(sim.ants.count).toBe(0);
    expect(sim.colony.losses).toBe(5);
  });

  it('leaves ants outside the slope alone', () => {
    const sim = pit({ antlion: { escape: 0 } });
    sim.applyCommands([{ type: 'spawnAnts', count: 3, x: PIT.x + 200, y: PIT.y }]);
    run(sim, 20);
    expect(sim.ants.count).toBe(3);
  });

  it('lets ants scramble out, soldiers more readily than workers', () => {
    const survivors = (caste: Caste, escape: number): number => {
      const sim = pit({ antlion: { escape, mobSize: 1000 } });
      sim.applyCommands([{ type: 'spawnAnts', count: 30, x: PIT.x + 30, y: PIT.y, caste }]);
      for (let i = 0; i < 30; i++) {
        sim.ants.x[i] = PIT.x + 30;
        sim.ants.y[i] = PIT.y;
      }
      run(sim, 60);
      return sim.ants.count;
    };
    expect(survivors(Caste.Worker, 0)).toBe(0);
    const workers = survivors(Caste.Worker, 0.01);
    expect(workers).toBeGreaterThan(0);
    expect(survivors(Caste.Soldier, 0.01)).toBeGreaterThan(workers);
  });

  it('is overwhelmed by a big mob: food drops and the pit goes inert', () => {
    const sim = pit();
    sim.applyCommands([{ type: 'spawnAnts', count: 14, x: PIT.x + 20, y: PIT.y }]);
    const food0 = [...sim.world.food.list()].length;
    const events: SimEvent[] = [];
    run(sim, 200, events);
    expect(events.some((e) => e.type === 'antlionKilled')).toBe(true);
    expect(sim.antlions.info()[0]!.alive).toBe(false);
    expect(sim.ants.count).toBe(14);
    expect([...sim.world.food.list()].length).toBe(food0 + 1);
    // Inert sand: a lone ant is no longer pulled or eaten.
    sim.applyCommands([{ type: 'clearAnts' }]);
    sim.applyCommands([{ type: 'spawnAnts', count: 1, x: PIT.x + 2, y: PIT.y }]);
    run(sim, 100);
    expect(sim.ants.count).toBe(1);
  });

  it('eats the player ant, and another ant takes over', () => {
    const sim = pit({ antlion: { escape: 0 } });
    sim.applyCommands([{ type: 'spawnAnts', count: 4, x: 100, y: 100 }]);
    sim.step();
    const p = sim.player.index;
    sim.ants.x[p] = PIT.x + 20;
    sim.ants.y[p] = PIT.y;
    const events: SimEvent[] = [];
    run(sim, 200, events);
    expect(events.some((e) => e.type === 'playerEaten' && e.cause === 'antlion')).toBe(true);
    expect(events.some((e) => e.type === 'playerSwapped')).toBe(true);
    expect(sim.snapshot().player).not.toBeNull();
  });

  it('is placed deterministically, clear of the nests and of each other', () => {
    const sim = createSim({ seed: 11, antlions: 3 });
    const a = sim.snapshot().antlions;
    expect(a).toHaveLength(3);
    expect(createSim({ seed: 11, antlions: 3 }).snapshot().antlions).toEqual(a);
    expect(createSim({ seed: 12, antlions: 3 }).snapshot().antlions).not.toEqual(a);
    for (const p of a) {
      for (const n of sim.world.nests)
        expect(Math.hypot(p.x - n.x, p.y - n.y)).toBeGreaterThan(300);
    }
    expect(placeAntlions(0, 2048, 1, [])).toEqual([]);
    expect(createSim({ antlions: 0 }).snapshot().antlions).toEqual([]);
    expect(createSim().snapshot().antlions).toHaveLength(2);
  });
});

describe('hazard determinism and saves', () => {
  const play = (): Sim => {
    const sim = createSim({ seed: 8, worldSize: 1024, initialAnts: 120, antlions: 3 });
    sim.applyCommands([{ type: 'startRain', ticks: 500 }]);
    run(sim, 700);
    return sim;
  };

  it('same seed, same hazards', () => {
    expect(play().serialize()).toEqual(play().serialize());
  });

  it('a mid-flood save continues identically', () => {
    const sim = createSim({ seed: 8, worldSize: 1024, initialAnts: 120, antlions: 3 });
    sim.applyCommands([{ type: 'startRain', ticks: 600 }]);
    run(sim, 250);
    expect(sim.weather.wetTiles).toBeGreaterThan(5);
    const copy = restoreSim(sim.serialize());
    expect(copy.getState()).toEqual(sim.getState());
    expect(copy.weather.info()).toEqual(sim.weather.info());
    run(sim, 500);
    run(copy, 500);
    expect(copy.serialize()).toEqual(sim.serialize());
  });
});
