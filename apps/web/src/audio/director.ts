import {
  ANT_FLAGS_OFFSET,
  ANT_LAYER_OFFSET,
  ANT_STRIDE,
  PLAYER_COLONY,
  SpiderState,
  flagFighting,
} from '@ant/shared';
import type { SimEvent, Snapshot } from '@ant/shared';
import type { AudioBackend, PlayOptions, SfxId, TrackId } from './types';

/** The slice of a snapshot the director reads (lets tests build small fixtures). */
export type AudioSnapshot = Pick<
  Snapshot,
  'tick' | 'antCount' | 'ants' | 'player' | 'events' | 'colonies' | 'spiders' | 'weather' | 'winner'
>;

export interface DirectorContext {
  mode: 'menu' | 'playing';
  /** 0 surface, 1 nest view. */
  layer: 0 | 1;
  /** True while the pause/menu overlay is up. */
  paused: boolean;
  zoom: number;
  /** World point at the centre of the screen and half the visible width in world units. */
  view: { x: number; y: number; halfWidth: number };
}

/** How one sim event sounds. Spatial events use the event's `x`/`y` when it has them. */
export interface EventCue {
  sfx: SfxId | ((ev: SimEvent & Record<string, unknown>, ctx: DirectorContext) => SfxId | null);
  gain?: number;
  /** Minimum real milliseconds between plays of this event type. */
  minIntervalMs?: number;
}

export interface DirectorOptions {
  now?: () => number;
  random?: () => number;
}

/** Caps on how often each derived cue may fire, regardless of how many ants are involved. */
const LIMITS_MS: Partial<Record<SfxId, number>> = {
  fight: 140,
  death: 120,
  dig: 220,
  spiderHiss: 1500,
  pickup: 80,
  drop: 80,
  deposit: 80,
  recruit: 200,
  trailOn: 150,
  trailOff: 150,
};
/** Token bucket for all world sounds together: burst of 10, 24 per second sustained. */
const BUDGET_BURST = 10;
const BUDGET_PER_SEC = 24;

/**
 * Event registry: sim event `type` -> sound. Campaign events (matingFlight, patchEntered, ...) are
 * mapped by adding an entry here or calling `AudioDirector.mapEvent` once those events exist.
 */
export const EVENT_CUES: Record<string, EventCue> = {
  playerSwapped: { sfx: 'swap' },
  playerEaten: {
    sfx: (ev) =>
      ev.cause === 'antlion' ? 'antlion' : ev.cause === 'drowned' ? 'hurt' : 'spiderHiss',
    gain: 1,
  },
  spiderKilled: { sfx: 'spiderDeath' },
  antlionKilled: { sfx: 'spiderDeath', gain: 0.8 },
  rainWarning: { sfx: 'rumble', minIntervalMs: 8000 },
  rainStarted: { sfx: 'thunder' },
  queenKilled: { sfx: (ev) => (ev.colony === PLAYER_COLONY ? 'queenLost' : 'queenKilled') },
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Turns snapshots into sounds. Most cues are *derived* from snapshot deltas (carrying, recruits,
 * fighting counts, losses, spider state) so the sim stays unchanged; discrete sim events go through
 * `EVENT_CUES`. Everything is rate-limited, so thousands of ants cost a handful of voices.
 */
export class AudioDirector {
  private now: () => number;
  private random: () => number;
  private cues = new Map<string, EventCue>(Object.entries(EVENT_CUES));
  private lastPlayed = new Map<string, number>();
  private budget = BUDGET_BURST;
  private budgetAt = 0;

  private lastTick = -1;
  private seen = false;
  private carrying = 0;
  private recruits = 0;
  private trail = false;
  private openTiles = 0;
  private losses = 0;
  private spiderStates = new Map<number, number>();
  private fightAt: { x: number; y: number } | null = null;
  private intensity = 0;
  private sentIntensity = -1;
  private sentTrack: TrackId | null | undefined;
  private over = false;
  private nextThunder = Infinity;

  constructor(
    private backend: AudioBackend,
    options: DirectorOptions = {},
  ) {
    this.now = options.now ?? (() => performance.now());
    this.random = options.random ?? Math.random;
  }

  /** Map (or override) the sound for a sim event type. */
  mapEvent(type: string, cue: EventCue): void {
    this.cues.set(type, cue);
  }

  /** A button/control was pressed. */
  uiClick(): void {
    this.backend.play('click', { rate: 0.95 + this.random() * 0.1 });
  }

  /** Forget per-game state (new game, load). The next snapshot is a silent baseline. */
  reset(): void {
    this.seen = false;
    this.lastTick = -1;
    this.over = false;
    this.intensity = 0;
    this.spiderStates.clear();
    this.fightAt = null;
    this.nextThunder = Infinity;
  }

  onSnapshot(s: AudioSnapshot, ctx: DirectorContext): void {
    if (s.tick < this.lastTick) this.reset();
    this.lastTick = s.tick;
    if (ctx.mode === 'menu') {
      this.seen = false;
      this.over = false;
      this.music('menu', 0);
      this.backend.setLoop('rain', 0);
      this.backend.setLoop('skitter', 0);
      return;
    }
    const first = !this.seen;
    this.seen = true;
    const live = !ctx.paused && !first;
    const black = s.colonies[PLAYER_COLONY];

    if (!first) this.derive(s, ctx, live);
    this.rememberBaseline(s);

    if (live) for (const ev of s.events) this.onEvent(ev, ctx);
    if (s.winner !== -1 && !this.over && !first) {
      this.over = true;
      this.backend.play(s.winner === PLAYER_COLONY ? 'victory' : 'defeat');
    }

    // Beds.
    const surface = ctx.layer === 0;
    const rain = s.weather.raining ? s.weather.intensity : 0;
    this.backend.setLoop('rain', ctx.paused ? 0 : rain * (surface ? 1 : 0.35));
    const crowd = Math.sqrt(Math.min(1, s.antCount / 1500));
    const near = clamp(ctx.zoom / 1.2, 0.25, 1);
    this.backend.setLoop(
      'skitter',
      ctx.paused || this.over ? 0 : surface ? crowd * near * 0.8 : crowd * 0.12,
    );
    this.thunder(s, ctx);

    // Music: fight intensity rises quickly and falls slowly.
    const fighting = s.colonies.reduce((a, c) => a + c.fighting, 0);
    let target = clamp(Math.log10(1 + fighting) / 2.2, 0, 1);
    if ((black?.intruders ?? 0) > 0) target = Math.max(target, 0.7);
    if (s.colonies.some((c) => c.raid)) target = Math.max(target, 0.5);
    if (s.spiders.some((sp) => sp.state === SpiderState.Hunt && sp.hp > 0))
      target = Math.max(target, 0.6);
    this.intensity += (target - this.intensity) * (target > this.intensity ? 0.3 : 0.02);
    if (ctx.paused || this.over) this.intensity = 0;
    this.music(this.over ? null : 'game', this.intensity);
  }

  /**
   * Called a few times a second even when no snapshots arrive (the sim is paused): silences the
   * beds and drops the fight layer while a menu is open.
   */
  idle(ctx: DirectorContext): void {
    if (ctx.mode !== 'playing' || !ctx.paused) return;
    this.intensity = 0;
    this.backend.setLoop('rain', 0);
    this.backend.setLoop('skitter', 0);
    if (this.sentTrack === 'game') this.music('game', 0);
  }

  private music(track: TrackId | null, intensity: number): void {
    const i = Math.round(intensity * 50) / 50;
    if (track === this.sentTrack && i === this.sentIntensity) return;
    this.sentTrack = track;
    this.sentIntensity = i;
    this.backend.setMusic(track, i);
  }

  private rememberBaseline(s: AudioSnapshot): void {
    const black = s.colonies[PLAYER_COLONY];
    this.carrying = s.player?.carrying ?? 0;
    this.recruits = s.player?.recruits ?? 0;
    this.trail = s.player?.trail ?? false;
    this.openTiles = black?.openTiles ?? 0;
    this.losses = s.colonies.reduce((a, c) => a + c.losses, 0);
    this.spiderStates.clear();
    for (const sp of s.spiders)
      this.spiderStates.set(sp.id, sp.hp > 0 ? sp.state : SpiderState.Dead);
  }

  /** Cues derived from the difference between this snapshot and the last. */
  private derive(s: AudioSnapshot, ctx: DirectorContext, live: boolean): void {
    if (!live) return;
    const pl = s.player;
    const black = s.colonies[PLAYER_COLONY];
    if (pl) {
      const at = { x: pl.x, y: pl.y };
      if (pl.carrying > 0 && this.carrying === 0) this.play('pickup', ctx, at);
      else if (pl.carrying === 0 && this.carrying > 0) {
        const home =
          black && Math.hypot(pl.x - black.nest.x, pl.y - black.nest.y) < black.nest.radius * 1.5;
        this.play(home ? 'deposit' : 'drop', ctx, at);
      }
      if (pl.recruits > this.recruits) this.play('recruit', ctx, at);
      if (pl.trail !== this.trail) this.play(pl.trail ? 'trailOn' : 'trailOff', ctx, at);
    }
    if (black && black.openTiles > this.openTiles && ctx.layer === 1) {
      this.play('dig', ctx, undefined, { rate: 0.85 + this.random() * 0.3, gain: 0.7 });
    }

    // Fighting: one rate-limited click whose loudness grows with the log of the fighter count.
    const fighting = s.colonies.reduce((a, c) => a + c.fighting, 0);
    if (fighting > 0) {
      const spot = this.fightCentre(s);
      if (spot) this.fightAt = spot;
      this.play('fight', ctx, this.fightAt ?? undefined, {
        gain: 0.3 + 0.7 * clamp(Math.log10(1 + fighting) / 2.5, 0, 1),
        rate: 0.8 + this.random() * 0.5,
      });
    }
    const losses = s.colonies.reduce((a, c) => a + c.losses, 0);
    if (losses > this.losses) {
      this.play('death', ctx, this.fightAt ?? undefined, {
        gain: clamp(0.35 + (losses - this.losses) * 0.1, 0, 1),
        rate: 0.8 + this.random() * 0.4,
      });
    }

    for (const sp of s.spiders) {
      const prev = this.spiderStates.get(sp.id);
      if (
        sp.hp > 0 &&
        sp.state === SpiderState.Hunt &&
        prev !== undefined &&
        prev !== SpiderState.Hunt
      ) {
        this.play('spiderHiss', ctx, { x: sp.x, y: sp.y }, { key: `hiss${sp.id}`, minMs: 5000 });
      }
    }
  }

  /** Average position of up to ~512 sampled fighting surface ants (cheap even with 10k ants). */
  private fightCentre(s: AudioSnapshot): { x: number; y: number } | null {
    const n = s.antCount;
    const stride = Math.max(1, Math.floor(n / 512));
    let sx = 0;
    let sy = 0;
    let count = 0;
    for (let i = 0; i < n; i += stride) {
      const o = i * ANT_STRIDE;
      if (s.ants[o + ANT_LAYER_OFFSET] !== 0 || !flagFighting(s.ants[o + ANT_FLAGS_OFFSET]!))
        continue;
      sx += s.ants[o]!;
      sy += s.ants[o + 1]!;
      count++;
    }
    return count ? { x: sx / count, y: sy / count } : null;
  }

  private onEvent(ev: SimEvent, ctx: DirectorContext): void {
    const cue = this.cues.get(ev.type);
    if (!cue) return;
    const rec = ev as SimEvent & Record<string, unknown>;
    const id = typeof cue.sfx === 'function' ? cue.sfx(rec, ctx) : cue.sfx;
    if (!id) return;
    const x = typeof rec.x === 'number' ? rec.x : undefined;
    const y = typeof rec.y === 'number' ? rec.y : undefined;
    this.play(id, ctx, x !== undefined && y !== undefined ? { x, y } : undefined, {
      key: `ev:${ev.type}`,
      minMs: cue.minIntervalMs ?? 0,
      ...(cue.gain !== undefined ? { gain: cue.gain } : {}),
    });
  }

  private thunder(s: AudioSnapshot, ctx: DirectorContext): void {
    const t = this.now();
    if (!s.weather.raining) {
      this.nextThunder = Infinity;
      return;
    }
    if (this.nextThunder === Infinity) this.nextThunder = t + 6000 + this.random() * 10000;
    if (t >= this.nextThunder && !ctx.paused) {
      this.nextThunder = t + 9000 + this.random() * 16000;
      this.backend.play('thunder', {
        gain: (ctx.layer === 0 ? 0.8 : 0.35) * (0.6 + this.random() * 0.4),
        rate: 0.85 + this.random() * 0.3,
      });
    }
  }

  /**
   * Play a world sound: per-cue (and optional per-key) rate limit, global budget, then spatialize.
   * Sounds from the surface are quieter and un-panned while the nest view is showing.
   */
  private play(
    id: SfxId,
    ctx: DirectorContext,
    at?: { x: number; y: number },
    extra: { gain?: number; rate?: number; key?: string; minMs?: number } = {},
  ): void {
    const t = this.now();
    const key = extra.key ?? id;
    const minMs = extra.minMs ?? LIMITS_MS[id] ?? 0;
    const last = this.lastPlayed.get(key);
    if (last !== undefined && t - last < minMs) return;
    this.budget = Math.min(
      BUDGET_BURST,
      this.budget + ((t - this.budgetAt) / 1000) * BUDGET_PER_SEC,
    );
    this.budgetAt = t;
    if (this.budget < 1) return;

    const opts: PlayOptions = { gain: extra.gain ?? 1 };
    if (extra.rate !== undefined) opts.rate = extra.rate;
    const nestSound = id === 'dig';
    if (ctx.layer === 1 && !nestSound) {
      opts.gain = (opts.gain ?? 1) * 0.35;
    } else if (at && ctx.layer === 0) {
      const dx = at.x - ctx.view.x;
      const dy = at.y - ctx.view.y;
      const half = Math.max(1, ctx.view.halfWidth);
      opts.pan = clamp(dx / half, -1, 1) * 0.8;
      opts.gain = (opts.gain ?? 1) * clamp(1 - Math.hypot(dx, dy) / (half * 3), 0.12, 1);
      if ((opts.gain ?? 0) < 0.14) return;
    }
    this.budget -= 1;
    this.lastPlayed.set(key, t);
    this.backend.play(id, opts);
  }
}
