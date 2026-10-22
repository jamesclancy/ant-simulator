import type { Difficulty, LawnmowerConfig, MowerInfo, SimEvent } from '@ant/shared';
import { STARVED_HP } from '../ants/store';
import type { AntStore } from '../ants/store';
import type { Colony } from '../colony/colony';
import type { PheromoneField } from '../pheromones';
import { createRng } from '../rng';
import type { Rng } from '../rng';
import type { World } from '../world';

/** Mowing frequency / length per difficulty (harder: more often, more passes). */
export const MOWER_DIFFICULTY: Record<Difficulty, { gap: number; passes: number }> = {
  easy: { gap: 1.5, passes: 0.7 },
  normal: { gap: 1, passes: 1 },
  hard: { gap: 0.7, passes: 1.3 },
};

/** Surface dirt mound beside a nest entrance: where the renderer draws it (see `DirtMound`). */
const MOUND_DX = 1.9;
const MOUND_DY = 0.4;
/** The mower comes on from this far outside the world, so its body is never half in view. */
const MARGIN = 160;

export interface LawnmowerState {
  rng: number;
  countdown: number;
  /** 'idle' | 'warning' | 'mowing'. */
  phase: 'idle' | 'warning' | 'mowing';
  axis: 'x' | 'y';
  lanes: number[];
  pass: number;
  pos: number;
  /** Ticks left of the turn-round between passes (0 = on the field). */
  turn: number;
  /** Ticks left of the warning. */
  warn: number;
  kills: number;
}

export interface LawnmowerContext {
  ants: AntStore;
  world: World;
  fields: readonly PheromoneField[];
  colonies: readonly Colony[];
  playerIndex: number;
  events: SimEvent[];
}

/**
 * The lawnmower. On a seeded timer (warning event and a telegraphed lane first) a mower of
 * `width` sweeps the surface in straight passes along one axis, alternating direction in
 * adjacent lanes. Each tick it kills the surface ants in the strip it just crossed (any
 * colony, the player's ant too: `hp = STARVED_HP`, so no corpse), wipes the surface pheromone
 * there, sweeps away small food piles (big ones lose a share), and flattens dirt mounds.
 * Ants underground are never touched.
 */
export class Lawnmower {
  private readonly rng: Rng;
  private readonly gapScale: number;
  private readonly passScale: number;
  private countdown = 0;
  private phase: LawnmowerState['phase'] = 'idle';
  private axis: 'x' | 'y' = 'x';
  private lanes: number[] = [];
  private pass = 0;
  private pos = 0;
  private turn = 0;
  private warn = 0;
  private kills = 0;

  constructor(
    readonly config: LawnmowerConfig,
    difficulty: Difficulty,
    private readonly worldSize: number,
    seed: number,
  ) {
    const d = MOWER_DIFFICULTY[difficulty] ?? MOWER_DIFFICULTY.normal;
    this.gapScale = d.gap;
    this.passScale = d.passes;
    this.rng = createRng(seed ^ 0x6d0e7);
    this.countdown = this.nextGap();
  }

  get active(): boolean {
    return this.phase !== 'idle';
  }

  private nextGap(): number {
    const c = this.config;
    return Math.max(
      1,
      Math.round(
        (this.rng.range(c.minGap, c.maxGap) * this.gapScale) / Math.max(0.01, c.frequency),
      ),
    );
  }

  /** Plan a mowing: pick the axis and the adjacent lanes, then warm up. */
  start(events: SimEvent[], passes?: number): void {
    if (this.phase !== 'idle') return;
    const c = this.config;
    const n = Math.max(
      1,
      Math.min(
        5,
        Math.round(
          passes ??
            (c.minPasses + this.rng.int(Math.max(1, c.maxPasses - c.minPasses + 1))) *
              this.passScale,
        ),
      ),
    );
    this.axis = this.rng.next() < 0.5 ? 'x' : 'y';
    const span = n * c.width;
    const lo = Math.min(span / 2, this.worldSize / 2);
    const first = this.rng.range(lo, Math.max(lo, this.worldSize - lo)) - span / 2 + c.width / 2;
    this.lanes = [];
    for (let k = 0; k < n; k++) this.lanes.push(Math.round(first + k * c.width));
    this.phase = 'warning';
    this.warn = c.warningTicks;
    this.pass = 0;
    this.kills = 0;
    events.push({ type: 'mowerWarning', ticks: this.warn });
  }

  /** Front of the mower on its axis at the start of `pass`, and its direction. */
  private entry(pass: number): { pos: number; dir: 1 | -1 } {
    return pass % 2 === 0 ? { pos: -MARGIN, dir: 1 } : { pos: this.worldSize + MARGIN, dir: -1 };
  }

  info(): MowerInfo | undefined {
    if (this.phase === 'idle') return undefined;
    const mowing = this.phase === 'mowing';
    return {
      phase: this.phase,
      startsIn: mowing ? 0 : this.warn,
      axis: this.axis,
      lanes: [...this.lanes],
      width: this.config.width,
      pass: mowing ? this.pass : -1,
      dir: this.entry(this.pass).dir,
      pos: this.pos,
      onField: mowing && this.turn <= 0,
    };
  }

  step(ctx: LawnmowerContext): void {
    const c = this.config;
    if (this.phase === 'idle') {
      if (!c.enabled) return;
      if (--this.countdown <= 0) this.start(ctx.events);
      return;
    }
    if (this.phase === 'warning') {
      if (--this.warn > 0) return;
      this.phase = 'mowing';
      this.pass = 0;
      this.pos = this.entry(0).pos;
      this.turn = 0;
      ctx.events.push({ type: 'mowerStarted' });
      return;
    }
    if (this.turn > 0) {
      if (--this.turn === 0) this.pos = this.entry(this.pass).pos;
      return;
    }
    const { dir } = this.entry(this.pass);
    const prev = this.pos;
    this.pos += dir * c.speed;
    this.cut(ctx, Math.min(prev, this.pos), Math.max(prev, this.pos), this.lanes[this.pass]!);
    const done = dir > 0 ? this.pos >= this.worldSize + MARGIN : this.pos <= -MARGIN;
    if (!done) return;
    if (++this.pass >= this.lanes.length) {
      this.phase = 'idle';
      this.lanes = [];
      this.countdown = this.nextGap();
      ctx.events.push({ type: 'mowerEnded', kills: this.kills });
    } else {
      this.turn = c.turnTicks;
    }
  }

  /** Cut the strip `[from, to]` along the travel axis, `width` wide around `lane`. */
  private cut(ctx: LawnmowerContext, from: number, to: number, lane: number): void {
    const half = this.config.width / 2;
    const alongX = this.axis === 'x';
    const inside = (x: number, y: number): boolean => {
      const along = alongX ? x : y;
      const across = alongX ? y : x;
      return along >= from && along < to && Math.abs(across - lane) <= half;
    };

    const { ants } = ctx;
    const { x, y, layer, hp } = ants;
    for (let i = 0; i < ants.count; i++) {
      if (layer[i] !== 0 || hp[i]! <= 0 || !inside(x[i]!, y[i]!)) continue;
      hp[i] = STARVED_HP;
      this.kills++;
      if (i === ctx.playerIndex) ctx.events.push({ type: 'playerEaten', cause: 'mower' });
    }

    for (const f of ctx.fields) {
      const res = f.resolution;
      const cell = f.cellSize;
      // Cell centres inside the strip.
      const a0 = Math.max(0, Math.ceil(from / cell - 0.5));
      const a1 = Math.min(res - 1, Math.ceil(to / cell - 0.5) - 1);
      const b0 = Math.max(0, Math.ceil((lane - half) / cell - 0.5));
      const b1 = Math.min(res - 1, Math.floor((lane + half) / cell - 0.5));
      if (a0 > a1 || b0 > b1) continue;
      for (const type of f.types) {
        const d = f.layer(type);
        for (let b = b0; b <= b1; b++) {
          for (let a = a0; a <= a1; a++) d[alongX ? b * res + a : a * res + b] = 0;
        }
      }
    }

    for (const food of [...ctx.world.food.list()]) {
      if (!inside(food.x, food.y)) continue;
      if (food.amount <= this.config.smallFood) ctx.world.food.remove(food.id);
      else ctx.world.food.takeFood(food.id, food.amount * this.config.bigFoodLoss);
    }

    for (const col of ctx.colonies) {
      const { x: nx, y: ny, radius } = col.nest;
      if (col.dirt > 0 && inside(nx + radius * MOUND_DX, ny + radius * MOUND_DY)) col.dirt = 0;
    }
  }

  getState(): LawnmowerState {
    return {
      rng: this.rng.getState(),
      countdown: this.countdown,
      phase: this.phase,
      axis: this.axis,
      lanes: [...this.lanes],
      pass: this.pass,
      pos: this.pos,
      turn: this.turn,
      warn: this.warn,
      kills: this.kills,
    };
  }

  setState(s: LawnmowerState): void {
    this.rng.setState(s.rng);
    this.countdown = s.countdown;
    this.phase = s.phase;
    this.axis = s.axis;
    this.lanes = [...s.lanes];
    this.pass = s.pass;
    this.pos = s.pos;
    this.turn = s.turn;
    this.warn = s.warn;
    this.kills = s.kills;
  }
}
