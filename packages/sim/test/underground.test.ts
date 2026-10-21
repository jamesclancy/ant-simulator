import { describe, expect, it } from 'vitest';
import { ANT_LAYER_OFFSET, ANT_STRIDE, ChamberKind, NEST_TILE, TileType } from '@ant/shared';
import type { ColonyConfig } from '@ant/shared';
import { createSim } from '../src';

const base = { seed: 7, worldSize: 1024, initialAnts: 120, foodSources: 0, colonies: 1 };
const quiet: Partial<ColonyConfig> = {
  upkeepPerAnt: 0,
  queenUpkeep: 0,
  maxLayRate: 0,
  casteRatio: { worker: 1, soldier: 0, breeder: 0 },
};

function run(ticks: number, colony: Partial<ColonyConfig> = {}, seed = base.seed) {
  const sim = createSim({
    spiders: 0,
    antlions: 0,
    ...base,
    seed,
    colony: { ...quiet, ...colony },
  });
  for (let t = 0; t < ticks; t++) sim.step();
  return sim;
}

describe('underground terrain', () => {
  it('starts with a shaft from the surface down to a queen chamber', () => {
    const { grid } = createSim(base).colony;
    const ex = grid.entranceX;
    expect(grid.tiles[grid.idx(ex, 0)]).toBe(TileType.Tunnel);
    expect(grid.tiles[grid.idx(ex + 20, 0)]).toBe(TileType.Air);
    for (let y = 0; y <= 8; y++) expect(grid.isOpen(ex, y)).toBe(true);
    expect(grid.kinds[grid.idx(ex, 9)]).toBe(ChamberKind.Queen);
    expect(grid.nurseryCount).toBeGreaterThan(0);
    expect(grid.foodTiles.length).toBeGreaterThan(0);
    let rock = 0;
    for (const t of grid.tiles) if (t === TileType.Rock) rock++;
    expect(rock).toBeGreaterThan(20);
  });

  it('digs soil into tunnels deterministically', () => {
    const a = run(1500);
    const b = run(1500);
    const start = createSim(base).colony.grid.openCount;
    expect(a.colony.grid.openCount).toBeGreaterThan(start + 10);
    expect(Array.from(a.colony.grid.tiles)).toEqual(Array.from(b.colony.grid.tiles));
    expect(a.colony.dirt).toBeGreaterThan(0);
    // A different seed digs a different nest.
    expect(Array.from(run(1500, {}, 8).colony.grid.tiles)).not.toEqual(
      Array.from(a.colony.grid.tiles),
    );
  });

  it('keeps every dug tile connected to the entrance', () => {
    const sim = run(2500);
    const { grid, toEntrance } = sim.colony;
    for (let i = 0; i < grid.size; i++) {
      if (grid.isOpenIndex(i)) expect(toEntrance.dist[i]).toBeLessThan(0xffff);
    }
  });

  it('stops digging at the open-tile cap', () => {
    const sim = run(2500, { maxOpenFraction: 0.02 });
    const { grid } = sim.colony;
    expect(grid.openCount).toBeLessThan(grid.size * 0.02 + 40);
  });

  it('only digs when diggers are assigned', () => {
    const none = run(800, { behaviorRatio: { forage: 1, dig: 0, nurse: 0 } });
    expect(none.colony.grid.openCount).toBe(createSim(base).colony.grid.openCount);
  });
});

describe('layer transitions', () => {
  it('sends food underground, into the store, and the ant back up', () => {
    const sim = createSim({
      spiders: 0,
      antlions: 0,
      ...base,
      initialAnts: 0,
      colony: { ...quiet, startFood: 0, behaviorRatio: { forage: 1, dig: 0, nurse: 0 } },
    });
    const { nest } = sim.world;
    sim.applyCommands([{ type: 'spawnAnts', count: 1, x: nest.x, y: nest.y }]);
    const { ants } = sim;
    ants.x[0] = nest.x + nest.radius * 0.5;
    ants.y[0] = nest.y;
    ants.carrying[0] = 1;
    let sawUnderground = false;
    for (let t = 0; t < 600 && !(sawUnderground && ants.layer[0] === 0); t++) {
      sim.step();
      if (ants.layer[0] === 1) {
        sawUnderground = true;
        expect(ants.y[0]).toBeLessThan(NEST_TILE * sim.colony.grid.height);
      }
    }
    expect(sawUnderground).toBe(true);
    expect(nest.store).toBe(1);
    expect(ants.carrying[0]).toBe(0);
    expect(ants.layer[0]).toBe(0);
  });

  it('conserves food while it is carried underground', () => {
    const sim = createSim({
      spiders: 0,
      antlions: 0,
      ...base,
      initialAnts: 300,
      foodSources: 0,
      colony: { ...quiet, startFood: 0, behaviorRatio: { forage: 1, dig: 0, nurse: 0 } },
    });
    sim.applyCommands([{ type: 'placeFood', x: 512 + 150, y: 512, amount: 500 }]);
    for (let t = 0; t < 1500; t++) sim.step();
    let held = 0;
    for (let i = 0; i < sim.ants.count; i++) held += Math.max(0, sim.ants.carrying[i]!);
    const pile = [...sim.world.food.list()].reduce((s, f) => s + f.amount, 0);
    expect(sim.world.nest.store).toBeGreaterThan(20);
    expect(held + pile + sim.world.nest.store).toBeCloseTo(500);
  });

  it('puts the layer in the snapshot and the grid only when it changes', () => {
    const sim = run(300);
    const first = sim.snapshot({ nestGrid: true });
    expect(first.nestGrids?.[0]?.cells.length).toBe(96 * 64);
    expect(sim.snapshot().nestGrids).toBeUndefined();
    const under = [...Array(first.antCount).keys()].filter(
      (i) => first.ants[i * ANT_STRIDE + ANT_LAYER_OFFSET] === 1,
    );
    expect(under.length).toBeGreaterThan(10);
    // Digging eventually changes the grid; it is then re-sent exactly once.
    let resent = false;
    for (let t = 0; t < 3000 && !resent; t++) {
      sim.step();
      resent = sim.snapshot().nestGrids !== undefined;
    }
    expect(resent).toBe(true);
    expect(sim.snapshot().nestGrids).toBeUndefined();
    expect(first.colonies[0]!.underground).toBe(under.length);
  });

  it('keeps underground ants on open tiles', () => {
    const sim = run(1200);
    const { grid } = sim.colony;
    const { ants } = sim;
    let n = 0;
    for (let i = 0; i < ants.count; i++) {
      if (ants.layer[i] !== 1) continue;
      n++;
      expect(
        grid.isOpen(Math.floor(ants.x[i]! / NEST_TILE), Math.floor(ants.y[i]! / NEST_TILE)),
      ).toBe(true);
    }
    expect(n).toBeGreaterThan(20);
  });
});
