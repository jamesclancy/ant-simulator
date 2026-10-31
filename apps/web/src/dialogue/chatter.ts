import {
  ANT_FLAGS_OFFSET,
  ANT_STRIDE,
  Caste,
  PLAYER_COLONY,
  flagCaste,
  flagColony,
  flagFighting,
} from '@ant/shared';
import type { Snapshot } from '@ant/shared';
import {
  EVENT_LINES,
  RECRUITED,
  RED_TALK,
  RIVAL_TALK,
  SMALL_TALK,
  SOLO,
  TO_PLAYER,
  type Exchange,
  type SoloKind,
} from './lines';

/** The ants one view draws (an `AntLayer`), seen through the camera. */
export interface ChatterSource {
  readonly count: number;
  /** Latest snapshot's ant data, `ANT_STRIDE` floats per ant. */
  readonly data: Float32Array;
  /** The player's ant, or -1. */
  readonly playerIndex: number;
  /** The view shows a nest (underground lines get mixed in). */
  readonly underground: boolean;
  /** Screen px per art pixel: below `MIN_PIXEL` the ants are too small to talk. */
  readonly pixelSize: number;
  /** Writes where ant `i` was drawn, in CSS px; false when it is hidden on this view. */
  screenAt(i: number, out: { x: number; y: number }): boolean;
}

/** A speech bubble to draw this frame (CSS px, anchored above the ant's head). */
export interface BubbleView {
  id: number;
  text: string;
  x: number;
  y: number;
  colony: number;
}

interface Line {
  id: number;
  /** Lines of one exchange share a thread; losing a speaker drops the rest of it. */
  thread: number;
  ant: number;
  text: string;
  start: number;
  end: number;
  /** Sim position last seen, to notice the index being reused by another ant. */
  wx: number;
  wy: number;
}

interface Cue {
  text: string;
  /** Prefer a speaker near this world point. */
  at?: { x: number; y: number } | undefined;
  /** Must be this ant (a fresh recruit). */
  ant?: number;
  expires: number;
}

/** Most exchanges/solo lines running at once. */
const MAX_THREADS = 3;
const MIN_PIXEL = 0.9;
/** Ambient chatter starts every `GAP_MIN..GAP_MIN+GAP_RAND` ms. */
const GAP_MIN = 1800;
const GAP_RAND = 3200;
/** Screen distance at which two ants count as chatting with each other. */
const PAIR_PX = 70;
const PLAYER_PX = 110;
/** A sim position jump bigger than this means the index now holds a different ant. */
const JUMP = 40;
/** Keep bubbles this far from the screen edges. */
const EDGE_X = 50;
const EDGE_TOP = 60;
const SCAN = 800;
const CANDIDATES = 48;
const CUE_TTL = 3000;
const RECENT = 10;

/** How long a line stays up: long enough to read. */
export const lineMs = (text: string): number => Math.min(4800, 1500 + text.length * 55);

/**
 * Decides which on-screen ants say what, and when: ambient small talk between neighbours,
 * solo grumbles by job, and shouts when the sim reports something (rain, the mower...).
 * Cosmetic only; runs on the main thread from snapshots and the camera.
 */
export class Chatter {
  private lines: Line[] = [];
  private cues: Cue[] = [];
  private source: ChatterSource | null = null;
  private nextAmbient = 0;
  private ids = 0;
  private recent: unknown[] = [];
  private recruits = 0;
  private readonly p = { x: 0, y: 0 };
  private readonly q = { x: 0, y: 0 };

  constructor(private readonly rand: () => number = Math.random) {}

  clear(): void {
    this.lines = [];
    this.cues = [];
    this.recruits = 0;
  }

  /** Queue reactions to the snapshot's events and to new recruits. */
  onSnapshot(snapshot: Snapshot, now: number): void {
    const expires = now + CUE_TTL;
    for (const ev of snapshot.events) {
      let at: { x: number; y: number } | undefined;
      if (ev.type === 'queenKilled') {
        if (ev.colony === PLAYER_COLONY) continue;
      } else if (ev.type === 'footstep') {
        if (ev.kills === 0 && this.rand() < 0.5) continue;
        at = { x: ev.x, y: ev.y };
      } else if (ev.type === 'spiderKilled' || ev.type === 'antlionKilled') {
        at = { x: ev.x, y: ev.y };
      }
      const pool = EVENT_LINES[ev.type];
      if (pool) this.cues.push({ text: this.pick(pool), at, expires });
    }
    const recruited = snapshot.player?.recruitedIndices;
    const n = recruited?.length ?? 0;
    if (recruited && n > this.recruits) {
      // One or two of the new recruits answer the call.
      const fresh = Array.from(recruited.subarray(this.recruits));
      for (let k = 0; k < Math.min(2, fresh.length); k++) {
        const ant = fresh[Math.floor(this.rand() * fresh.length)]!;
        this.cues.push({ text: this.pick(RECRUITED), ant, expires });
      }
    }
    this.recruits = n;
    if (this.cues.length > 4) this.cues.splice(0, this.cues.length - 4);
  }

  /**
   * Advance to `now` and return the bubbles to draw. `source` null (chatter off, menu, other
   * view) drops everything; `allowNew` false lets current lines finish without starting more.
   */
  tick(
    now: number,
    source: ChatterSource | null,
    view: { w: number; h: number },
    allowNew: boolean,
  ): BubbleView[] {
    if (source !== this.source) {
      this.source = source;
      this.lines = [];
    }
    if (!source || source.pixelSize < MIN_PIXEL) {
      this.lines = [];
      this.cues = this.cues.filter((c) => c.expires > now);
      return [];
    }
    this.prune(now, source, view);
    this.cues = this.cues.filter((c) => c.expires > now);
    if (allowNew) {
      while (this.cues.length && this.threads() < MAX_THREADS) {
        const cue = this.cues.shift()!;
        this.speakCue(cue, now, source, view);
      }
      if (now >= this.nextAmbient) {
        this.nextAmbient = now + GAP_MIN + this.rand() * GAP_RAND;
        if (this.threads() < MAX_THREADS) this.startAmbient(now, source, view);
      }
    }
    const out: BubbleView[] = [];
    for (const l of this.lines) {
      if (l.start > now || !source.screenAt(l.ant, this.p)) continue;
      const flags = source.data[l.ant * ANT_STRIDE + ANT_FLAGS_OFFSET]!;
      out.push({ id: l.id, text: l.text, x: this.p.x, y: this.p.y, colony: flagColony(flags) });
    }
    return out;
  }

  private threads(): number {
    return new Set(this.lines.map((l) => l.thread)).size;
  }

  /** Drop finished lines and threads whose speaker left the view or was replaced. */
  private prune(now: number, source: ChatterSource, view: { w: number; h: number }): void {
    const dead = new Set<number>();
    for (const l of this.lines) {
      if (l.end <= now) continue;
      if (l.start > now) continue;
      const o = l.ant * ANT_STRIDE;
      const wx = source.data[o]!;
      const wy = source.data[o + 1]!;
      const ok =
        l.ant < source.count &&
        Math.abs(wx - l.wx) + Math.abs(wy - l.wy) < JUMP &&
        source.screenAt(l.ant, this.p) &&
        this.p.x > -20 &&
        this.p.x < view.w + 20 &&
        this.p.y > -20 &&
        this.p.y < view.h + 20;
      if (!ok) dead.add(l.thread);
      l.wx = wx;
      l.wy = wy;
    }
    this.lines = this.lines.filter((l) => l.end > now && !dead.has(l.thread));
  }

  /** Visible, on-screen, not-already-talking ants, sampled from a random starting index. */
  private candidates(source: ChatterSource, view: { w: number; h: number }): number[] {
    const n = source.count;
    if (n === 0) return [];
    const busy = new Set(this.lines.map((l) => l.ant));
    const found: number[] = [];
    const start = Math.floor(this.rand() * n);
    const scan = Math.min(n, SCAN);
    for (let k = 0; k < scan && found.length < CANDIDATES; k++) {
      const i = (start + k) % n;
      if (i === source.playerIndex || busy.has(i)) continue;
      if (!source.screenAt(i, this.p)) continue;
      if (this.p.x < EDGE_X || this.p.x > view.w - EDGE_X) continue;
      if (this.p.y < EDGE_TOP || this.p.y > view.h - 10) continue;
      found.push(i);
    }
    return found;
  }

  private startAmbient(now: number, source: ChatterSource, view: { w: number; h: number }): void {
    const cands = this.candidates(source, view);
    if (!cands.length) return;
    const a = cands[Math.floor(this.rand() * cands.length)]!;
    source.screenAt(a, this.p);
    const colA = flagColony(source.data[a * ANT_STRIDE + ANT_FLAGS_OFFSET]!);
    // Nearest neighbour on screen: a pair makes a conversation.
    let b = -1;
    let best = PAIR_PX;
    for (const i of cands) {
      if (i === a || !source.screenAt(i, this.q)) continue;
      const d = Math.hypot(this.q.x - this.p.x, this.q.y - this.p.y);
      if (d < best) {
        best = d;
        b = i;
      }
    }
    if (b >= 0 && this.rand() < 0.75) {
      const colB = flagColony(source.data[b * ANT_STRIDE + ANT_FLAGS_OFFSET]!);
      if ((colA === PLAYER_COLONY) !== (colB === PLAYER_COLONY)) {
        // Rival lines are written black-first.
        const [black, red] = colA === PLAYER_COLONY ? [a, b] : [b, a];
        return this.say(now, source, [black, red], this.pick(RIVAL_TALK));
      }
      const pool = colA === PLAYER_COLONY ? SMALL_TALK : RED_TALK;
      return this.say(now, source, [a, b], this.pick(pool));
    }
    const pi = source.playerIndex;
    if (
      colA === PLAYER_COLONY &&
      pi >= 0 &&
      source.screenAt(pi, this.q) &&
      Math.hypot(this.q.x - this.p.x, this.q.y - this.p.y) < PLAYER_PX
    ) {
      return this.say(now, source, [a], [this.pick(TO_PLAYER)]);
    }
    this.say(now, source, [a], [this.pick(SOLO[this.soloKind(source, a)])]);
  }

  private soloKind(source: ChatterSource, i: number): SoloKind {
    const o = i * ANT_STRIDE;
    const flags = source.data[o + ANT_FLAGS_OFFSET]!;
    const carrying = source.data[o + 3]!;
    const caste = flagCaste(flags);
    if (flagFighting(flags)) return 'fight';
    if (carrying > 0) return 'food';
    if (carrying < 0) return 'dirt';
    const r = this.rand();
    if (caste === Caste.Soldier && r < 0.6) return 'soldier';
    if (caste === Caste.Breeder && r < 0.6) return 'breeder';
    if (flagColony(flags) !== PLAYER_COLONY && r < 0.5) return 'red';
    if (source.underground && r < 0.6) return 'nest';
    return 'wander';
  }

  private speakCue(
    cue: Cue,
    now: number,
    source: ChatterSource,
    view: { w: number; h: number },
  ): void {
    if (cue.ant !== undefined) {
      const i = cue.ant;
      if (i >= source.count || this.lines.some((l) => l.ant === i)) return;
      if (!source.screenAt(i, this.p)) return;
      return this.say(now, source, [i], [cue.text]);
    }
    // The player's colony does the shouting when it can.
    const cands = this.candidates(source, view);
    const ours = cands.filter(
      (i) => flagColony(source.data[i * ANT_STRIDE + ANT_FLAGS_OFFSET]!) === PLAYER_COLONY,
    );
    const pool = ours.length ? ours : cands;
    if (!pool.length) return;
    let speaker = pool[Math.floor(this.rand() * pool.length)]!;
    if (cue.at) {
      let best = Infinity;
      for (const i of pool) {
        const o = i * ANT_STRIDE;
        const d = Math.hypot(source.data[o]! - cue.at.x, source.data[o + 1]! - cue.at.y);
        if (d < best) {
          best = d;
          speaker = i;
        }
      }
    }
    this.say(now, source, [speaker], [cue.text]);
  }

  /** Schedule `exchange`, speakers taking turns; each reply comes in as the last line fades. */
  private say(now: number, source: ChatterSource, ants: number[], exchange: Exchange): void {
    const thread = ++this.ids;
    let t = now;
    exchange.forEach((text, k) => {
      const ant = ants[k % ants.length]!;
      const o = ant * ANT_STRIDE;
      const dur = lineMs(text);
      this.lines.push({
        id: ++this.ids,
        thread,
        ant,
        text,
        start: t,
        end: t + dur,
        wx: source.data[o]!,
        wy: source.data[o + 1]!,
      });
      t += dur * 0.8;
    });
  }

  /** Random pick that avoids repeating anything said recently. */
  private pick<T>(pool: readonly T[]): T {
    let choice = pool[0]!;
    for (let tries = 0; tries < 5; tries++) {
      choice = pool[Math.floor(this.rand() * pool.length)]!;
      if (!this.recent.includes(choice)) break;
    }
    this.recent.push(choice);
    if (this.recent.length > RECENT) this.recent.shift();
    return choice;
  }
}
