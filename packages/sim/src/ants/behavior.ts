import { ANT_CARRY_CAPACITY, AntState, Caste } from '@ant/shared';
import type { AntBehaviorConfig, CombatConfig } from '@ant/shared';
import type { PheromoneField } from '../pheromones';
import type { Rng } from '../rng';
import { slid } from '../world/obstacles';
import type { ObstacleField } from '../world/obstacles';
import type { World } from '../world';
import type { Colony } from '../colony/colony';
import type { AntStore } from './store';
import { senseCell, steerTowardsScent, turnTowards, wrapAngle } from './steering';

/** Deposits stop once an ant's trail strength falls below this. */
const MIN_STRENGTH = 0.01;
/** Patrolling soldiers beyond `patrolRadius` turn back towards the nest at this rate. */
const LEASH_TURN = 0.15;
/** Ants look this many steps ahead for rocks and swerve before touching them. */
const ROCK_LOOKAHEAD = 4;

/** Per-colony layer handles, resolved once per tick (index = colony id). */
interface Layers {
  food: Float32Array[];
  home: Float32Array[];
  alarm: Float32Array[];
  /** Colony c's `enemy` layer: scent left by the other colonies' ants. */
  enemy: Float32Array[];
  /** Where colony c's ants leave their scent: the other colonies' `enemy` layers. */
  presence: Float32Array[][];
}

let cachedFields: readonly PheromoneField[] | null = null;
let cachedLayers: Layers | null = null;

/** Layer arrays never move, so they are resolved once per set of fields. */
function resolveLayers(fields: readonly PheromoneField[]): Layers {
  if (fields === cachedFields && cachedLayers) return cachedLayers;
  cachedFields = fields;
  return (cachedLayers = {
    food: fields.map((f) => f.layer('food')),
    home: fields.map((f) => f.layer('home')),
    alarm: fields.map((f) => f.layer('alarm')),
    enemy: fields.map((f) => f.layer('enemy')),
    presence: fields.map((_, c) => fields.filter((__, e) => e !== c).map((f) => f.layer('enemy'))),
  });
}

/**
 * One tick for every surface ant: sense -> steer -> move -> interact -> deposit.
 * Each colony has its own `PheromoneField` (`fields[colony]`), so an ant only ever smells
 * its own colony's food/home/alarm trails (plus enemy scent in its `enemy` layer).
 *
 * Workers forage (below). Soldiers patrol or raid (`updateSoldier`). Ants in `Fight`
 * (held by the combat step), the player and its recruits are skipped. Workers with an
 * underground job, and breeders, walk to their nest and descend.
 *
 * Worker state machine (stored in `ants.state`):
 * State machine (stored in `ants.state`):
 * - `Wander`: no food trail in range. Correlated random walk; lays `home`.
 * - `FollowTrail`: a sensor smells `food`; steers up that trail. Lays `home`.
 * - `CarryFood`: holding food; steers up the `home` trail plus a weak `homingBias` pull
 *   (path integration) towards the nest, and straight in once within `nestSenseRadius`.
 *   Lays `food`. Dropping food at the nest -> `Wander`.
 *
 * Idle (not carrying) workers that smell their colony's `alarm` steer up it instead of
 * following food trails: that is how fights recruit help.
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
  fields: readonly PheromoneField[],
  world: World,
  rng: Rng,
  cfg: AntBehaviorConfig,
  combat: CombatConfig,
  tickRate: number,
  /** Ant index driven by the player controller instead of this loop (-1 = none). */
  playerIndex: number,
  colonies: readonly Colony[],
): void {
  const { x, y, heading, carrying, state, strength, layer, role, caste, colony } = ants;
  const { food, obstacles } = world;
  const rocks = obstacles.count > 0 ? obstacles : null;
  const field = fields[0]!;
  const size = field.worldSize;
  const res = field.resolution;
  const invCell = 1 / field.cellSize;
  const L = resolveLayers(fields);
  const foodMax = field.config.food.max;
  const homeMax = field.config.home.max;
  const alarmThreshold = combat.alarmThreshold;
  const presence = combat.presenceDeposit;
  // Alarm is sensed further out than trails: it is a call for help.
  const alarmDist = cfg.sensorDistance * 2;

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
    // The player ant and its recruits are moved by the player controller; fighters by combat.
    const st = state[i]!;
    if (i === playerIndex || st === AntState.Recruited || st === AntState.Fight) continue;
    // Underground ants are stepped by the colony; surface ants with an underground job
    // (dig / nurse) just walk to the nest mouth and descend.
    if (layer[i] !== 0) continue;
    const c = colony[i]!;
    const col = colonies[c]!;
    const k = caste[i]!;
    if (k === Caste.Soldier) {
      updateSoldier(ants, i, L, fields, colonies, rng, cfg, combat, tickRate, rocks);
      continue;
    }
    if (k === Caste.Breeder || role[i] !== 0) {
      col.walkToNest(ants, i, rng, cfg, tickRate, rocks);
      continue;
    }
    const nest = col.nest;
    const foodLayer = L.food[c]!;
    const homeLayer = L.home[c]!;
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
    } else if (
      usePheromones &&
      !loaded &&
      steer(
        L.alarm[c]!,
        res,
        invCell,
        px,
        py,
        h,
        alarmDist,
        sensorAngle,
        alarmThreshold,
        turnRate * 1.5,
      )
    ) {
      // Fight nearby: answer the alarm instead of foraging.
      h += steered.turn;
      smelled = true;
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
    if (rocks) h = rocks.avoid(px, py, h, v * ROCK_LOOKAHEAD, i);
    let nx = px + Math.cos(h) * v;
    let ny = py + Math.sin(h) * v;
    if (rocks) {
      rocks.slide(px, py, nx, ny);
      nx = slid.x;
      ny = slid.y;
    }
    px = nx;
    py = ny;
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
        // Go below with the food; it is added to the store once dropped in a food chamber.
        x[i] = px;
        y[i] = py;
        col.enter(ants, i);
        continue;
      }
      state[i] = AntState.CarryFood;
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
    depositPresence(L.presence[c]!, res, invCell, px, py, presence);

    x[i] = px;
    y[i] = py;
    heading[i] = wrapAngle(h);
    strength[i] = s * decay;
  }
}

/** Leave this ant's colony scent in the other colonies' `enemy` layers (max 1). */
function depositPresence(
  targets: Float32Array[],
  res: number,
  invCell: number,
  px: number,
  py: number,
  amount: number,
): void {
  if (amount <= 0) return;
  const cx = Math.floor(px * invCell);
  const cy = Math.floor(py * invCell);
  if (cx < 0 || cy < 0 || cx >= res || cy >= res) return;
  const ci = cy * res + cx;
  for (let t = 0; t < targets.length; t++) {
    const d = targets[t]!;
    const v = d[ci]! + amount;
    d[ci] = v > 1 ? 1 : v;
  }
}

/** Output slot for `steer` (keeps the soldier step allocation-free). */
const steered = { turn: 0 };

/**
 * Three-sensor read of `layer` from (px, py) facing `h`. Writes the heading change to
 * `steered.turn` and returns whether any sensor reached `threshold`.
 */
function steer(
  layer: Float32Array,
  res: number,
  invCell: number,
  px: number,
  py: number,
  h: number,
  sd: number,
  sa: number,
  threshold: number,
  rate: number,
): boolean {
  const l = senseCell(layer, res, invCell, px + Math.cos(h - sa) * sd, py + Math.sin(h - sa) * sd);
  const m = senseCell(layer, res, invCell, px + Math.cos(h) * sd, py + Math.sin(h) * sd);
  const r = senseCell(layer, res, invCell, px + Math.cos(h + sa) * sd, py + Math.sin(h + sa) * sd);
  steered.turn = steerTowardsScent(l, m, r, threshold, rate);
  return l >= threshold || m >= threshold || r >= threshold;
}

/** First other colony whose queen is alive (the raid target), or undefined. */
function enemyOf(colonies: readonly Colony[], c: number): Colony | undefined {
  for (const e of colonies) if (e.id !== c && e.queenAlive) return e;
  return undefined;
}

/**
 * Soldier on the surface. Priorities: defend the nest when it has intruders (walk home and
 * go below) -> answer the colony's `alarm` -> raid (follow the enemy colony's `home` trails,
 * which grow stronger towards its nest, beelining once the nest has been scouted, and go
 * down its entrance) -> patrol (follow `enemy` scent, stay within `patrolRadius` of home).
 * Soldiers never forage and lay no trails, only their colony scent.
 */
function updateSoldier(
  ants: AntStore,
  i: number,
  L: Layers,
  fields: readonly PheromoneField[],
  colonies: readonly Colony[],
  rng: Rng,
  cfg: AntBehaviorConfig,
  combat: CombatConfig,
  tickRate: number,
  rocks: ObstacleField | null,
): void {
  const c = ants.colony[i]!;
  const col = colonies[c]!;
  if (col.intruders > 0) {
    col.walkToNest(ants, i, rng, cfg, tickRate, rocks);
    ants.state[i] = AntState.Wander;
    return;
  }
  const field = fields[c]!;
  const res = field.resolution;
  const invCell = 1 / field.cellSize;
  const size = field.worldSize;
  const sd = cfg.sensorDistance;
  const sa = cfg.sensorAngle;
  const turn = cfg.turnRate;
  let px = ants.x[i]!;
  let py = ants.y[i]!;
  let h = ants.heading[i]!;
  let followed = false;
  const enemy = col.raid ? enemyOf(colonies, c) : undefined;

  // Alarm first; `steered.turn` holds the heading change of the last `steer` call.
  if (
    cfg.pheromones &&
    steer(L.alarm[c]!, res, invCell, px, py, h, sd * 2, sa, combat.alarmThreshold, turn * 1.5)
  ) {
    h += steered.turn;
    followed = true;
  } else if (enemy) {
    const en = enemy.nest;
    const dx = en.x - px;
    const dy = en.y - py;
    const d2 = dx * dx + dy * dy;
    if (d2 <= cfg.nestSenseRadius * cfg.nestSenseRadius * 4) {
      h = turnTowards(h, Math.atan2(dy, dx), turn * 2);
    } else {
      if (cfg.pheromones) {
        followed = steer(
          L.home[enemy.id]!,
          res,
          invCell,
          px,
          py,
          h,
          sd,
          sa,
          cfg.trailThreshold,
          turn,
        );
        h += steered.turn;
      }
      if (enemy.scouted) h = turnTowards(h, Math.atan2(dy, dx), cfg.homingBias * 2);
    }
  } else {
    if (cfg.pheromones) {
      followed = steer(L.enemy[c]!, res, invCell, px, py, h, sd, sa, cfg.trailThreshold, turn);
      h += steered.turn;
    }
    const dx = col.nest.x - px;
    const dy = col.nest.y - py;
    if (dx * dx + dy * dy > combat.patrolRadius * combat.patrolRadius) {
      h = turnTowards(h, Math.atan2(dy, dx), LEASH_TURN);
    }
  }
  h += (rng.next() * 2 - 1) * cfg.jitter;

  const v = cfg.speed / tickRate;
  if (rocks) h = rocks.avoid(px, py, h, v * ROCK_LOOKAHEAD, i);
  px += Math.cos(h) * v;
  py += Math.sin(h) * v;
  if (rocks) {
    rocks.slide(ants.x[i]!, ants.y[i]!, px, py);
    px = slid.x;
    py = slid.y;
  }
  if (px < 0 || px > size) {
    h = Math.PI - h;
    px = px < 0 ? 0 : size;
  }
  if (py < 0 || py > size) {
    h = -h;
    py = py < 0 ? 0 : size;
  }
  ants.x[i] = px;
  ants.y[i] = py;
  ants.heading[i] = wrapAngle(h);
  ants.state[i] = followed ? AntState.FollowTrail : AntState.Wander;
  if (enemy && enemy.nest.isAtNest(px, py)) {
    enemy.enter(ants, i);
    return;
  }
  depositPresence(L.presence[c]!, res, invCell, px, py, combat.presenceDeposit);
}
