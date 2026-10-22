import type { Difficulty, SimEvent, YardStepsConfig } from '@ant/shared';
import type { AntStore } from '../ants/store';
import { createRng } from '../rng';
import type { Rng } from '../rng';
import { Footsteps } from './footsteps';
import type { FootstepsState } from './footsteps';

/** Walk frequency / length per difficulty (harder: more, longer walks). */
export const YARD_STEPS_DIFFICULTY: Record<Difficulty, { gap: number; feet: number }> = {
  easy: { gap: 1.5, feet: 0.8 },
  normal: { gap: 1, feet: 1 },
  hard: { gap: 0.7, feet: 1.2 },
};

export interface YardStepsState {
  rng: number;
  /** Ticks until the next walk while idle. */
  countdown: number;
  warned: boolean;
  feet: FootstepsState;
}

export interface YardStepsContext {
  ants: AntStore;
  playerIndex: number;
  events: SimEvent[];
}

/**
 * A human crossing the yard: on a seeded timer (warning event first) a straight line of large
 * footfalls is laid across the world, alternating left and right of the line. Each foot's
 * shadow appears one stride after the last, grows for `shadowTicks` and then stamps down,
 * crushing the surface ants beneath it; the feet themselves are the house `Footsteps`.
 */
export class YardSteps {
  private readonly rng: Rng;
  private readonly feet: Footsteps;
  private readonly gapScale: number;
  private readonly feetScale: number;
  private countdown = 0;
  private warned = false;

  constructor(
    readonly config: YardStepsConfig,
    difficulty: Difficulty,
    private readonly worldSize: number,
    seed: number,
  ) {
    const d = YARD_STEPS_DIFFICULTY[difficulty] ?? YARD_STEPS_DIFFICULTY.normal;
    this.gapScale = d.gap;
    this.feetScale = d.feet;
    this.rng = createRng(seed ^ 0x57e9);
    this.feet = new Footsteps(seed ^ 0x9a4d);
    this.countdown = this.nextGap();
  }

  /** Feet waiting or visible. */
  get count(): number {
    return this.feet.count;
  }

  info() {
    return this.feet.info();
  }

  /** Ticks until the next walk starts on its own. */
  get ticksToWalk(): number {
    return this.countdown;
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

  /** A human starts across the yard now. */
  start(): void {
    const c = this.config;
    const size = this.worldSize;
    const n = Math.max(
      2,
      Math.round(
        (c.minFeet + this.rng.int(Math.max(1, c.maxFeet - c.minFeet + 1))) * this.feetScale,
      ),
    );
    // A straight line from one edge towards the opposite one, at a seeded angle.
    const a = this.rng.range(0, Math.PI * 2);
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const len = c.stride * (n - 1);
    const cx = this.rng.range(size * 0.25, size * 0.75);
    const cy = this.rng.range(size * 0.25, size * 0.75);
    for (let k = 0; k < n; k++) {
      const t = k * c.stride - len / 2;
      const side = k % 2 ? 1 : -1;
      this.feet.addFoot({
        x: clamp(cx + dx * t - dy * side * c.offset, 0, size),
        y: clamp(cy + dy * t + dx * side * c.offset, 0, size),
        delay: k * c.strideTicks,
        radius: c.radius,
        warn: c.shadowTicks,
        show: c.showTicks,
        angle: a,
      });
    }
  }

  step(ctx: YardStepsContext): void {
    const c = this.config;
    if (c.enabled) {
      if (!this.warned && this.countdown <= c.warningTicks) {
        this.warned = true;
        ctx.events.push({ type: 'humansWarning', ticks: Math.max(0, this.countdown) });
      }
      if (--this.countdown <= 0) {
        this.start();
        this.countdown = this.nextGap();
        this.warned = false;
      }
    }
    this.feet.advance(ctx.ants, ctx.events, ctx.playerIndex);
  }

  getState(): YardStepsState {
    return {
      rng: this.rng.getState(),
      countdown: this.countdown,
      warned: this.warned,
      feet: this.feet.getState(),
    };
  }

  setState(s: YardStepsState): void {
    this.rng.setState(s.rng);
    this.countdown = s.countdown;
    this.warned = s.warned;
    this.feet.setState(s.feet);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
