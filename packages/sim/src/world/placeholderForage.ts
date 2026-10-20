import { ANT_CARRY_CAPACITY, AntState } from '@ant/shared';
import type { AntStore } from '../ants';
import type { World } from './index';

const HOME_TURN = 0.25; // fraction of heading error corrected per tick while carrying

/**
 * PLACEHOLDER economy until real steering lands: ants standing on food pick some up and
 * head (loosely) home; ants reaching the nest drop it in the colony store.
 * Replace with the behaviour state machine; the world API it calls is the stable part:
 * `food.findFoodNear/takeFood`, `nest.isAtNest/depositFood`.
 */
export function placeholderForage(ants: AntStore, world: World): void {
  const { food, nest } = world;
  const { x, y, heading, carrying, state } = ants;
  for (let i = 0; i < ants.count; i++) {
    if (carrying[i]! > 0) {
      if (nest.isAtNest(x[i]!, y[i]!)) {
        nest.depositFood(carrying[i]!);
        carrying[i] = 0;
        state[i] = AntState.Wander;
      } else {
        const want = Math.atan2(nest.y - y[i]!, nest.x - x[i]!);
        let err = want - heading[i]!;
        err = Math.atan2(Math.sin(err), Math.cos(err));
        heading[i] = heading[i]! + err * HOME_TURN;
      }
    } else {
      const id = food.findFoodNear(x[i]!, y[i]!, 0);
      if (id >= 0) {
        const got = food.takeFood(id, ANT_CARRY_CAPACITY);
        if (got > 0) {
          carrying[i] = got;
          state[i] = AntState.CarryFood;
        }
      }
    }
  }
}
