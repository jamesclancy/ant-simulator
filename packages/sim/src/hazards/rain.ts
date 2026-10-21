import { AntState, NEST_TILE } from '@ant/shared';
import type {
  AntBehaviorConfig,
  Difficulty,
  RainConfig,
  SimEvent,
  WaterGridSnapshot,
  WeatherInfo,
} from '@ant/shared';
import { STARVED_HP } from '../ants/store';
import type { AntStore } from '../ants/store';
import type { Colony } from '../colony/colony';
import type { PheromoneField } from '../pheromones';
import { createRng } from '../rng';
import type { Rng } from '../rng';
import { Water } from './water';
import type { WaterState } from './water';

/** Shower frequency / length per difficulty (harder: more, longer rain). */
export const RAIN_DIFFICULTY: Record<Difficulty, { gap: number; duration: number }> = {
  easy: { gap: 1.5, duration: 0.7 },
  normal: { gap: 1, duration: 1 },
  hard: { gap: 0.7, duration: 1.3 },
};

/** Water snapshots are sent at most once per this many ticks. */
const WATER_SNAPSHOT_INTERVAL = 4;

export interface WeatherState {
  rng: number;
  /** Ticks until the next shower while it is dry. */
  countdown: number;
  /** Ticks of the current shower left (0 = dry). */
  remaining: number;
  /** Ticks since the current shower began. */
  elapsed: number;
  warned: boolean;
  broodLoss: number[];
  water: WaterState[];
}

export interface WeatherContext {
  ants: AntStore;
  colonies: readonly Colony[];
  fields: readonly PheromoneField[];
  playerIndex: number;
  /** Ant walking speed in world units per tick. */
  antStep: number;
  events: SimEvent[];
}

/**
 * Weather: a seeded timer starts showers (warning event first). While it rains the surface
 * pheromone fields evaporate much faster, surface ants slow down and every nest takes water
 * at its entrance (see `Water`). Ants standing in flooded tiles drown slowly and try to
 * climb to drier neighbours; brood in flooded nursery tiles dies. Runs after the colonies
 * have moved and before the dead are reaped: drowning is `hp = STARVED_HP`, the normal
 * removal path (no corpse food, player swap included).
 */
export class Weather {
  private readonly rng: Rng;
  private countdown = 0;
  private remaining = 0;
  private elapsed = 0;
  private warned = false;
  private readonly water: Water[];
  private readonly broodLoss: number[];
  private readonly lastSent: number[];
  private readonly gapScale: number;
  private readonly durationScale: number;
  /** Scratch copy of the behaviour config with the rain slow-down applied. */
  private readonly wetBehavior = {} as AntBehaviorConfig;

  constructor(
    readonly config: RainConfig,
    difficulty: Difficulty,
    seed: number,
    colonies: readonly Colony[],
  ) {
    const d = RAIN_DIFFICULTY[difficulty] ?? RAIN_DIFFICULTY.normal;
    this.gapScale = d.gap;
    this.durationScale = d.duration;
    this.rng = createRng(seed ^ 0x7a1e5);
    this.water = colonies.map((c) => new Water(c.grid));
    this.broodLoss = colonies.map(() => 0);
    this.lastSent = colonies.map(() => 0);
    this.countdown = this.nextGap();
  }

  get raining(): boolean {
    return this.remaining > 0;
  }

  /** 0..1: builds up over `rampTicks` at the start and dies away at the end of a shower. */
  get intensity(): number {
    if (this.remaining <= 0) return 0;
    const ramp = Math.max(1, this.config.rampTicks);
    return Math.min(1, (this.elapsed + 1) / ramp, this.remaining / ramp);
  }

  waterOf(colony: number): Water | undefined {
    return this.water[colony];
  }

  /** Total wet tiles over all nests. */
  get wetTiles(): number {
    let n = 0;
    for (const w of this.water) n += w.wet;
    return n;
  }

  /** Start a shower now (`ticks` defaults to a random duration). */
  start(ticks?: number, events?: SimEvent[]): void {
    const c = this.config;
    const len = Math.max(
      1,
      Math.round(ticks ?? this.rng.range(c.minDuration, c.maxDuration) * this.durationScale),
    );
    if (this.remaining <= 0) events?.push({ type: 'rainStarted' });
    this.remaining = len;
    this.elapsed = 0;
    this.warned = true;
  }

  /** Let the current shower die away (it fades over `rampTicks`). */
  stop(): void {
    if (this.remaining > 0)
      this.remaining = Math.min(this.remaining, Math.max(1, this.config.rampTicks));
  }

  private nextGap(): number {
    const c = this.config;
    return Math.round(this.rng.range(c.minGap, c.maxGap) * this.gapScale);
  }

  /** Behaviour config to move the surface ants with: slower while it rains. */
  behaviorFor(base: AntBehaviorConfig): AntBehaviorConfig {
    const k = this.intensity;
    if (k <= 0) return base;
    Object.assign(this.wetBehavior, base);
    this.wetBehavior.speed = base.speed * (1 - k * (1 - this.config.surfaceSpeed));
    return this.wetBehavior;
  }

  step(ctx: WeatherContext): void {
    const c = this.config;
    if (this.remaining > 0) {
      this.remaining--;
      this.elapsed++;
      if (this.remaining === 0) {
        ctx.events.push({ type: 'rainEnded' });
        this.countdown = this.nextGap();
        this.warned = false;
      }
    } else if (c.enabled) {
      if (!this.warned && this.countdown <= c.warningTicks) {
        this.warned = true;
        ctx.events.push({ type: 'rainWarning', ticks: Math.max(0, this.countdown) });
      }
      if (--this.countdown <= 0) this.start(undefined, ctx.events);
    }

    const k = this.intensity;
    const scale = 1 + (c.evaporationMult - 1) * k;
    for (const f of ctx.fields) if (f.evaporationScale !== scale) f.evaporationScale = scale;

    const loss = this.remaining > 0 ? 0 : c.drain;
    let anyWet = false;
    ctx.colonies.forEach((col, id) => {
      const water = this.water[id]!;
      if (k <= 0 && water.wet === 0) return;
      water.step(c.inflow * k, c.flow, c.seep, loss);
      if (water.wet > 0) anyWet = true;
      this.floodBrood(col, water);
    });
    if (anyWet) this.drown(ctx);
  }

  /** Brood dies in proportion to how much of the nursery is under water. */
  private floodBrood(col: Colony, water: Water): void {
    const nursery = col.grid.nurseryTiles;
    const brood = col.brood;
    if (water.wet === 0 || !nursery.length || brood.count === 0) return;
    let flooded = 0;
    for (const t of nursery) if (water.at(t) > this.config.broodLevel) flooded++;
    if (flooded === 0) return;
    const id = col.id;
    this.broodLoss[id]! += (brood.count * this.config.broodKill * flooded) / nursery.length;
    while (this.broodLoss[id]! >= 1 && brood.count > 0) {
      this.broodLoss[id]! -= 1;
      brood.remove(this.rng.int(brood.count));
    }
  }

  /** Underground ants in flooded tiles take damage and climb towards drier neighbours. */
  private drown(ctx: WeatherContext): void {
    const { ants, colonies } = ctx;
    const { x, y, layer, hp, state } = ants;
    const c = this.config;
    for (let i = 0; i < ants.count; i++) {
      const l = layer[i]!;
      if (l === 0 || state[i] === AntState.Fight) continue;
      const col = colonies[l - 1];
      const water = this.water[l - 1];
      if (!col || !water || water.wet === 0) continue;
      const w = col.grid.width;
      const tx = Math.floor(x[i]! / NEST_TILE);
      const ty = Math.floor(y[i]! / NEST_TILE);
      const ti = ty * w + tx;
      if (ti < 0 || ti >= water.levels.length) continue;
      const level = water.levels[ti]!;
      if (level <= c.drownLevel) continue;
      if (hp[i]! > 0) {
        hp[i] = hp[i]! - c.drownDamage * level;
        if (hp[i]! <= 0) {
          hp[i] = STARVED_HP;
          if (i === ctx.playerIndex) ctx.events.push({ type: 'playerEaten', cause: 'drowned' });
          continue;
        }
      }
      // Climb: head for the driest open neighbour.
      const g = col.grid;
      let best = -1;
      let bestLevel = level - 0.02;
      for (const n of [ti - w, ti - 1, ti + 1, ti + w]) {
        if (n < 0 || n >= water.levels.length || !g.isOpenIndex(n)) continue;
        const nl = water.levels[n]!;
        if (nl < bestLevel) {
          bestLevel = nl;
          best = n;
        }
      }
      if (best < 0) continue;
      const bx = best % w;
      const by = (best - bx) / w;
      const dx = (bx + 0.5) * NEST_TILE - x[i]!;
      const dy = (by + 0.5) * NEST_TILE - y[i]!;
      const len = Math.hypot(dx, dy) || 1;
      const push = Math.min(len, ctx.antStep * 0.8);
      x[i] = x[i]! + (dx / len) * push;
      y[i] = y[i]! + (dy / len) * push;
    }
  }

  info(): WeatherInfo {
    return {
      raining: this.remaining > 0,
      intensity: this.intensity,
      ticksToRain: this.remaining > 0 || !this.config.enabled ? -1 : Math.max(0, this.countdown),
    };
  }

  /** Water grids that changed since last sent (throttled), or all of them when `force`. */
  snapshotWater(tick: number, force = false): WaterGridSnapshot[] {
    const out: WaterGridSnapshot[] = [];
    this.water.forEach((w, colony) => {
      if (this.lastSent[colony] === w.version) return;
      if (!force && tick % WATER_SNAPSHOT_INTERVAL !== 0 && w.wet > 0) return;
      this.lastSent[colony] = w.version;
      out.push({ colony, version: w.version, levels: w.pack() });
    });
    return out;
  }

  getState(): WeatherState {
    return {
      rng: this.rng.getState(),
      countdown: this.countdown,
      remaining: this.remaining,
      elapsed: this.elapsed,
      warned: this.warned,
      broodLoss: [...this.broodLoss],
      water: this.water.map((w) => w.getState()),
    };
  }

  setState(s: WeatherState): void {
    this.rng.setState(s.rng);
    this.countdown = s.countdown;
    this.remaining = s.remaining;
    this.elapsed = s.elapsed;
    this.warned = s.warned;
    s.broodLoss.forEach((v, i) => (this.broodLoss[i] = v));
    s.water.forEach((w, i) => this.water[i]?.setState(w));
    // A dry nest needs no resend (a fresh client starts dry); a wet one must be redrawn.
    this.water.forEach((w, i) => (this.lastSent[i] = w.wet > 0 ? -1 : w.version));
  }
}
