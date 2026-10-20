import { describe, expect, it } from 'vitest';
import { PheromoneField, createSim } from '../src';

const field = (over: Partial<ConstructorParameters<typeof PheromoneField>[0]> = {}) =>
  new PheromoneField({ worldSize: 64, resolution: 16, ...over });

describe('PheromoneField deposit/sample', () => {
  it('deposits into the containing cell and clamps to max', () => {
    const f = field();
    f.deposit('food', 5, 9, 0.4); // cell size 4 -> (1, 2)
    expect(f.layer('food')[2 * 16 + 1]).toBeCloseTo(0.4);
    f.deposit('food', 5, 9, 5);
    expect(f.layer('food')[2 * 16 + 1]).toBe(1);
    expect(f.total('home')).toBe(0);
  });

  it('ignores out-of-world deposits', () => {
    const f = field();
    f.deposit('food', -1, 5, 1);
    f.deposit('food', 5, 64, 1);
    expect(f.total('food')).toBe(0);
  });

  it('samples bilinearly between cell centres', () => {
    const f = field();
    f.deposit('food', 6, 6, 1); // cell (1,1), centre at (6,6)
    expect(f.sample('food', 6, 6)).toBeCloseTo(1);
    expect(f.sample('food', 10, 6)).toBeCloseTo(0); // next centre
    expect(f.sample('food', 8, 6)).toBeCloseTo(0.5);
    expect(f.sample('food', 8, 8)).toBeCloseTo(0.25);
  });

  it('clamps sampling outside the world and returns 0 for unallocated layers', () => {
    const f = field();
    f.deposit('food', 2, 2, 1);
    expect(f.sample('food', -100, -100)).toBeCloseTo(1);
    expect(f.sample('alarm', 2, 2)).toBe(0);
  });
});

describe('PheromoneField update', () => {
  it('evaporates to exactly zero', () => {
    const f = field({ layers: { food: { diffusion: 0, evaporation: 0.1 } } });
    f.deposit('food', 8, 8, 1);
    f.update();
    expect(f.total('food')).toBeCloseTo(0.9);
    for (let i = 0; i < 200; i++) f.update();
    expect(f.total('food')).toBe(0);
  });

  it('diffusion spreads and conserves mass', () => {
    const f = field({ layers: { food: { diffusion: 0.4, evaporation: 0 } } });
    f.deposit('food', 8, 8, 1);
    f.update();
    const d = f.layer('food');
    expect(d[2 * 16 + 2]).toBeLessThan(1);
    expect(d[2 * 16 + 3]).toBeGreaterThan(0);
    expect(d[3 * 16 + 3]).toBeGreaterThan(0); // diagonal via separable passes
    for (let i = 0; i < 400; i++) f.update();
    expect(f.total('food')).toBeCloseTo(1, 4);
    // Eventually near-uniform.
    expect(Math.max(...d) - Math.min(...d)).toBeLessThan(0.01);
  });

  it('conserves mass at corners (reflecting borders)', () => {
    const f = field({ layers: { home: { diffusion: 0.5, evaporation: 0 } } });
    f.deposit('home', 0, 0, 1);
    for (let i = 0; i < 20; i++) f.update();
    expect(f.total('home')).toBeCloseTo(1, 4);
  });

  it('clear zeroes one or all layers', () => {
    const f = field();
    f.deposit('food', 8, 8, 1);
    f.deposit('home', 8, 8, 1);
    f.clear('food');
    expect(f.total('food')).toBe(0);
    expect(f.total('home')).toBe(1);
    f.clear();
    expect(f.total('home')).toBe(0);
  });

  it('quantizes to bytes, layer-major', () => {
    const f = field();
    f.deposit('home', 8, 8, 1);
    const q = f.quantize();
    expect(q.length).toBe(2 * 256);
    expect(q[256 + 2 * 16 + 2]).toBe(255);
    expect(q[2 * 16 + 2]).toBe(0);
  });
});

describe('pheromones in sim', () => {
  const cfg = { seed: 5, worldSize: 512, initialAnts: 100, pheromoneResolution: 64 };

  it('is deterministic', () => {
    const run = () => {
      const sim = createSim(cfg);
      sim.applyCommands([
        { type: 'depositPheromone', pheromone: 'food', x: 100, y: 100, amount: 1 },
      ]);
      for (let i = 0; i < 60; i++) sim.step();
      return Array.from(sim.snapshot({ pheromones: true }).pheromones!.data);
    };
    expect(run()).toEqual(run());
  });

  it('handles commands and ant trails', () => {
    const sim = createSim(cfg);
    for (let i = 0; i < 10; i++) sim.step();
    expect(sim.pheromones.total('home')).toBeGreaterThan(0);
    sim.applyCommands([{ type: 'clearPheromones' }]);
    expect(sim.pheromones.total('home')).toBe(0);
    sim.applyCommands([{ type: 'depositPheromone', pheromone: 'alarm', x: 1, y: 1, amount: 1 }]); // unallocated: ignored
    expect(sim.pheromones.total('food')).toBe(0);
  });

  it('includes pheromones on request or every N ticks', () => {
    const sim = createSim(cfg);
    expect(sim.snapshot().pheromones).toBeDefined(); // tick 0
    sim.step();
    expect(sim.snapshot().pheromones).toBeUndefined();
    const s = sim.snapshot({ pheromones: true });
    // The player colony's field: its trails, alarm, and the enemy scent it can smell.
    expect(s.pheromones!.data.length).toBe(4 * 64 * 64);
    expect(s.pheromones!.types).toEqual(['food', 'home', 'alarm', 'enemy']);
  });
});
