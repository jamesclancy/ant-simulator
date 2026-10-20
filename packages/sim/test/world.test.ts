import { describe, expect, it } from 'vitest';
import { createSim } from '../src';

const cfg = { seed: 42, worldSize: 512, initialAnts: 0, foodSources: 4, foodAmount: 50 };

describe('food placement', () => {
  it('is deterministic per seed and differs between seeds', () => {
    const a = createSim(cfg).snapshot().food;
    expect(a).toHaveLength(4);
    expect(createSim(cfg).snapshot().food).toEqual(a);
    expect(createSim({ ...cfg, seed: 43 }).snapshot().food).not.toEqual(a);
  });
});

describe('food field', () => {
  it('finds nearest pile within reach and not beyond', () => {
    const { world } = createSim({ ...cfg, foodSources: 0 });
    const id = world.food.add(100, 100, 100); // radius 6
    expect(world.food.findFoodNear(100, 100, 0)).toBe(id);
    expect(world.food.findFoodNear(120, 100, 0)).toBe(-1);
    expect(world.food.findFoodNear(120, 100, 15)).toBe(id);
    expect(world.food.findFoodNear(400, 400, 20)).toBe(-1);
  });

  it('takes food, depletes and removes empty piles', () => {
    const { world } = createSim({ ...cfg, foodSources: 0 });
    const id = world.food.add(10, 10, 3);
    expect(world.food.takeFood(id, 2)).toBe(2);
    expect(world.food.takeFood(id, 2)).toBe(1);
    expect(world.food.get(id)).toBeUndefined();
    expect(world.food.findFoodNear(10, 10, 5)).toBe(-1);
    expect(world.food.takeFood(id, 1)).toBe(0);
  });
});

describe('nest', () => {
  it('detects the entrance and stores deposits', () => {
    const { world } = createSim(cfg);
    const { nest } = world;
    expect(nest.isAtNest(nest.x, nest.y)).toBe(true);
    expect(nest.isAtNest(nest.x + nest.radius + 1, nest.y)).toBe(false);
    nest.depositFood(3);
    nest.depositFood(-5);
    expect(nest.store).toBe(3);
  });
});

describe('commands', () => {
  it('places and removes food', () => {
    const sim = createSim({ ...cfg, foodSources: 0 });
    sim.applyCommands([{ type: 'placeFood', x: 5, y: 5, amount: 20 }]);
    const [pile] = sim.snapshot().food;
    expect(pile).toMatchObject({ x: 5, y: 5, amount: 20 });
    sim.applyCommands([{ type: 'removeFood', id: pile!.id }]);
    expect(sim.snapshot().food).toHaveLength(0);
  });
});
