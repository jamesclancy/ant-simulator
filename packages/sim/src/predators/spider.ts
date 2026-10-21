import { AntState, Caste, SpiderState } from '@ant/shared';
import type { CombatConfig, Difficulty, SimEvent, SpiderConfig, SpiderInfo } from '@ant/shared';
import { STARVED_HP } from '../ants/store';
import type { AntStore } from '../ants/store';
import { SpatialHash } from '../combat/hash';
import type { PheromoneField } from '../pheromones';
import type { World } from '../world';

/** Hit points and speed multipliers per difficulty (the spider is part of the yard's threat). */
export const SPIDER_DIFFICULTY: Record<Difficulty, { hp: number; speed: number }> = {
  easy: { hp: 0.7, speed: 0.9 },
  normal: { hp: 1, speed: 1 },
  hard: { hp: 1.4, speed: 1.1 },
};

/** Plain-data spider state: everything needed to restore a spider (save/load). */
export interface SpiderData {
  id: number;
  x: number;
  y: number;
  heading: number;
  state: SpiderState;
  hp: number;
  maxHp: number;
  homeX: number;
  homeY: number;
  /** Eat pause remaining, or ticks until respawn while dead. */
  timer: number;
}

export interface SpiderManagerState {
  nextId: number;
  spiders: SpiderData[];
}

export interface SpiderContext {
  ants: AntStore;
  /** Surface spatial hash, built this tick (positions may be up to a step stale). */
  hash: SpatialHash;
  world: World;
  /** One alarm layer per colony; the spider alarms all of them. */
  fields: readonly PheromoneField[];
  combat: CombatConfig;
  playerIndex: number;
  /** Ant walking speed in world units per tick. */
  antStep: number;
  events: SimEvent[];
}

/**
 * The spider predator(s). One pass per spider per tick, run after the ants have moved and
 * before the dead are reaped; kills are `hp = STARVED_HP` so they take the normal removal /
 * compaction path (player swap included) and leave no corpse food.
 *
 * States: Lurk (sits at its lair; walks back to it if it is away; regenerates) -> Hunt
 * (walks at the best-scoring cell in `senseRadius`: ant count over distance, never beyond
 * `leash` of home; bites the nearest ant within `biteRange`) -> Eat (stands still after a
 * kill) -> Hunt ... ; below `retreatFraction` hp it Retreats home, ignoring ants, until
 * healed to 90%. At 0 hp it dies: drops `foodDrop` food and respawns at its lair after
 * `respawnTicks`.
 *
 * Ants fight back by contact: every ant within `contactRange` removes hp per tick (soldiers
 * the most). The spider lays alarm in every colony's field while ants are near. Non-soldier
 * ants within `fleeRadius` run away (a push on top of their own move) unless the mob
 * (workers 1, soldiers `soldierMobWeight`, within `mobRadius`) reaches `mobSize`, then they
 * stand their ground and the alarm trail draws the rest in. Soldiers never flee.
 */
export class SpiderManager {
  private spiders: SpiderData[] = [];
  private nextId = 0;
  private readonly hpScale: number;
  private readonly speedScale: number;

  constructor(
    readonly config: SpiderConfig,
    difficulty: Difficulty,
    private readonly worldSize: number,
  ) {
    const d = SPIDER_DIFFICULTY[difficulty] ?? SPIDER_DIFFICULTY.normal;
    this.hpScale = d.hp;
    this.speedScale = d.speed;
  }

  get count(): number {
    return this.spiders.length;
  }

  /** Add a spider lurking at (x, y), which becomes its lair. Returns its id. */
  add(x: number, y: number): number {
    const maxHp = this.config.hp * this.hpScale;
    const id = this.nextId++;
    this.spiders.push({
      id,
      x,
      y,
      heading: 0,
      state: SpiderState.Lurk,
      hp: maxHp,
      maxHp,
      homeX: x,
      homeY: y,
      timer: 0,
    });
    return id;
  }

  /** Remove every spider (alive or dead) whose position is within `radius` of (x, y). */
  removeNear(x: number, y: number, radius: number): number {
    const before = this.spiders.length;
    this.spiders = this.spiders.filter((s) => Math.hypot(s.x - x, s.y - y) > radius);
    return before - this.spiders.length;
  }

  info(): SpiderInfo[] {
    return this.spiders.map((s) => ({
      id: s.id,
      x: s.x,
      y: s.y,
      heading: s.heading,
      state: s.state,
      hp: s.hp,
      maxHp: s.maxHp,
    }));
  }

  /** Plain-data copy of all spider state (for save/load). */
  getState(): SpiderManagerState {
    return { nextId: this.nextId, spiders: this.spiders.map((s) => ({ ...s })) };
  }

  setState(state: SpiderManagerState): void {
    this.nextId = state.nextId;
    this.spiders = state.spiders.map((s) => ({ ...s }));
  }

  step(ctx: SpiderContext): void {
    for (const s of this.spiders) this.stepOne(s, ctx);
  }

  private stepOne(s: SpiderData, ctx: SpiderContext): void {
    const cfg = this.config;
    if (s.state === SpiderState.Dead) {
      if (--s.timer <= 0) {
        s.state = SpiderState.Lurk;
        s.hp = s.maxHp;
        s.x = s.homeX;
        s.y = s.homeY;
      }
      return;
    }
    const { ants, hash, combat } = ctx;
    const { x, y, layer, caste } = ants;
    const nc = hash.colonies;
    const { start, items } = hash;
    const cols = hash.surfCols;
    const reach = Math.ceil(Math.max(cfg.senseRadius, cfg.mobRadius) / 32);
    const cx = SpatialHash.coord(s.x, cols);
    const cy = SpatialHash.coord(s.y, cols);
    const x0 = Math.max(0, cx - reach);
    const x1 = Math.min(cols - 1, cx + reach);
    const y0 = Math.max(0, cy - reach);
    const y1 = Math.min(cols - 1, cy + reach);
    const contact2 = cfg.contactRange * cfg.contactRange;
    const bite2 = cfg.biteRange * cfg.biteRange;
    const mob2 = cfg.mobRadius * cfg.mobRadius;
    const sense2 = cfg.senseRadius * cfg.senseRadius;
    const leash2 = cfg.leash * cfg.leash;

    let mob = 0;
    let damage = 0;
    let bite = -1;
    let biteD2 = bite2;
    let bestScore = 0;
    let bestCell = -1;
    let near = 0;

    // Pass 1: count the mob, take damage, find a victim and the juiciest cell.
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        const b0 = (gy * cols + gx) * nc;
        const n = start[b0 + nc]! - start[b0]!;
        if (n === 0) continue;
        const ccx = (gx + 0.5) * 32 - s.x;
        const ccy = (gy + 0.5) * 32 - s.y;
        const hx = (gx + 0.5) * 32 - s.homeX;
        const hy = (gy + 0.5) * 32 - s.homeY;
        if (hx * hx + hy * hy <= leash2 && ccx * ccx + ccy * ccy <= sense2 * 1.5) {
          const score = n / (1 + Math.sqrt(ccx * ccx + ccy * ccy) / 64);
          if (score > bestScore) {
            bestScore = score;
            bestCell = gy * cols + gx;
          }
        }
        for (let p = start[b0]!, end = start[b0 + nc]!; p < end; p++) {
          const j = items[p]!;
          if (layer[j] !== 0 || ants.hp[j]! <= 0) continue;
          const dx = x[j]! - s.x;
          const dy = y[j]! - s.y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= mob2) {
            mob += caste[j] === Caste.Soldier ? cfg.soldierMobWeight : 1;
            near++;
          }
          if (d2 <= contact2) {
            damage += j === ctx.playerIndex ? combat.playerDamage : cfg.damage[caste[j]!]!;
          }
          if (d2 < biteD2) {
            bite = j;
            biteD2 = d2;
          }
        }
      }
    }

    s.hp -= damage;
    if (s.hp <= 0) {
      s.hp = 0;
      s.state = SpiderState.Dead;
      s.timer = cfg.respawnTicks;
      ctx.world.food.add(s.x, s.y, cfg.foodDrop);
      ctx.events.push({ type: 'spiderKilled', x: s.x, y: s.y });
      return;
    }

    if (near > 0) this.layAlarm(s, ctx);

    // Pass 2: ants that are not up to the fight run.
    if (mob < cfg.mobSize) this.scatter(s, ctx);

    const baseStep = ctx.antStep * this.speedScale;
    const hunt = baseStep * cfg.huntSpeed;
    const atHome = (s.homeX - s.x) ** 2 + (s.homeY - s.y) ** 2 < 36;
    if (s.state !== SpiderState.Retreat && s.hp < s.maxHp * cfg.retreatFraction) {
      s.state = SpiderState.Retreat;
    }

    switch (s.state) {
      case SpiderState.Retreat:
        if (atHome) {
          s.hp = Math.min(s.maxHp, s.hp + cfg.regen);
          if (s.hp >= s.maxHp * 0.9) s.state = SpiderState.Lurk;
        } else {
          this.moveTo(s, s.homeX, s.homeY, hunt * 1.2);
        }
        return;
      case SpiderState.Eat:
        if (--s.timer <= 0) s.state = SpiderState.Hunt;
        return;
    }

    if (bite >= 0) {
      ants.hp[bite] = STARVED_HP;
      if (bite === ctx.playerIndex) ctx.events.push({ type: 'playerEaten' });
      s.state = SpiderState.Eat;
      s.timer = cfg.eatTicks;
      return;
    }

    if (bestCell >= 0) {
      // Aim at the centroid of the chosen cell's ants.
      const gx = bestCell % cols;
      const gy = (bestCell - gx) / cols;
      const b0 = (gy * cols + gx) * nc;
      let sx = 0;
      let sy = 0;
      let k = 0;
      for (let p = start[b0]!, end = start[b0 + nc]!; p < end; p++) {
        const j = items[p]!;
        sx += x[j]!;
        sy += y[j]!;
        k++;
      }
      if (k > 0) {
        s.state = SpiderState.Hunt;
        this.moveTo(s, sx / k, sy / k, hunt);
        return;
      }
    }

    // Nothing to chase: go home and lurk.
    s.state = SpiderState.Lurk;
    if (atHome) {
      if (s.hp < s.maxHp) s.hp = Math.min(s.maxHp, s.hp + cfg.regen);
    } else {
      this.moveTo(s, s.homeX, s.homeY, baseStep);
    }
  }

  private moveTo(s: SpiderData, tx: number, ty: number, speed: number): void {
    const dx = tx - s.x;
    const dy = ty - s.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) return;
    s.heading = Math.atan2(dy, dx);
    const v = Math.min(speed, d);
    s.x = clamp(s.x + (dx / d) * v, 0, this.worldSize);
    s.y = clamp(s.y + (dy / d) * v, 0, this.worldSize);
  }

  /** 5x5-cell splash of alarm around the spider in every colony's field. */
  private layAlarm(s: SpiderData, ctx: SpiderContext): void {
    for (const f of ctx.fields) {
      const alarm = f.layer('alarm');
      const res = f.resolution;
      const max = f.config.alarm.max;
      const gx = Math.floor(s.x / f.cellSize);
      const gy = Math.floor(s.y / f.cellSize);
      for (let ay = gy - 2; ay <= gy + 2; ay++) {
        if (ay < 0 || ay >= res) continue;
        for (let ax = gx - 2; ax <= gx + 2; ax++) {
          if (ax < 0 || ax >= res) continue;
          const ci = ay * res + ax;
          const v = alarm[ci]! + this.config.alarmDeposit;
          alarm[ci] = v > max ? max : v;
        }
      }
    }
  }

  /** Push non-soldier ants within `fleeRadius` away from the spider. */
  private scatter(s: SpiderData, ctx: SpiderContext): void {
    const { ants, hash } = ctx;
    const { x, y, layer, caste, state, heading } = ants;
    const cfg = this.config;
    const nc = hash.colonies;
    const cols = hash.surfCols;
    const reach = Math.ceil(cfg.fleeRadius / 32);
    const cx = SpatialHash.coord(s.x, cols);
    const cy = SpatialHash.coord(s.y, cols);
    const flee2 = cfg.fleeRadius * cfg.fleeRadius;
    const push = ctx.antStep * 1.2;
    for (let gy = Math.max(0, cy - reach); gy <= Math.min(cols - 1, cy + reach); gy++) {
      for (let gx = Math.max(0, cx - reach); gx <= Math.min(cols - 1, cx + reach); gx++) {
        const b0 = (gy * cols + gx) * nc;
        for (let p = hash.start[b0]!, end = hash.start[b0 + nc]!; p < end; p++) {
          const j = hash.items[p]!;
          const st = state[j]!;
          if (
            layer[j] !== 0 ||
            j === ctx.playerIndex ||
            caste[j] === Caste.Soldier ||
            st === AntState.Recruited ||
            st === AntState.Fight
          ) {
            continue;
          }
          const dx = x[j]! - s.x;
          const dy = y[j]! - s.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > flee2 || d2 < 1e-6) continue;
          const d = Math.sqrt(d2);
          heading[j] = Math.atan2(dy, dx);
          x[j] = clamp(x[j]! + (dx / d) * push, 0, this.worldSize);
          y[j] = clamp(y[j]! + (dy / d) * push, 0, this.worldSize);
        }
      }
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
