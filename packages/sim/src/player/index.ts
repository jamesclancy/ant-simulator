import { ANT_CARRY_CAPACITY, AntState, Caste, PLAYER_COLONY } from '@ant/shared';
import type { AntBehaviorConfig, Command, CombatConfig, PlayerInfo, SimEvent } from '@ant/shared';
import { turnTowards, wrapAngle } from '../ants/steering';
import type { AntStore } from '../ants/store';
import type { PheromoneField } from '../pheromones';
import type { Rng } from '../rng';
import type { World } from '../world';

/** Player walking speed relative to `behavior.speed`. */
export const PLAYER_SPEED_FACTOR = 1.6;
/** Max heading change per tick for the player (much snappier than ordinary ants). */
const PLAYER_TURN = 0.6;
/** Move-to stops within this distance of the target. */
const ARRIVE_DIST = 3;
/** Pheromone laid on the `food` layer per tick while the trail is on. */
export const PLAYER_TRAIL_AMOUNT = 0.35;
/** How far (edge distance) the player can reach a food pile. */
export const PLAYER_PICKUP_REACH = 14;
/** Ants within this distance of the player can be recruited. */
export const RECRUIT_RADIUS = 260;
/** Recruits further than this behind the player hurry to catch up. */
const CATCH_UP_DIST = 40;
const GOLDEN_ANGLE = 2.399963;
/** The player ant is tougher than a soldier, so it isn't lost in the first skirmish. */
const PLAYER_HP_FACTOR = 2;

type PlayerCommand = Extract<Command, { type: `player${string}` }>;

export function isPlayerCommand(cmd: Command): cmd is PlayerCommand {
  return cmd.type.startsWith('player');
}

/**
 * The yellow player ant plus its recruited followers. The player is an ordinary slot in the
 * ant store (so it renders and fights like any ant) of the black colony (`PLAYER_COLONY`),
 * always on the surface, whose AI is skipped by `updateAnts`; this controller moves it
 * instead. Recruited ants (`AntState.Recruited`) are likewise skipped there and steered here.
 * When ants are removed the sim calls `applyRemap`; if the player ant died, the nearest
 * surface ant of the colony takes over and a `playerSwapped` event is raised.
 */
export class PlayerController {
  /** Index of the player ant in the store, or -1 when there are no ants. */
  index = -1;
  private targetX = 0;
  private targetY = 0;
  private hasTarget = false;
  private dirX = 0;
  private dirY = 0;
  private trailOn = false;
  /** Recruited ant indices, in recruit order (determines each ant's follow slot). */
  private recruited: number[] = [];
  private events: SimEvent[] = [];
  /** The player ant died and has not been replaced yet (index of the lost slot). */
  private lostFrom = -1;
  private lastX = 0;
  private lastY = 0;

  constructor(
    private ants: AntStore,
    private world: World,
    private field: PheromoneField,
    private cfg: AntBehaviorConfig,
    private rng: Rng,
    private worldSize: number,
    private combat: CombatConfig,
  ) {}

  get recruitCount(): number {
    return this.recruited.length;
  }

  /** Make the ant nearest the nest the player (used at startup and after the store is cleared). */
  reset(): void {
    this.recruited.length = 0;
    this.hasTarget = false;
    this.dirX = this.dirY = 0;
    this.index = -1;
    this.ensurePlayer();
  }

  apply(cmd: PlayerCommand): void {
    this.ensurePlayer();
    if (this.index < 0) return;
    const { ants, index: i } = this;
    switch (cmd.type) {
      case 'playerMoveTo':
        this.targetX = clamp(cmd.x, 0, this.worldSize);
        this.targetY = clamp(cmd.y, 0, this.worldSize);
        this.hasTarget = true;
        this.dirX = this.dirY = 0;
        break;
      case 'playerMoveDir': {
        const m = Math.hypot(cmd.dx, cmd.dy);
        const k = m > 1 ? 1 / m : 1;
        this.dirX = cmd.dx * k;
        this.dirY = cmd.dy * k;
        if (m > 0) this.hasTarget = false;
        break;
      }
      case 'playerToggleTrail':
        this.trailOn = cmd.on;
        break;
      case 'playerPickupDrop':
        if (ants.carrying[i]! > 0) {
          const { food } = this.world;
          const nest = this.world.nests[PLAYER_COLONY]!;
          if (nest.isAtNest(ants.x[i]!, ants.y[i]!)) nest.depositFood(ants.carrying[i]!);
          else food.add(ants.x[i]!, ants.y[i]!, ants.carrying[i]!);
          ants.carrying[i] = 0;
        } else {
          const id = this.world.food.findFoodNear(ants.x[i]!, ants.y[i]!, PLAYER_PICKUP_REACH);
          if (id >= 0) ants.carrying[i] = this.world.food.takeFood(id, ANT_CARRY_CAPACITY);
        }
        break;
      case 'playerRecruit':
        this.recruit(cmd.count);
        break;
      case 'playerRelease':
        this.release();
        break;
    }
  }

  /** Advance the player and its recruits one tick. Call after `updateAnts`. */
  step(): void {
    this.ensurePlayer();
    if (this.index < 0) return;
    this.movePlayer();
    this.moveRecruits();
  }

  info(): PlayerInfo | null {
    const i = this.index;
    if (i < 0) return null;
    const { ants } = this;
    return {
      index: i,
      x: ants.x[i]!,
      y: ants.y[i]!,
      heading: ants.heading[i]!,
      carrying: ants.carrying[i]!,
      trail: this.trailOn,
      recruits: this.recruited.length,
      recruitedIndices: Uint32Array.from(this.recruited),
    };
  }

  /** Returns and clears events raised since the last call. */
  drainEvents(): SimEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /**
   * Ants were removed (`compactAnts`): `map[old]` is each ant's new index, -1 if it died.
   * Follows the player and recruits to their new slots; a dead player is replaced on the
   * next `ensurePlayer`.
   */
  applyRemap(map: Int32Array, oldCount: number): void {
    const at = (i: number): number => (i >= 0 && i < oldCount ? map[i]! : -1);
    if (this.index >= 0) {
      const next = at(this.index);
      if (next < 0) {
        this.lostFrom = this.index;
        this.lastX = this.ants.x[this.index]!;
        this.lastY = this.ants.y[this.index]!;
      }
      this.index = next;
    }
    let kept = 0;
    for (const r of this.recruited) {
      const n = at(r);
      if (n >= 0) this.recruited[kept++] = n;
    }
    this.recruited.length = kept;
  }

  /**
   * Re-resolve the player if its slot is gone: the black colony's surface ant nearest to
   * where the player was (or to the nest at startup). With none on the surface there is no
   * player until one comes up.
   */
  private ensurePlayer(): void {
    const { ants } = this;
    if (this.index >= 0 && this.index < ants.count) return;
    const died = this.lostFrom >= 0;
    const swapped = died || this.index >= 0;
    const from = died ? this.lostFrom : this.index;
    this.recruited = this.recruited.filter((r) => r < ants.count);
    const nest = this.world.nests[PLAYER_COLONY]!;
    const ax = died ? this.lastX : nest.x;
    const ay = died ? this.lastY : nest.y;
    let best = -1;
    let bestD = Infinity;
    for (let k = 0; k < ants.count; k++) {
      if (ants.colony[k] !== PLAYER_COLONY || ants.layer[k] !== 0) continue;
      const d = Math.hypot(ants.x[k]! - ax, ants.y[k]! - ay);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    if (best < 0) {
      // Remember a pending swap so the event still fires once someone surfaces.
      if (swapped && !died) this.lostFrom = from;
      this.index = -1;
      this.recruited.length = 0;
      return;
    }
    this.lostFrom = -1;
    this.index = best;
    this.recruited = this.recruited.filter((r) => r !== best);
    ants.state[best] = AntState.Wander;
    ants.hp[best] = Math.max(ants.hp[best]!, this.combat.hp[Caste.Soldier] * PLAYER_HP_FACTOR);
    if (swapped) this.events.push({ type: 'playerSwapped', from, to: best });
  }

  private movePlayer(): void {
    const { ants, cfg, index: i } = this;
    let h = ants.heading[i]!;
    let px = ants.x[i]!;
    let py = ants.y[i]!;
    let speed = 0;
    const full = (cfg.speed * PLAYER_SPEED_FACTOR) / 20;
    if (this.dirX !== 0 || this.dirY !== 0) {
      h = turnTowards(h, Math.atan2(this.dirY, this.dirX), PLAYER_TURN);
      speed = full * Math.hypot(this.dirX, this.dirY);
    } else if (this.hasTarget) {
      const dx = this.targetX - px;
      const dy = this.targetY - py;
      const dist = Math.hypot(dx, dy);
      if (dist <= ARRIVE_DIST) {
        this.hasTarget = false;
      } else {
        h = turnTowards(h, Math.atan2(dy, dx), PLAYER_TURN);
        speed = Math.min(full, dist);
      }
    }
    if (ants.carrying[i]! > 0) speed *= cfg.carrySpeedFactor;
    // Slide along world edges instead of bouncing.
    px = clamp(px + Math.cos(h) * speed, 0, this.worldSize);
    py = clamp(py + Math.sin(h) * speed, 0, this.worldSize);
    ants.x[i] = px;
    ants.y[i] = py;
    ants.heading[i] = wrapAngle(h);
    ants.state[i] = AntState.Wander;
    ants.strength[i] = 0;
    if (this.trailOn) this.field.deposit('food', px, py, PLAYER_TRAIL_AMOUNT);
  }

  private recruit(count: number): void {
    const { ants, index: p } = this;
    const px = ants.x[p]!;
    const py = ants.y[p]!;
    const r2 = RECRUIT_RADIUS * RECRUIT_RADIUS;
    // Keep the `count` nearest candidates; (distance, index) order makes ties deterministic.
    const best: { i: number; d: number }[] = [];
    for (let i = 0; i < ants.count; i++) {
      const s = ants.state[i]!;
      if (i === p || (s !== AntState.Wander && s !== AntState.FollowTrail)) continue;
      if (ants.colony[i] !== PLAYER_COLONY || ants.layer[i] !== 0) continue;
      if (ants.carrying[i]! > 0) continue;
      const dx = ants.x[i]! - px;
      const dy = ants.y[i]! - py;
      const d = dx * dx + dy * dy;
      if (d > r2) continue;
      if (best.length === count && d >= best[count - 1]!.d) continue;
      let k = best.length < count ? best.length : count - 1;
      while (k > 0 && best[k - 1]!.d > d) {
        best[k] = best[k - 1]!;
        k--;
      }
      best[k] = { i, d };
    }
    for (const { i } of best) {
      ants.state[i] = AntState.Recruited;
      ants.strength[i] = 0;
      this.recruited.push(i);
    }
  }

  private release(): void {
    for (const i of this.recruited) this.releaseOne(i);
    this.recruited.length = 0;
  }

  private releaseOne(i: number): void {
    if (i < this.ants.count && this.ants.state[i] === AntState.Recruited) {
      this.ants.state[i] = AntState.Wander;
    }
  }

  private moveRecruits(): void {
    const { ants, cfg, index: p, world } = this;
    const px = ants.x[p]!;
    const py = ants.y[p]!;
    const step = cfg.speed / 20;
    let kept = 0;
    for (let k = 0; k < this.recruited.length; k++) {
      const i = this.recruited[k]!;
      if (i >= ants.count || ants.state[i] !== AntState.Recruited) continue;
      let x = ants.x[i]!;
      let y = ants.y[i]!;
      // Found food: drop out of the group and let normal foraging take over.
      if (world.food.findFoodNear(x, y, cfg.foodSenseRadius * 0.5) >= 0) {
        ants.state[i] = AntState.Wander;
        continue;
      }
      this.recruited[kept++] = i;
      // Loose ring slot around the player: golden-angle spiral, one slot per recruit.
      const a = kept * GOLDEN_ANGLE;
      const r = 10 + 7 * Math.sqrt(kept);
      const dx = px + Math.cos(a) * r - x;
      const dy = py + Math.sin(a) * r - y;
      const dist = Math.hypot(dx, dy);
      let h = ants.heading[i]!;
      if (dist > 2) {
        h = turnTowards(h, Math.atan2(dy, dx), cfg.turnRate * 2);
        h += (this.rng.next() * 2 - 1) * cfg.jitter * 0.5;
        const v = dist > CATCH_UP_DIST ? step * 1.5 : Math.min(step, dist);
        x = clamp(x + Math.cos(h) * v, 0, this.worldSize);
        y = clamp(y + Math.sin(h) * v, 0, this.worldSize);
      } else {
        this.rng.next();
      }
      ants.x[i] = x;
      ants.y[i] = y;
      ants.heading[i] = wrapAngle(h);
    }
    this.recruited.length = kept;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
