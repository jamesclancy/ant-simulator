import { describe, expect, it } from 'vitest';
import { AntState, Caste, DEFAULT_COMBAT } from '@ant/shared';
import type { Command } from '@ant/shared';
import { createSim, restoreSim } from '../src';
import type { Sim } from '../src';
import { ObstacleField, slid } from '../src/world';

const sandbox = (extra: Parameters<typeof createSim>[0] = {}): Sim =>
  createSim({
    seed: 5,
    worldSize: 1024,
    colonies: 1,
    initialAnts: 80,
    spiders: 0,
    antlions: 0,
    sandbox: true,
    winLose: false,
    ...extra,
  });

function surfaceAntsInRocks(sim: Sim): number {
  let n = 0;
  for (let i = 0; i < sim.ants.count; i++) {
    if (sim.ants.layer[i] === 0 && sim.world.obstacles.rockAt(sim.ants.x[i]!, sim.ants.y[i]!)) n++;
  }
  return n;
}

/** A wall of rocks across the world between the nest (centre) and the left edge. */
const wall = (x: number): Command[] =>
  Array.from({ length: 11 }, (_, k) => ({
    type: 'placeObstacle' as const,
    x,
    y: 100 + k * 80,
    radius: 50,
  }));

describe('ObstacleField', () => {
  it('blocks discs, clamps radii and removes by brush', () => {
    const f = new ObstacleField(1000);
    const id = f.add(500, 500, 40);
    expect(id).toBe(1);
    expect(f.blocked(500, 500)).toBe(true);
    expect(f.blocked(530, 500)).toBe(true);
    expect(f.blocked(560, 500)).toBe(false);
    expect(f.blocked(-5, 500)).toBe(false);
    f.add(100, 100, 1);
    expect(f.list()[1]!.radius).toBeGreaterThan(1);
    expect(f.removeNear(900, 900, 10)).toBe(0);
    expect(f.removeNear(520, 500, 5)).toBe(1);
    expect(f.blocked(500, 500)).toBe(false);
    expect(f.count).toBe(1);
  });

  it('slides along a rock face and lets a trapped ant walk out', () => {
    const f = new ObstacleField(1000);
    f.add(500, 500, 40);
    // Straight into the face: stays put.
    f.slide(450, 500, 470, 500);
    expect(slid).toEqual({ x: 450, y: 500 });
    // Diagonal into the face: keeps the clear component.
    f.slide(450, 470, 470, 490);
    expect(slid.y === 490 || slid.x === 470).toBe(true);
    expect(f.blocked(slid.x, slid.y)).toBe(false);
    // Clear ground: untouched.
    f.slide(100, 100, 102, 101);
    expect(slid).toEqual({ x: 102, y: 101 });
    // Inside a rock: free to leave, but not to go deeper into another one.
    f.slide(500, 500, 470, 500);
    expect(slid).toEqual({ x: 470, y: 500 });
  });

  it('avoid swerves before the rock and sides differ by parity', () => {
    const f = new ObstacleField(1000);
    f.add(500, 500, 40);
    expect(f.avoid(300, 500, 0, 20, 0)).toBe(0);
    const near0 = f.avoid(445, 500, 0, 20, 0);
    const near1 = f.avoid(445, 500, 0, 20, 1);
    expect(near0).not.toBe(0);
    expect(Math.sign(near0)).toBe(-Math.sign(near1));
  });

  it('round-trips its state', () => {
    const f = new ObstacleField(1000);
    f.add(200, 300, 30);
    f.add(700, 300, 60);
    const g = new ObstacleField(1000);
    g.setState(f.getState());
    expect(g.getState()).toEqual(f.getState());
    expect(g.blocked(700, 300)).toBe(true);
    expect(g.add(1, 1, 10)).toBe(3);
  });
});

describe('rocks in the sim', () => {
  it('keeps ants out of rocks while they forage, fight and walk home', () => {
    const sim = sandbox({ initialAnts: 150 });
    sim.applyCommands([
      ...wall(380),
      { type: 'spawnAnts', count: 60, x: 300, y: 500, colony: 0, caste: Caste.Soldier },
      { type: 'placeObstacle', x: 760, y: 520, radius: 90 },
    ]);
    expect(sim.world.obstacles.count).toBe(12);
    let inside = 0;
    for (let t = 0; t < 400; t++) {
      sim.step();
      if (t % 5 === 0) inside += surfaceAntsInRocks(sim);
    }
    expect(inside).toBe(0);
  });

  it('pushes ants out of a rock placed on top of them and crushes food under it', () => {
    const sim = sandbox();
    sim.applyCommands([
      { type: 'spawnAnts', count: 20, x: 700, y: 300, colony: 0 },
      { type: 'placeFood', x: 700, y: 300, amount: 100 },
    ]);
    const foods = sim.world.food.size;
    sim.applyCommands([{ type: 'placeObstacle', x: 700, y: 300, radius: 80 }]);
    expect(surfaceAntsInRocks(sim)).toBe(0);
    expect(sim.world.food.size).toBe(foods - 1);
  });

  it('refuses rocks on a nest entrance', () => {
    const sim = sandbox();
    const nest = sim.world.nests[0]!;
    sim.applyCommands([{ type: 'placeObstacle', x: nest.x + 10, y: nest.y, radius: 30 }]);
    expect(sim.world.obstacles.count).toBe(0);
  });

  it('is deterministic and survives a save round trip', () => {
    const script = (sim: Sim, from: number, to: number): void => {
      for (let t = from; t < to; t++) {
        if (t === 5) sim.applyCommands(wall(420));
        if (t === 40) sim.applyCommands([{ type: 'erase', x: 420, y: 100, radius: 60 }]);
        sim.step();
      }
    };
    const a = sandbox();
    const b = sandbox();
    script(a, 0, 300);
    script(b, 0, 300);
    expect(a.serialize()).toEqual(b.serialize());

    const copy = restoreSim(a.serialize());
    expect(copy.getState()).toEqual(a.getState());
    expect(copy.world.obstacles.count).toBe(a.world.obstacles.count);
    expect(copy.saveInfo().sandbox).toBe(true);
    // Rocks ride along in the next snapshot of a restored sim.
    expect(copy.snapshot().obstacles).toHaveLength(a.world.obstacles.count);
    for (let t = 300; t < 500; t++) {
      a.step();
      copy.step();
    }
    expect(copy.serialize()).toEqual(a.serialize());
  });

  it('sends the rock list only when it changes', () => {
    const sim = sandbox();
    expect(sim.snapshot().obstacles).toEqual([]);
    expect(sim.snapshot().obstacles).toBeUndefined();
    sim.applyCommands([{ type: 'placeObstacle', x: 100, y: 100, radius: 20 }]);
    expect(sim.snapshot().obstacles).toHaveLength(1);
    expect(sim.snapshot().obstacles).toBeUndefined();
    sim.applyCommands([{ type: 'clearObstacles' }]);
    expect(sim.snapshot().obstacles).toEqual([]);
  });
});

describe('sandbox commands', () => {
  it('ignores sandbox-only commands in a normal game', () => {
    const sim = createSim({ seed: 5, worldSize: 1024, colonies: 1, initialAnts: 20 });
    const hp = [...sim.config.combat.hp];
    sim.applyCommands([
      { type: 'placeObstacle', x: 100, y: 100, radius: 30 },
      { type: 'setCombat', params: { hp: [99, 99, 99] } },
      { type: 'setColonyParams', params: { eggCost: 99 } },
      { type: 'setPheromoneParams', pheromone: 'food', params: { evaporation: 0.5 } },
    ]);
    expect(sim.world.obstacles.count).toBe(0);
    expect(sim.config.combat.hp).toEqual(hp);
    expect(sim.colony.config.eggCost).not.toBe(99);
    expect(sim.pheromones.config.food.evaporation).not.toBe(0.5);
  });

  it('live-tunes combat, colony economy and pheromone layers', () => {
    const sim = sandbox({ colonies: 2 });
    sim.applyCommands([
      { type: 'setCombat', params: { contactRange: 33 } },
      { type: 'setColonyParams', params: { eggTicks: 7 } },
      { type: 'setColonyParams', colony: 1, params: { larvaTicks: 9 } },
      { type: 'setPheromoneParams', pheromone: 'home', params: { evaporation: 0.2 } },
    ]);
    expect(sim.config.combat.contactRange).toBe(33);
    expect(sim.colonies.map((c) => c.config.eggTicks)).toEqual([7, 7]);
    expect(sim.colonies[1]!.config.larvaTicks).toBe(9);
    expect(sim.colonies[0]!.config.larvaTicks).not.toBe(9);
    expect(sim.fields.map((f) => f.config.home.evaporation)).toEqual([0.2, 0.2]);
    expect(DEFAULT_COMBAT.contactRange).not.toBe(33);
  });

  it('keeps live tuning across a save, per colony', () => {
    const sim = sandbox({ colonies: 2, difficulty: 'hard' });
    sim.applyCommands([
      { type: 'setColonyParams', colony: 1, params: { maxLayRate: 0.5 } },
      { type: 'setColonyParams', params: { eggCost: 3 } },
      { type: 'setPheromoneParams', pheromone: 'food', params: { evaporation: 0.123 } },
      { type: 'setCombat', params: { contactRange: 11 } },
    ]);
    for (let t = 0; t < 30; t++) sim.step();
    const copy = restoreSim(sim.serialize());
    expect(copy.colonies.map((c) => c.config.maxLayRate)).toEqual(
      sim.colonies.map((c) => c.config.maxLayRate),
    );
    expect(copy.colonies[1]!.config.maxLayRate).toBe(0.5);
    expect(copy.colonies.map((c) => c.config.eggCost)).toEqual([3, 3]);
    expect(copy.fields[1]!.config.food.evaporation).toBe(0.123);
    expect(copy.config.combat.contactRange).toBe(11);
    for (let t = 0; t < 100; t++) {
      sim.step();
      copy.step();
    }
    expect(copy.serialize()).toEqual(sim.serialize());
  });

  it('erase clears ants, food, rocks, pits and spiders in the brush only', () => {
    const sim = sandbox();
    sim.applyCommands([
      { type: 'placeFood', x: 800, y: 870, amount: 50 },
      { type: 'placeFood', x: 200, y: 800, amount: 50 },
      { type: 'placeObstacle', x: 800, y: 780, radius: 20 },
      { type: 'placeObstacle', x: 200, y: 780, radius: 20 },
      { type: 'addAntlion', x: 800, y: 820 },
      { type: 'spawnSpider', x: 790, y: 800 },
      { type: 'spawnAnts', count: 10, x: 800, y: 800 },
    ]);
    const before = sim.world.food.size;
    sim.applyCommands([{ type: 'erase', x: 800, y: 800, radius: 80 }]);
    sim.step();
    expect(sim.world.food.size).toBe(before - 1);
    expect(sim.world.obstacles.count).toBe(1);
    expect(sim.antlions.count).toBe(0);
    expect(sim.spiders.count).toBe(0);
    for (let i = 0; i < sim.ants.count; i++) {
      expect(Math.hypot(sim.ants.x[i]! - 800, sim.ants.y[i]! - 800)).toBeGreaterThan(80);
    }
  });

  it('spawns either colony and caste, and clears pheromones', () => {
    const sim = sandbox({ colonies: 2 });
    const red = sim.colonies[1]!.population;
    sim.applyCommands([
      { type: 'spawnAnts', count: 7, x: 500, y: 500, colony: 1, caste: Caste.Soldier },
      { type: 'depositPheromone', pheromone: 'food', x: 500, y: 500, amount: 1 },
    ]);
    expect(sim.colonies[1]!.population).toBe(red + 7);
    expect(sim.colonies[1]!.castes[Caste.Soldier]).toBeGreaterThanOrEqual(7);
    expect(sim.pheromones.sample('food', 500, 500)).toBeGreaterThan(0);
    sim.applyCommands([{ type: 'clearPheromones' }]);
    expect(sim.pheromones.sample('food', 500, 500)).toBe(0);
  });

  it('only ends the game on a dead queen when win/lose is on', () => {
    for (const winLose of [false, true]) {
      const sim = sandbox({ colonies: 2, winLose });
      sim.colonies[1]!.killQueen('combat');
      sim.step();
      expect(sim.winner).toBe(winLose ? 0 : -1);
    }
  });

  it('stops a shower on command', () => {
    const sim = sandbox();
    sim.applyCommands([{ type: 'startRain', ticks: 5000 }]);
    for (let t = 0; t < 10; t++) sim.step();
    expect(sim.weather.raining).toBe(true);
    sim.applyCommands([{ type: 'stopRain' }]);
    for (let t = 0; t < sim.config.rain.rampTicks + 5; t++) sim.step();
    expect(sim.weather.raining).toBe(false);
  });

  it('holds the red colony still when the AI is off', () => {
    const ratio = (ai: boolean): number => {
      const sim = sandbox({ colonies: 2, ai, difficulty: 'hard' });
      for (let t = 0; t < 400; t++) sim.step();
      return sim.colonies[1]!.casteRatio.soldier;
    };
    expect(ratio(false)).toBe(ratio(false));
    expect(ratio(true)).not.toBe(ratio(false));
  });

  it('does not stall ants: foragers still bring food home around rocks', () => {
    const sim = sandbox({ foodSources: 0 });
    const nest = sim.world.nests[0]!;
    sim.applyCommands([
      { type: 'placeFood', x: nest.x + 250, y: nest.y, amount: 400 },
      { type: 'placeObstacle', x: nest.x + 120, y: nest.y, radius: 70 },
    ]);
    const pile = [...sim.world.food.list()][0]!;
    let carried = 0;
    for (let t = 0; t < 1500; t++) {
      sim.step();
      for (let i = 0; i < sim.ants.count; i++) {
        if (sim.ants.state[i] === AntState.CarryFood) carried++;
      }
    }
    expect(carried).toBeGreaterThan(0);
    expect(pile.amount).toBeLessThan(400);
  });
});
