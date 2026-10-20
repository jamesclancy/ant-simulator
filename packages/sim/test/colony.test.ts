import { describe, expect, it } from 'vitest';
import { AntRole } from '@ant/shared';
import type { ColonyConfig } from '@ant/shared';
import { createSim } from '../src';

const WORKERS_ONLY = { worker: 1, soldier: 0, breeder: 0 };
const base = { seed: 11, worldSize: 1024, foodSources: 0, colonies: 1 };

function sim(initialAnts: number, colony: Partial<ColonyConfig> = {}) {
  return createSim({ ...base, initialAnts, colony: { casteRatio: WORKERS_ONLY, ...colony } });
}

function roles(s: ReturnType<typeof sim>): number[] {
  const out = [0, 0, 0];
  for (let i = 0; i < s.ants.count; i++) out[s.ants.role[i]!]!++;
  return out;
}

describe('behaviour allocation', () => {
  it('assigns roles per the ratio and follows setBehaviorRatio', () => {
    const s = sim(200, { maxLayRate: 0, upkeepPerAnt: 0, queenUpkeep: 0 });
    for (let t = 0; t < 200; t++) s.step();
    expect(roles(s)).toEqual([120, 40, 40]);
    s.applyCommands([{ type: 'setBehaviorRatio', forage: 1, dig: 1, nurse: 2 }]);
    for (let t = 0; t < 400; t++) s.step();
    expect(roles(s)).toEqual([50, 50, 100]);
  });

  it('puts non-foragers underground and keeps foragers on the surface', () => {
    const s = sim(200, { maxLayRate: 0, upkeepPerAnt: 0, queenUpkeep: 0 });
    for (let t = 0; t < 1500; t++) s.step();
    let underNonForage = 0;
    let nonForage = 0;
    for (let i = 0; i < s.ants.count; i++) {
      if (s.ants.role[i] === AntRole.Forage) continue;
      nonForage++;
      underNonForage += s.ants.layer[i]!;
    }
    expect(underNonForage).toBeGreaterThan(nonForage * 0.9);
  });

  it('is deterministic overall', () => {
    const run = () => {
      const s = sim(150);
      s.applyCommands([{ type: 'placeFood', x: 700, y: 520, amount: 400 }]);
      for (let t = 0; t < 1500; t++) s.step();
      return s.snapshot({ pheromones: true, nestGrid: true });
    };
    expect(run()).toEqual(run());
  });
});

describe('brood lifecycle', () => {
  const fed = { startFood: 300, upkeepPerAnt: 0, queenUpkeep: 0 };

  it('turns food into eggs, larvae, pupae and new ants', () => {
    const s = sim(60, fed);
    expect(s.ants.count).toBe(60);
    let sawLarva = false;
    let sawPupa = false;
    for (let t = 0; t < 2500; t++) {
      s.step();
      sawLarva ||= s.colony.brood.larvae > 0;
      sawPupa ||= s.colony.brood.pupae > 0;
    }
    expect(sawLarva && sawPupa).toBe(true);
    expect(s.ants.count).toBeGreaterThan(70);
    // Every egg cost food (and larvae ate): the store went down.
    expect(s.world.nest.store).toBeLessThan(300);
  });

  it('lays nothing without food, and speeds up with nurses', () => {
    const hungry = sim(60, { startFood: 0, upkeepPerAnt: 0, queenUpkeep: 0 });
    for (let t = 0; t < 600; t++) hungry.step();
    expect(hungry.colony.brood.count).toBe(0);
    expect(hungry.ants.count).toBe(60);

    const born = (nurse: number) => {
      const s = sim(80, { ...fed, behaviorRatio: { forage: 1 - nurse, dig: 0, nurse } });
      for (let t = 0; t < 1600; t++) s.step();
      return s.ants.count;
    };
    expect(born(0.5)).toBeGreaterThan(born(0));
  });

  it('caps brood by nursery space', () => {
    const s = sim(40, { ...fed, startFood: 5000, broodPerTile: 0.1, maxLayRate: 1 });
    for (let t = 0; t < 300; t++) s.step();
    const cap = s.colony.grid.nurseryCount * 0.1;
    expect(s.colony.brood.count).toBeLessThanOrEqual(Math.ceil(cap));
  });
});

describe('starvation', () => {
  it('kills ants when the store runs dry, then the queen', () => {
    const s = sim(200, {
      startFood: 5,
      upkeepPerAnt: 0.01,
      starveRate: 0.002,
      queenStarveTicks: 400,
    });
    for (let t = 0; t < 300; t++) s.step();
    expect(s.ants.count).toBeLessThan(200);
    expect(s.colony.queenAlive).toBe(true);
    for (let t = 0; t < 400; t++) s.step();
    expect(s.colony.queenAlive).toBe(false);
    expect(s.colony.lost).toBe(true);
    expect(s.snapshot().colonies[0]!.lost).toBe(true);
    const n = s.colony.brood.count;
    for (let t = 0; t < 200; t++) s.step();
    expect(s.colony.brood.count).toBeLessThanOrEqual(n); // no more eggs
  });
});
