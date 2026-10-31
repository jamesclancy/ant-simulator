import { Particle, ParticleContainer } from 'pixi.js';
import type { Container, Texture } from 'pixi.js';
import {
  ANT_FLAGS_OFFSET,
  ANT_LAYER_OFFSET,
  ANT_STRIDE,
  TICK_MS,
  flagCaste,
  flagColony,
  flagFighting,
} from '@ant/shared';
import type { Snapshot } from '@ant/shared';
import type { Art } from './art';
import type { ChatterSource } from './dialogue/chatter';
import { STATE_INDEX } from './art/sprites/ants';
import type { AntSet } from './art/sprites/ants';
import { SURFACE_PX } from './art/sprites/world';

export interface AntLayerOptions {
  /** Which layer's ants to show: 0 surface (default), `1 + c` inside colony c's nest. */
  layer?: number;
  /** World units per art pixel. */
  scale?: number;
  /** Which sprite set to use: surface ants have dark rims, nest ants light ones. */
  set?: AntSet;
}

/** Headings are snapped to this many directions so rotated pixel art stays crisp. */
const HEADINGS = 16;
const HEADING_STEP = (Math.PI * 2) / HEADINGS;
/** Walk cycle length per frame, ms. */
const FRAME_MS = 110;
const RECRUIT_TINT = 0xffe08a;

/**
 * Batched ant renderer for one layer (ants of other layers are hidden). Holds the previous
 * and latest snapshot and interpolates between them using wall-clock time since the latest snapshot arrived.
 * Each ant is one particle whose texture is swapped between walk, carry and fight frames.
 */
export class AntLayer implements ChatterSource {
  readonly view: ParticleContainer;
  private frames: Texture[][][][];
  private clock = 0;
  private animate = true;
  private prev: Float32Array = new Float32Array(0);
  private curr: Float32Array = new Float32Array(0);
  private currCount = 0;
  private prevCount = 0;
  private arrived = performance.now();
  private tickMs = TICK_MS;
  private shown = 0;
  private playerIdx = -1;
  private recruitFlags = new Uint8Array(0);
  private recruitIdx: Uint32Array = new Uint32Array(0);
  /** Interpolated position of the player ant after the latest `update()`, if any. */
  readonly playerPos = { x: 0, y: 0, valid: false };

  /** Draw every Nth ant (bigger, so the swarm keeps its look): cheap LOD at low zoom. */
  private stride = 1;
  private layer: number;
  private scale: number;

  constructor(art: Art, parent: Container, opts: AntLayerOptions = {}) {
    this.layer = opts.layer ?? 0;
    this.scale = opts.scale ?? SURFACE_PX;
    this.frames = art.ants.frames[opts.set ?? 'surf'];
    this.view = new ParticleContainer({
      // vertex: sprite size differs per caste/frame; uvs: walk/carry/fight frames are texture swaps.
      dynamicProperties: { position: true, rotation: true, vertex: true, uvs: true, color: true },
    });
    parent.addChild(this.view);
  }

  /** Drive the walk cycle from the frame clock; off (reduce motion) shows the standing pose. */
  setAnimation(now: number, animate: boolean): void {
    this.clock = now;
    this.animate = animate;
  }

  get count(): number {
    return this.currCount;
  }

  get data(): Float32Array {
    return this.curr;
  }

  get playerIndex(): number {
    return this.playerIdx;
  }

  get underground(): boolean {
    return this.layer !== 0;
  }

  get pixelSize(): number {
    return this.view.worldTransform.a * this.scale;
  }

  /** Where ant `i` was drawn by the last `update()`, in canvas CSS px. */
  screenAt(i: number, out: { x: number; y: number }): boolean {
    let x: number;
    let y: number;
    if (i === this.playerIdx && this.playerPos.valid) {
      ({ x, y } = this.playerPos);
    } else {
      const p = this.view.particleChildren[i] as Particle | undefined;
      if (!p || p.alpha === 0 || i >= this.currCount) return false;
      ({ x, y } = p);
    }
    const t = this.view.worldTransform;
    out.x = t.a * x + t.c * y + t.tx;
    out.y = t.b * x + t.d * y + t.ty;
    return true;
  }

  setStride(stride: number): void {
    this.stride = Math.max(1, Math.floor(stride));
  }

  push(snapshot: Snapshot, speed: number): void {
    this.prev = this.curr;
    this.prevCount = this.currCount;
    this.curr = snapshot.ants;
    this.currCount = snapshot.antCount;
    this.arrived = performance.now();
    this.trackPlayer(snapshot);
    this.tickMs = speed > 0 ? TICK_MS / speed : Infinity;
  }

  /** Remember which ants are the player and its recruits, for styling in `update()`. */
  private trackPlayer(snapshot: Snapshot): void {
    for (const i of this.recruitIdx) this.recruitFlags[i] = 0;
    const p = snapshot.player;
    this.playerIdx = p ? p.index : -1;
    this.recruitIdx = p ? p.recruitedIndices : new Uint32Array(0);
    if (this.recruitFlags.length < snapshot.antCount) {
      this.recruitFlags = new Uint8Array(Math.ceil(snapshot.antCount * 1.5));
    }
    for (const i of this.recruitIdx) if (i < this.recruitFlags.length) this.recruitFlags[i] = 1;
  }

  update(): void {
    const n = this.currCount;
    while (this.shown < n) {
      this.view.addParticle(
        new Particle({
          texture: this.frames[0]![0]![0]![0]!,
          anchorX: 0.5,
          anchorY: 0.5,
          scaleX: this.scale,
          scaleY: this.scale,
        }),
      );
      this.shown++;
    }
    while (this.shown > n) {
      const p = this.view.particleChildren[this.shown - 1];
      if (p) this.view.removeParticle(p);
      this.shown--;
    }
    const alpha =
      this.tickMs === Infinity || this.prevCount !== this.currCount
        ? 1
        : Math.min(1, (performance.now() - this.arrived) / this.tickMs);
    const { prev, curr } = this;
    const list = this.view.particleChildren as Particle[];
    const stride = this.stride;
    // Thinned-out ants are drawn bigger, and the player and its recruits are never dropped.
    const lodScale = stride > 1 ? Math.sqrt(stride) : 1;
    for (let i = 0; i < n; i++) {
      const o = i * ANT_STRIDE;
      const p = list[i]!;
      if (stride > 1 && i % stride !== 0 && i !== this.playerIdx && !this.recruitFlags[i]) {
        p.alpha = 0;
        continue;
      }
      const cx = curr[o]!;
      const cy = curr[o + 1]!;
      const layer = curr[o + ANT_LAYER_OFFSET]!;
      if (layer !== this.layer) {
        p.alpha = 0;
        continue;
      }
      p.alpha = 1;
      // No interpolation across a layer change (positions live in different spaces).
      let x = cx;
      let y = cy;
      let moving = false;
      if (prev[o + ANT_LAYER_OFFSET] === layer && i < this.prevCount) {
        moving = Math.abs(cx - prev[o]!) + Math.abs(cy - prev[o + 1]!) > 0.05;
        if (alpha < 1) {
          x = prev[o]! + (cx - prev[o]!) * alpha;
          y = prev[o + 1]! + (cy - prev[o + 1]!) * alpha;
        }
      }
      p.x = Math.round(x);
      p.y = Math.round(y);
      p.rotation = Math.round(curr[o + 2]! / HEADING_STEP) * HEADING_STEP;
      const flags = curr[o + ANT_FLAGS_OFFSET]!;
      const colony = flagColony(flags);
      const s = this.scale * lodScale;
      p.scaleX = s;
      p.scaleY = s;
      const c = curr[o + 3]!;
      const fighting = flagFighting(flags);
      const state = fighting
        ? STATE_INDEX.fight
        : c > 0
          ? STATE_INDEX.food
          : c < 0
            ? STATE_INDEX.dirt
            : STATE_INDEX.walk;
      const set = this.frames[colony > 1 ? 1 : colony]![flagCaste(flags)]![state]!;
      let f = 0;
      if (this.animate) {
        if (fighting) f = ((this.clock / 140 + i) | 0) % 2;
        else if (moving) f = ((this.clock / FRAME_MS + i * 0.37) | 0) % set.length;
      }
      p.texture = set[f]!;
      p.tint = this.recruitFlags[i] ? RECRUIT_TINT : 0xffffff;
    }
    this.playerPos.valid = false;
    const pi = this.playerIdx;
    if (this.layer === 0 && pi >= 0 && pi < n) {
      const p = list[pi]!;
      // The player is drawn by PlayerMarker (bigger, yellow); hide its particle.
      p.alpha = 0;
      this.playerPos.x = p.x;
      this.playerPos.y = p.y;
      this.playerPos.valid = true;
    }
  }
}
