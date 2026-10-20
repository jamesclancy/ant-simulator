import type { SimConfig } from '@ant/shared';
import type { Rng } from '../rng';
import { FoodField } from './food';
import { Nest } from './nest';

export { FoodField, foodRadiusFor, MAX_FOOD_RADIUS, MIN_FOOD_RADIUS } from './food';
export type { FoodSource } from './food';
export { Nest } from './nest';

export interface World {
  food: FoodField;
  nest: Nest;
}

/**
 * Build the starting world: nest at the world centre and `config.foodSources` piles of
 * `config.foodAmount` placed in a ring around it (15%-40% of world size away).
 * Uses the supplied rng only, so placement is deterministic per seed.
 */
export function createWorld(config: SimConfig, rng: Rng): World {
  const half = config.worldSize / 2;
  const nest = new Nest(half, half, config.nestRadius);
  const food = new FoodField(config.worldSize);
  for (let i = 0; i < config.foodSources; i++) {
    const angle = rng.range(0, Math.PI * 2);
    const dist = config.worldSize * rng.range(0.15, 0.4);
    food.add(half + Math.cos(angle) * dist, half + Math.sin(angle) * dist, config.foodAmount);
  }
  return { food, nest };
}
