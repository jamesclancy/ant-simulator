import { Graphics, Particle, ParticleContainer } from 'pixi.js';
import type { Renderer, Container, Texture } from 'pixi.js';
import {
  ANT_FLAGS_OFFSET,
  ANT_LAYER_OFFSET,
  ANT_STRIDE,
  Caste,
  TICK_MS,
  flagCaste,
  flagColony,
  flagFighting,
} from '@ant/shared';
import type { Snapshot } from '@ant/shared';

export interface AntLayerOptions {
  /** Which layer's ants to show: 0 surface (default), `1 + c` inside colony c's nest. */
  layer?: number;
  /** Ant sprite scale. */
  scale?: number;
  /** Tint per colony (index = colony id) for ants carrying nothing. */
  tints?: readonly number[];
  /** Tint per colony while fighting. */
  fightTints?: readonly number[];
}

const FOOD_TINT = 0xffc21a;
const DIRT_TINT = 0x9c6b3a;
/** Black colony (player's) and red colony on the surface. */
export const SURFACE_TINTS = [0x151515, 0xc8321e] as const;
export const SURFACE_FIGHT_TINTS = [0x5a3a3a, 0xff8040] as const;
/** Soldiers are drawn this much bigger than workers. */
const SOLDIER_SCALE = 1.35;

/**
 * Batched ant renderer for one layer (ants of other layers are hidden). Holds the previous
 * and latest snapshot and interpolates between them using wall-clock time since the latest snapshot arrived.
 */
export class AntLayer {
  readonly view: ParticleContainer;
  private texture: Texture;
  private prev: Float32Array = new Float32Array(0);
  private curr: Float32Array = new Float32Array(0);
  private currCount = 0;
  private prevCount = 0;
  private arrived = performance.now();
  private tickMs = TICK_MS;
  private shown = 0;
  private playerIndex = -1;
  private recruitFlags = new Uint8Array(0);
  private recruitIdx: Uint32Array = new Uint32Array(0);
  /** Interpolated position of the player ant after the latest `update()`, if any. */
  readonly playerPos = { x: 0, y: 0, valid: false };

  private layer: number;
  private scale: number;
  private tints: readonly number[];
  private fightTints: readonly number[];

  constructor(renderer: Renderer, parent: Container, opts: AntLayerOptions = {}) {
    this.layer = opts.layer ?? 0;
    this.scale = opts.scale ?? 1.5;
    this.tints = opts.tints ?? SURFACE_TINTS;
    this.fightTints = opts.fightTints ?? SURFACE_FIGHT_TINTS;
    const g = new Graphics();
    // Ant glyph pointing +x: three body segments and head.
    g.ellipse(-5, 0, 3.5, 2.5).fill(0xffffff);
    g.ellipse(0, 0, 2.5, 2).fill(0xdddddd);
    g.ellipse(4.5, 0, 2.5, 2.2).fill(0xffffff);
    this.texture = renderer.generateTexture({ target: g, resolution: 4 });
    this.view = new ParticleContainer({
      // vertex: per-ant scale (soldiers are bigger) changes as slots are reused.
      dynamicProperties: { position: true, rotation: true, vertex: true, color: true },
    });
    parent.addChild(this.view);
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
    this.playerIndex = p ? p.index : -1;
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
          texture: this.texture,
          anchorX: 0.5,
          anchorY: 0.5,
          scaleX: this.scale,
          scaleY: this.scale,
          tint: this.tints[0]!,
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
    for (let i = 0; i < n; i++) {
      const o = i * ANT_STRIDE;
      const p = list[i]!;
      const cx = curr[o]!;
      const cy = curr[o + 1]!;
      const layer = curr[o + ANT_LAYER_OFFSET]!;
      if (layer !== this.layer) {
        p.alpha = 0;
        continue;
      }
      p.alpha = 1;
      // No interpolation across a layer change (positions live in different spaces).
      if (alpha >= 1 || prev[o + ANT_LAYER_OFFSET] !== layer) {
        p.x = cx;
        p.y = cy;
      } else {
        p.x = prev[o]! + (cx - prev[o]!) * alpha;
        p.y = prev[o + 1]! + (cy - prev[o + 1]!) * alpha;
      }
      p.rotation = curr[o + 2]!;
      const flags = curr[o + ANT_FLAGS_OFFSET]!;
      const colony = flagColony(flags);
      const s = flagCaste(flags) === Caste.Soldier ? this.scale * SOLDIER_SCALE : this.scale;
      p.scaleX = s;
      p.scaleY = s;
      // Fighters flash; food carriers are gold, dirt carriers brown, recruits dark gold.
      const c = curr[o + 3]!;
      if (flagFighting(flags)) p.tint = this.fightTints[colony] ?? 0xffffff;
      else p.tint = c > 0 ? FOOD_TINT : c < 0 ? DIRT_TINT : (this.tints[colony] ?? 0xffffff);
      if (this.recruitFlags[i]) p.tint = 0x8a6a10;
    }
    this.playerPos.valid = false;
    const pi = this.playerIndex;
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
