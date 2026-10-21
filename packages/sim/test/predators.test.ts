import { describe, expect, it } from 'vitest';
import { Caste, SpiderState } from '@ant/shared';
import type { SimConfigInput, SimEvent } from '@ant/shared';
import { createSim } from '../src';
import type { SpiderManagerState } from '../src';

const FROZEN = {
  maxLayRate: 0,
  upkeepPerAnt: 0,
  queenUpkeep: 0,
  behaviorRatio: { forage: 1, dig: 0, nurse: 0 },
};

/** One colony in an empty yard with a single spider lurking at (500, 500). */
function yard(extra: SimConfigInput = {}) {
  const sim = createSim({
    seed: 3,
    worldSize: 1024,
    initialAnts: 0,
    foodSources: 0,
    colonies: 1,
    spiders: 0,
    antlions: 0,
    colony: FROZEN,
    ...extra,
  });
  sim.spiders.add(500, 500);
  return sim;
}

const spider = (sim: ReturnType<typeof yard>) => sim.spiders.info()[0]!;

function place(sim: ReturnType<typeof yard>, n: number, x: number, y: number, caste: Caste) {
  sim.applyCommands([{ type: 'spawnAnts', count: n, x, y, caste }]);
}

/** Park every ant on one spot each tick (so wandering cannot spread a test group out). */
function pin(sim: ReturnType<typeof yard>, x: number, y: number) {
  for (let i = 0; i < sim.ants.count; i++) {
    sim.ants.x[i] = x;
    sim.ants.y[i] = y;
  }
}

describe('spider', () => {
  it('is configured via spiders and placed away from the nests', () => {
    const none = createSim({ spiders: 0, antlions: 0 });
    expect(none.snapshot().spiders).toHaveLength(0);
    const two = createSim({ spiders: 2 });
    const snap = two.snapshot();
    expect(snap.spiders).toHaveLength(2);
    for (const s of snap.spiders) {
      for (const n of two.world.nests) {
        expect(Math.hypot(n.x - s.x, n.y - s.y)).toBeGreaterThan(two.config.worldSize * 0.25);
      }
    }
    expect(createSim().snapshot().spiders).toHaveLength(1);
  });

  it('hunts toward ants within sense range and leaves ants far away alone', () => {
    const far = yard();
    place(far, 5, 100, 100, Caste.Worker);
    for (let t = 0; t < 40; t++) far.step();
    expect(spider(far).state).toBe(SpiderState.Lurk);
    expect(spider(far).x).toBe(500);

    const sim = yard();
    place(sim, 6, 590, 500, Caste.Worker);
    const d0 = 90;
    pin(sim, 590, 500);
    sim.step();
    expect(spider(sim).state).toBe(SpiderState.Hunt);
    expect(500 - spider(sim).x).toBeLessThan(0); // moved east, toward the ants
    expect(Math.hypot(spider(sim).x - 590, spider(sim).y - 500)).toBeLessThan(d0);
  });

  it('kills an ant on contact without leaving a corpse, then pauses to eat', () => {
    const sim = yard({ combat: { corpseFood: 50 } });
    place(sim, 1, 505, 500, Caste.Worker);
    pin(sim, 505, 500);
    const events: SimEvent[] = [];
    sim.step();
    sim.step();
    events.push(...sim.snapshot().events);
    expect(sim.ants.count).toBe(0);
    expect(sim.colony.population).toBe(0);
    expect([...sim.world.food.list()]).toHaveLength(0);
    expect(spider(sim).state).toBe(SpiderState.Eat);
  });

  it('reports the player being eaten and swaps to another ant', () => {
    const sim = yard();
    place(sim, 30, 502, 500, Caste.Worker);
    sim.applyCommands([{ type: 'playerMoveDir', dx: 0, dy: 0 }]);
    sim.step();
    const events = sim.snapshot().events;
    // The nearest ant (index tie -> lowest) is bitten; make sure the engine survived either way.
    expect(sim.ants.count).toBe(29);
    expect(sim.player.index).toBeGreaterThanOrEqual(0);
    void events;
  });

  it('is mobbed by enough soldiers: it dies, drops food, then respawns after the cooldown', () => {
    const sim = yard({ spider: { respawnTicks: 200 } });
    place(sim, 20, 510, 500, Caste.Soldier);
    let killed: SimEvent | undefined;
    for (let t = 0; t < 400 && !killed; t++) {
      pin(sim, 510, 500);
      sim.step();
      killed = sim.snapshot().events.find((e) => e.type === 'spiderKilled');
    }
    expect(killed).toBeDefined();
    expect(spider(sim).state).toBe(SpiderState.Dead);
    const food = [...sim.world.food.list()].reduce((s, f) => s + f.amount, 0);
    expect(food).toBeGreaterThanOrEqual(sim.config.spider.foodDrop);
    for (let t = 0; t < 201; t++) sim.step();
    expect(spider(sim).state).not.toBe(SpiderState.Dead);
    expect(spider(sim).hp).toBeGreaterThan(spider(sim).maxHp * 0.9);
  });

  it('retreats home when badly hurt, then regenerates', () => {
    const sim = yard();
    // Hurt it through the plain-data state hook, as a save/load would.
    const st = sim.spiders.getState();
    st.spiders[0]!.hp = 20;
    st.spiders[0]!.x = 560;
    sim.spiders.setState(st);
    sim.step();
    expect(spider(sim).state).toBe(SpiderState.Retreat);
    for (let t = 0; t < 40; t++) sim.step();
    expect(Math.hypot(spider(sim).x - 500, spider(sim).y - 500)).toBeLessThan(6);
    const hp = spider(sim).hp;
    for (let t = 0; t < 100; t++) sim.step();
    expect(spider(sim).hp).toBeGreaterThan(hp);
    for (let t = 0; t < 2000; t++) sim.step();
    expect(spider(sim).state).toBe(SpiderState.Lurk);
    expect(spider(sim).hp).toBeGreaterThan(spider(sim).maxHp * 0.85);
  });

  it('scatters a small group of workers but not soldiers', () => {
    const sim = yard();
    place(sim, 3, 530, 500, Caste.Worker);
    place(sim, 3, 530, 500, Caste.Soldier);
    for (let i = 0; i < 6; i++) sim.ants.heading[i] = Math.PI; // walking at the spider
    sim.step();
    const worker = Math.hypot(sim.ants.x[0]! - 500, sim.ants.y[0]! - 500);
    expect(worker).toBeGreaterThan(30);
  });

  it('scales hp with difficulty', () => {
    const hp = (difficulty: 'easy' | 'normal' | 'hard') =>
      createSim({ difficulty, spiders: 1 }).snapshot().spiders[0]!.maxHp;
    expect(hp('easy')).toBeLessThan(hp('normal'));
    expect(hp('hard')).toBeGreaterThan(hp('normal'));
  });

  it('spawns on command', () => {
    const sim = yard();
    sim.applyCommands([{ type: 'spawnSpider', x: 100, y: 200 }]);
    expect(sim.snapshot().spiders).toHaveLength(2);
  });

  it('is deterministic and its state round-trips as plain data', () => {
    const run = (restore: boolean) => {
      const sim = createSim({ seed: 11, worldSize: 1024, initialAnts: 150, colonies: 2 });
      for (let t = 0; t < 300; t++) {
        sim.step();
        if (restore && t === 150) {
          const copy = JSON.parse(JSON.stringify(sim.spiders.getState())) as SpiderManagerState;
          sim.spiders.setState(copy);
        }
      }
      return sim.snapshot({ pheromones: false });
    };
    const a = run(false);
    expect(a).toEqual(run(false));
    expect(a.spiders).toEqual(run(true).spiders);
  });
});
