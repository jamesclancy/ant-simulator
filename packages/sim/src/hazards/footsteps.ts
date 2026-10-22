import { PLAYER_COLONY } from '@ant/shared';
import type { FootstepInfo, SimEvent } from '@ant/shared';
import type { AntStore } from '../ants/store';
import { createRng } from '../rng';

/** Human feet tuning (ticks at 20 Hz, distances in world units). */
export const FOOTSTEPS = {
  /** Chance per tick of a new foot with no ants indoors... */
  baseRate: 1 / 500,
  /** ...multiplied by `1 + crowd x min(2, indoor / target)`: more ants, more stamping. */
  crowd: 2,
  radius: 70,
  /** Shadow time before the foot stamps (time to run). */
  warnTicks: 40,
  /** The stamp stays visible this long. */
  showTicks: 12,
  /** Chance a foot aims at a black ant on the surface rather than a random spot. */
  aim: 0.6,
  maxFeet: 3,
};

interface Foot {
  id: number;
  x: number;
  y: number;
  /** Ticks since the shadow appeared; negative while the foot is still waiting to come down. */
  age: number;
  /** Per-foot overrides (yard walks); the house feet use `FOOTSTEPS`. */
  radius?: number;
  warn?: number;
  show?: number;
  angle?: number;
}

/** Shape of one foot of a scripted walk (see `Footsteps.addFoot`). */
export interface FootSpec {
  x: number;
  y: number;
  /** Ticks to wait before the shadow appears. */
  delay: number;
  radius: number;
  warn: number;
  show: number;
  /** Walking direction in radians. */
  angle: number;
}

export interface FootstepsState {
  rng: number;
  nextId: number;
  feet: Foot[];
}

/**
 * Human feet: shadow, then stamp. Used for the humans in a house room (random feet, drawn to
 * crowds; see `step`) and for scripted walks across the yard (`addFoot`, see `YardSteps`).
 * A foot appears as a growing shadow and stamps down after its warning time, killing every
 * surface ant underneath (any colony, the player's ant too). Ants underground are safe.
 */
export class Footsteps {
  private rng;
  private nextId = 1;
  private feet: Foot[] = [];

  constructor(seed: number) {
    this.rng = createRng(seed ^ 0xf007);
  }

  get count(): number {
    return this.feet.length;
  }

  clear(): void {
    this.feet = [];
  }

  /**
   * One tick. `pressure` is the indoor crowding (black ants in the house / target), `rate`
   * the difficulty multiplier.
   */
  step(
    ants: AntStore,
    worldSize: number,
    pressure: number,
    rate: number,
    events: SimEvent[],
  ): void {
    const F = FOOTSTEPS;
    const chance = F.baseRate * rate * (1 + F.crowd * Math.min(2, Math.max(0, pressure)));
    if (this.feet.length < F.maxFeet && this.rng.next() < chance)
      this.spawn(ants, worldSize, events);
    this.advance(ants, events);
  }

  /** Queue a scripted foot: its shadow appears after `spec.delay` ticks. */
  addFoot(spec: FootSpec): void {
    this.feet.push({
      id: this.nextId++,
      x: spec.x,
      y: spec.y,
      age: -Math.max(0, Math.round(spec.delay)) - 1,
      radius: spec.radius,
      warn: spec.warn,
      show: spec.show,
      angle: spec.angle,
    });
  }

  /**
   * Age every foot one tick; a foot whose shadow is complete stamps, crushing the surface ants
   * under it. With `playerIndex`, killing the player's ant also raises `playerEaten`.
   */
  advance(ants: AntStore, events: SimEvent[], playerIndex = -1): void {
    for (const foot of this.feet) {
      foot.age++;
      if (foot.age === 0 && foot.warn !== undefined) {
        events.push({ type: 'footstepWarning', x: foot.x, y: foot.y, ticks: foot.warn });
      }
      if (foot.age !== (foot.warn ?? FOOTSTEPS.warnTicks)) continue;
      const radius = foot.radius ?? FOOTSTEPS.radius;
      const r2 = radius * radius;
      let kills = 0;
      const { x, y, layer, hp } = ants;
      for (let i = 0; i < ants.count; i++) {
        if (layer[i] !== 0 || hp[i]! <= 0) continue;
        const dx = x[i]! - foot.x;
        const dy = y[i]! - foot.y;
        if (dx * dx + dy * dy > r2) continue;
        hp[i] = 0; // crushed: the sim reaps it next tick (it leaves a corpse)
        kills++;
        if (i === playerIndex) events.push({ type: 'playerEaten', cause: 'stomped' });
      }
      events.push({ type: 'footstep', x: foot.x, y: foot.y, kills });
    }
    this.feet = this.feet.filter(
      (f) => f.age < (f.warn ?? FOOTSTEPS.warnTicks) + (f.show ?? FOOTSTEPS.showTicks),
    );
  }

  private spawn(ants: AntStore, worldSize: number, events: SimEvent[]): void {
    let x = this.rng.range(worldSize * 0.1, worldSize * 0.9);
    let y = this.rng.range(worldSize * 0.1, worldSize * 0.9);
    if (ants.count > 0 && this.rng.next() < FOOTSTEPS.aim) {
      // Humans step where they see ants: pick a random black surface ant (a few tries).
      for (let t = 0; t < 8; t++) {
        const i = this.rng.int(ants.count);
        if (ants.layer[i] !== 0 || ants.colony[i] !== PLAYER_COLONY) continue;
        x = ants.x[i]! + this.rng.range(-30, 30);
        y = ants.y[i]! + this.rng.range(-30, 30);
        break;
      }
    }
    const foot = { id: this.nextId++, x, y, age: 0 };
    this.feet.push(foot);
    events.push({ type: 'footstepWarning', x, y, ticks: FOOTSTEPS.warnTicks });
  }

  info(): FootstepInfo[] {
    const F = FOOTSTEPS;
    return this.feet
      .filter((f) => f.age >= 0)
      .map((f) => {
        const warn = f.warn ?? F.warnTicks;
        return {
          id: f.id,
          x: f.x,
          y: f.y,
          radius: f.radius ?? F.radius,
          progress: Math.min(1, f.age / warn),
          stamped: f.age >= warn,
          ...(f.angle !== undefined ? { angle: f.angle } : {}),
        };
      });
  }

  getState(): FootstepsState {
    return {
      rng: this.rng.getState(),
      nextId: this.nextId,
      feet: this.feet.map((f) => ({ ...f })),
    };
  }

  setState(s: FootstepsState): void {
    this.rng.setState(s.rng);
    this.nextId = s.nextId;
    this.feet = s.feet.map((f) => ({ ...f }));
  }
}
