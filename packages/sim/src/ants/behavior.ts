import { ANT_CARRY_CAPACITY, AntState } from '@ant/shared';
import type { AntBehaviorConfig } from '@ant/shared';
import type { PheromoneField } from '../pheromones';
import type { Rng } from '../rng';
import type { World } from '../world';
import type { AntStore } from './store';
import { senseCell, steerTowardsScent, turnTowards, wrapAngle } from './steering';

/** Deposits stop once an ant's trail strength falls below this. */
const MIN_STRENGTH = 0.01;

/**
 * One tick of foraging for every ant: sense -> steer -> move -> interact -> deposit.
 *
 * State machine (stored in `ants.state`):
 * - `Wander`: no food trail in range. Correlated random walk; lays `home`.
 * - `FollowTrail`: a sensor smells `food`; steers up that trail. Lays `home`.
 * - `CarryFood`: holding food; steers up the `home` trail plus a weak `homingBias` pull
 *   (path integration) towards the nest, and straight in once within `nestSenseRadius`.
 *   Lays `food`. Dropping food at the nest -> `Wander`.
 *
 * Any non-carrying ant that sees a pile within `foodSenseRadius` walks straight to it and
 * picks food up on contact. Picking up or dropping off turns the ant around and resets its
 * trail strength, which then decays every tick, so each trail is strongest at its source
 * and its gradient points back there.
 *
 * Hot loop: typed arrays only, no allocation, one rng draw per ant per tick.
 */
export function updateAnts(
  ants: AntStore,
  field: PheromoneField,
  world: World,
  rng: Rng,
  cfg: AntBehaviorConfig,
  tickRate: number,
): void {
  const { x, y, heading, carrying, state, strength } = ants;
  const { food, nest } = world;
  const size = field.worldSize;
  const res = field.resolution;
  const invCell = 1 / field.cellSize;
  const foodLayer = field.layer('food');
  const homeLayer = field.layer('home');
  const foodMax = field.config.food.max;
  const homeMax = field.config.home.max;

  const usePheromones = cfg.pheromones;
  const step = cfg.speed / tickRate;
  const carryStep = step * cfg.carrySpeedFactor;
  const sensorDist = cfg.sensorDistance;
  const sensorAngle = cfg.sensorAngle;
  const threshold = cfg.trailThreshold;
  const turnRate = cfg.turnRate;
  const jitter = cfg.jitter;
  const decay = cfg.depositDecay;
  const foodSense = cfg.foodSenseRadius;
  const nestSense2 = cfg.nestSenseRadius * cfg.nestSenseRadius;
  const homingBias = cfg.homingBias;

  for (let i = 0; i < ants.count; i++) {
    let px = x[i]!;
    let py = y[i]!;
    let h = heading[i]!;
    const loaded = carrying[i]! > 0;

    // --- Sense & steer ---------------------------------------------------------------
    let smelled = false;
    const ndx = nest.x - px;
    const ndy = nest.y - py;
    if (loaded && ndx * ndx + ndy * ndy <= nestSense2) {
      h = turnTowards(h, Math.atan2(ndy, ndx), turnRate * 2);
    } else if (usePheromones) {
      const layer = loaded ? homeLayer : foodLayer;
      const l = senseCell(
        layer,
        res,
        invCell,
        px + Math.cos(h - sensorAngle) * sensorDist,
        py + Math.sin(h - sensorAngle) * sensorDist,
      );
      const c = senseCell(
        layer,
        res,
        invCell,
        px + Math.cos(h) * sensorDist,
        py + Math.sin(h) * sensorDist,
      );
      const r = senseCell(
        layer,
        res,
        invCell,
        px + Math.cos(h + sensorAngle) * sensorDist,
        py + Math.sin(h + sensorAngle) * sensorDist,
      );
      h += steerTowardsScent(l, c, r, threshold, turnRate);
      smelled = l >= threshold || c >= threshold || r >= threshold;
    }
    if (loaded && homingBias > 0) h = turnTowards(h, Math.atan2(ndy, ndx), homingBias);
    h += (rng.next() * 2 - 1) * jitter;

    // --- Move, bouncing off world edges -----------------------------------------------
    const v = loaded ? carryStep : step;
    px += Math.cos(h) * v;
    py += Math.sin(h) * v;
    if (px < 0 || px > size) {
      h = Math.PI - h;
      px = px < 0 ? 0 : size;
    }
    if (py < 0 || py > size) {
      h = -h;
      py = py < 0 ? 0 : size;
    }

    // --- Interact with nest / food -----------------------------------------------------
    let s = strength[i]!;
    if (loaded) {
      if (nest.isAtNest(px, py)) {
        nest.depositFood(carrying[i]!);
        carrying[i] = 0;
        state[i] = AntState.Wander;
        s = 1;
        h += Math.PI;
      } else {
        state[i] = AntState.CarryFood;
      }
    } else {
      if (nest.isAtNest(px, py)) s = 1;
      const id = food.findFoodNear(px, py, foodSense);
      if (id >= 0) {
        const pile = food.get(id)!;
        const fdx = pile.x - px;
        const fdy = pile.y - py;
        if (fdx * fdx + fdy * fdy <= pile.radius * pile.radius) {
          const got = food.takeFood(id, ANT_CARRY_CAPACITY);
          if (got > 0) {
            carrying[i] = got;
            state[i] = AntState.CarryFood;
            s = 1;
            h += Math.PI;
          }
        } else {
          h = Math.atan2(fdy, fdx);
          state[i] = AntState.FollowTrail;
        }
      } else {
        state[i] = smelled ? AntState.FollowTrail : AntState.Wander;
      }
    }

    // --- Lay pheromone ---------------------------------------------------------------
    if (usePheromones && s > MIN_STRENGTH) {
      const cx = Math.floor(px * invCell);
      const cy = Math.floor(py * invCell);
      if (cx >= 0 && cy >= 0 && cx < res && cy < res) {
        const ci = cy * res + cx;
        if (carrying[i]! > 0) {
          const nv = foodLayer[ci]! + cfg.depositFood * s;
          foodLayer[ci] = nv > foodMax ? foodMax : nv;
        } else {
          const nv = homeLayer[ci]! + cfg.depositHome * s;
          homeLayer[ci] = nv > homeMax ? homeMax : nv;
        }
      }
    }

    x[i] = px;
    y[i] = py;
    heading[i] = wrapAngle(h);
    strength[i] = s * decay;
  }
}
