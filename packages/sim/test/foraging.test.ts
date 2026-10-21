import { describe, expect, it } from 'vitest';
import { AntState, DEFAULT_BEHAVIOR } from '@ant/shared';
import type { AntBehaviorConfig } from '@ant/shared';
import { createSim } from '../src';
import { senseCell, steerTowardsScent, turnTowards } from '../src/ants';

describe('steering primitives', () => {
  it('keeps course when the centre sensor is strongest, else turns to the stronger side', () => {
    expect(steerTowardsScent(0.1, 0.5, 0.2, 0.01, 0.3)).toBe(0);
    expect(steerTowardsScent(0.6, 0.5, 0.2, 0.01, 0.3)).toBe(-0.3);
    expect(steerTowardsScent(0.1, 0.2, 0.5, 0.01, 0.3)).toBe(0.3);
    expect(steerTowardsScent(0.001, 0, 0.005, 0.01, 0.3)).toBe(0);
  });

  it('turns towards a target by at most maxTurn, across the +/-PI seam', () => {
    expect(turnTowards(0, 1, 0.25)).toBeCloseTo(0.25);
    expect(turnTowards(0, -0.1, 0.25)).toBeCloseTo(-0.1);
    expect(turnTowards(3, -3, 0.5)).toBeCloseTo(3.283 - 2 * Math.PI, 3);
  });

  it('senses walls as negative', () => {
    const layer = new Float32Array(4).fill(0.5);
    expect(senseCell(layer, 2, 1, 1.5, 0.5)).toBe(0.5);
    expect(senseCell(layer, 2, 1, -0.1, 0.5)).toBe(-1);
    expect(senseCell(layer, 2, 1, 0.5, 2)).toBe(-1);
  });
});

const NEST = 512;

/** Isolates foraging from the colony economy: everyone forages, nothing eats, nothing hatches. */
export const NO_ECONOMY = {
  behaviorRatio: { forage: 1, dig: 0, nurse: 0 },
  startFood: 0,
  maxLayRate: 0,
  upkeepPerAnt: 0,
  queenUpkeep: 0,
};

/** Seeded colony on a 1024 world with a single pile 316 units from the nest. */
function forage(ticks: number, behavior: Partial<AntBehaviorConfig> = {}, seed = 1) {
  const sim = createSim({
    spiders: 0,
    seed,
    worldSize: 1024,
    initialAnts: 400,
    colonies: 1,
    foodSources: 0,
    behavior,
    colony: NO_ECONOMY,
  });
  sim.applyCommands([{ type: 'placeFood', x: NEST + 300, y: NEST + 100, amount: 1000 }]);
  for (let t = 0; t < ticks; t++) sim.step();
  return sim;
}

describe('foraging', () => {
  it('is deterministic', () => {
    const a = forage(300).snapshot({ pheromones: true });
    const b = forage(300).snapshot({ pheromones: true });
    expect(a).toEqual(b);
    expect(forage(300, {}, 2).snapshot().ants).not.toEqual(a.ants);
  });

  it('builds trails that carry food home, far better than without pheromones', () => {
    const ticks = 1600;
    const withTrails = forage(ticks);
    const blind = forage(ticks, { pheromones: false });
    const delivered = withTrails.world.nest.store;
    expect(delivered).toBeGreaterThan(200);
    expect(delivered).toBeGreaterThan(blind.world.nest.store * 3);
    expect(withTrails.pheromones.total('food')).toBeGreaterThan(0);
    expect(blind.pheromones.total('food')).toBe(0);
    expect(blind.pheromones.total('home')).toBe(0);
  });

  it('conserves food and keeps state consistent with carrying', () => {
    const sim = forage(800);
    const { ants } = sim;
    let held = 0;
    for (let i = 0; i < ants.count; i++) {
      if (ants.carrying[i]! > 0) {
        held += ants.carrying[i]!;
        expect(ants.state[i]).toBe(AntState.CarryFood);
      } else {
        expect([AntState.Wander, AntState.FollowTrail]).toContain(ants.state[i]);
      }
    }
    const pile = [...sim.world.food.list()].reduce((s, f) => s + f.amount, 0);
    expect(held + pile + sim.world.nest.store).toBeCloseTo(1000);
    expect(held).toBeGreaterThan(0);
  });

  it('discovers newly placed food on an established colony', () => {
    const sim = forage(600);
    sim.applyCommands([{ type: 'placeFood', x: NEST - 250, y: NEST - 150, amount: 300 }]);
    const id = Math.max(...[...sim.world.food.list()].map((f) => f.id));
    for (let t = 0; t < 1200; t++) sim.step();
    const left = sim.world.food.get(id)?.amount ?? 0;
    expect(left).toBeLessThan(250);
  });

  it('applies live behaviour tuning via setBehavior without touching defaults', () => {
    const sim = createSim({
      spiders: 0,
      seed: 3,
      worldSize: 512,
      initialAnts: 50,
      colonies: 1,
      colony: NO_ECONOMY,
    });
    sim.applyCommands([{ type: 'setBehavior', params: { speed: 0 } }]);
    expect(sim.config.behavior.speed).toBe(0);
    expect(DEFAULT_BEHAVIOR.speed).not.toBe(0);
    const x0 = Float32Array.from(sim.ants.x.subarray(0, 50));
    sim.step();
    expect(Float32Array.from(sim.ants.x.subarray(0, 50))).toEqual(x0);
  });
});
