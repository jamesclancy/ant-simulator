import type { SimConfig } from '@ant/shared';
import type { Rng } from '../rng';
import { FoodField } from './food';
import { Nest } from './nest';

export { FoodField, foodRadiusFor, MAX_FOOD_RADIUS, MIN_FOOD_RADIUS } from './food';
export type { FoodSource } from './food';
export { Nest } from './nest';

export interface World {
  food: FoodField;
  /** One nest per colony (index = colony id). */
  nests: Nest[];
  /** The player colony's nest (`nests[0]`). */
  readonly nest: Nest;
}

/**
 * Build the starting world. Uses the supplied rng only, so placement is deterministic per
 * seed.
 *
 * - One colony: nest at the world centre, `config.foodSources` piles in a ring 15%-40% of
 *   the world size away (the original single-colony layout).
 * - Two colonies: nests on opposite sides of the centre along a seeded axis, 30% of the
 *   world size out. Food is point-symmetric about the centre so neither side is favoured:
 *   mirrored pairs between and beside the nests, plus one contested pile in the middle when
 *   the count is odd.
 */
export function createWorld(config: SimConfig, rng: Rng): World {
  const size = config.worldSize;
  const half = size / 2;
  const food = new FoodField(size);
  const nests: Nest[] = [];
  if (config.colonies <= 1) {
    nests.push(new Nest(half, half, config.nestRadius, 0));
    for (let i = 0; i < config.foodSources; i++) {
      const angle = rng.range(0, Math.PI * 2);
      const dist = size * rng.range(0.15, 0.4);
      food.add(half + Math.cos(angle) * dist, half + Math.sin(angle) * dist, config.foodAmount);
    }
  } else {
    // Diagonal-ish axis so the nests sit in opposite regions of the yard.
    const axis = Math.PI / 4 + rng.range(-0.35, 0.35) + (rng.next() < 0.5 ? 0 : Math.PI / 2);
    const ux = Math.cos(axis);
    const uy = Math.sin(axis);
    const out = size * 0.3;
    nests.push(new Nest(half - ux * out, half - uy * out, config.nestRadius, 0));
    nests.push(new Nest(half + ux * out, half + uy * out, config.nestRadius, 1));
    const pairs = config.foodSources >> 1;
    for (let p = 0; p < pairs; p++) {
      // Along the axis: from just outside a nest's foraging range to near the middle;
      // across it: out to the side, so ants spread over the whole yard.
      const along = size * rng.range(0.05, 0.22);
      const across = size * rng.range(-0.3, 0.3);
      const dx = ux * along - uy * across;
      const dy = uy * along + ux * across;
      food.add(clamp(half + dx, size), clamp(half + dy, size), config.foodAmount);
      food.add(clamp(half - dx, size), clamp(half - dy, size), config.foodAmount);
    }
    if (config.foodSources % 2) food.add(half, half, config.foodAmount);
  }
  return {
    food,
    nests,
    get nest() {
      return nests[0]!;
    },
  };
}

function clamp(v: number, size: number): number {
  const m = size * 0.04;
  return v < m ? m : v > size - m ? size - m : v;
}
