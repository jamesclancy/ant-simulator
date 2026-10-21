import { Caste } from '@ant/shared';
import type { AntlionConfig, AntlionInfo, SimEvent } from '@ant/shared';
import { STARVED_HP } from '../ants/store';
import type { AntStore } from '../ants/store';
import { createRng } from '../rng';
import type { Rng } from '../rng';
import type { World } from '../world';

/** Plain-data pit state: everything needed to restore it (save/load). */
export interface AntlionData {
  id: number;
  x: number;
  y: number;
  alive: boolean;
  hp: number;
  maxHp: number;
}

export interface AntlionManagerState {
  nextId: number;
  rng: number;
  pits: AntlionData[];
}

export interface AntlionContext {
  ants: AntStore;
  world: World;
  playerIndex: number;
  /** Ant walking speed in world units per tick. */
  antStep: number;
  events: SimEvent[];
}

/**
 * Antlion pits. Surface ants inside a pit's slope radius slide towards its centre by
 * `pull` ant-steps per tick (an ant walking straight out just holds its ground); each tick
 * they may scramble out instead (more likely for soldiers, the player and in a crowd), and
 * at `killRadius` they are eaten (`hp = STARVED_HP`: the normal death path, so a player ant
 * is swapped out). If the ants in the pit add up to `mobSize` (worker 1, soldier
 * `soldierMobWeight`) the antlion is overwhelmed: nobody is eaten (they still slide
 * inwards, onto it) and everyone in the pit hurts it. At 0 hp it dies, drops food and leaves the pit as inert sand.
 */
export class AntlionManager {
  private pits: AntlionData[] = [];
  private nextId = 0;
  /** Escape rolls; its own stream so pits never perturb the ant stream. */
  private readonly rng: Rng;

  constructor(
    readonly config: AntlionConfig,
    private readonly worldSize: number,
    seed: number,
  ) {
    this.rng = createRng(seed ^ 0x3c6ef372);
  }

  get count(): number {
    return this.pits.length;
  }

  /** Dig a pit centred on (x, y). Returns its id. */
  add(x: number, y: number): number {
    const id = this.nextId++;
    this.pits.push({ id, x, y, alive: true, hp: this.config.hp, maxHp: this.config.hp });
    return id;
  }

  info(): AntlionInfo[] {
    return this.pits.map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      radius: this.config.radius,
      alive: p.alive,
      hp: p.hp,
      maxHp: p.maxHp,
    }));
  }

  getState(): AntlionManagerState {
    return {
      nextId: this.nextId,
      rng: this.rng.getState(),
      pits: this.pits.map((p) => ({ ...p })),
    };
  }

  setState(s: AntlionManagerState): void {
    this.nextId = s.nextId;
    this.rng.setState(s.rng);
    this.pits = s.pits.map((p) => ({ ...p }));
  }

  step(ctx: AntlionContext): void {
    for (const p of this.pits) if (p.alive) this.stepOne(p, ctx);
  }

  private stepOne(p: AntlionData, ctx: AntlionContext): void {
    const cfg = this.config;
    const { ants } = ctx;
    const { x, y, layer, hp, caste, heading } = ants;
    const r2 = cfg.radius * cfg.radius;
    const kill2 = cfg.killRadius * cfg.killRadius;
    const n = ants.count;
    let inside = 0;
    let mob = 0;
    let first = -1;
    // Pass 1: who is in the pit.
    for (let i = 0; i < n; i++) {
      if (layer[i] !== 0 || hp[i]! <= 0) continue;
      const dx = x[i]! - p.x;
      if (dx > cfg.radius || dx < -cfg.radius) continue;
      const dy = y[i]! - p.y;
      if (dx * dx + dy * dy > r2) continue;
      if (first < 0) first = i;
      inside++;
      mob += caste[i] === Caste.Soldier ? cfg.soldierMobWeight : 1;
    }
    if (inside === 0) return;

    const swarmed = mob >= cfg.mobSize;
    if (swarmed) {
      // Everyone in the pit bites (and keeps closing in on the antlion instead of being eaten).
      let damage = 0;
      for (let i = first; i < n; i++) {
        if (layer[i] !== 0 || hp[i]! <= 0) continue;
        const dx = x[i]! - p.x;
        const dy = y[i]! - p.y;
        if (dx * dx + dy * dy <= r2) damage += cfg.damage[caste[i]!]!;
      }
      p.hp -= damage;
      if (p.hp <= 0) {
        p.hp = 0;
        p.alive = false;
        ctx.world.food.add(p.x, p.y, cfg.foodDrop);
        ctx.events.push({ type: 'antlionKilled', x: p.x, y: p.y });
        return;
      }
    }

    // Pass 2: slide, scramble or get eaten.
    const pull = ctx.antStep * cfg.pull;
    const crowd = 1 + cfg.crowdEscape * (inside - 1);
    for (let i = first; i < n; i++) {
      if (layer[i] !== 0 || hp[i]! <= 0) continue;
      const dx = x[i]! - p.x;
      const dy = y[i]! - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      if (!swarmed && d2 <= kill2) {
        hp[i] = STARVED_HP;
        if (i === ctx.playerIndex) ctx.events.push({ type: 'playerEaten', cause: 'antlion' });
        continue;
      }
      let chance = swarmed ? 0 : cfg.escape * crowd;
      if (caste[i] === Caste.Soldier) chance *= cfg.soldierEscape;
      if (i === ctx.playerIndex) chance *= cfg.playerEscape;
      const d = Math.sqrt(d2);
      if (this.rng.next() < chance) {
        // Scrambles over the rim and keeps going outwards.
        const out = cfg.radius + 4;
        const a = d > 1e-6 ? Math.atan2(dy, dx) : this.rng.range(0, Math.PI * 2);
        x[i] = clamp(p.x + Math.cos(a) * out, 0, this.worldSize);
        y[i] = clamp(p.y + Math.sin(a) * out, 0, this.worldSize);
        heading[i] = a;
        continue;
      }
      const m = Math.min(pull, d);
      if (d < 1e-6) continue;
      x[i] = x[i]! - (dx / d) * m;
      y[i] = y[i]! - (dy / d) * m;
    }
  }
}

/**
 * Deterministic pit sites: `count` points on the surface away from the edges, clear of
 * every nest and of each other.
 */
export function placeAntlions(
  count: number,
  worldSize: number,
  seed: number,
  nests: readonly { x: number; y: number }[],
): { x: number; y: number }[] {
  const rng = createRng(seed ^ 0x2545f491);
  const out: { x: number; y: number }[] = [];
  for (let k = 0; k < Math.max(0, Math.floor(count)); k++) {
    let px = worldSize / 2;
    let py = worldSize / 2;
    for (let tries = 0; tries < 60; tries++) {
      px = rng.range(worldSize * 0.12, worldSize * 0.88);
      py = rng.range(worldSize * 0.12, worldSize * 0.88);
      const clearOfNests = nests.every((n) => Math.hypot(n.x - px, n.y - py) > worldSize * 0.18);
      const clearOfPits = out.every((o) => Math.hypot(o.x - px, o.y - py) > worldSize * 0.2);
      if (clearOfNests && clearOfPits) break;
    }
    out.push({ x: px, y: py });
  }
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
