import { Graphics, Particle, ParticleContainer } from 'pixi.js';
import type { Renderer, Container, Texture } from 'pixi.js';
import { ANT_STRIDE, TICK_MS } from '@ant/shared';
import type { Snapshot } from '@ant/shared';

/**
 * Batched ant renderer. Holds the previous and latest snapshot and interpolates
 * between them using wall-clock time since the latest snapshot arrived.
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
  private lastStyled = -1;
  private recruitFlags = new Uint8Array(0);
  private recruitIdx: Uint32Array = new Uint32Array(0);
  /** Interpolated position of the player ant after the latest `update()`, if any. */
  readonly playerPos = { x: 0, y: 0, valid: false };

  constructor(renderer: Renderer, parent: Container) {
    const g = new Graphics();
    // Ant glyph pointing +x: three body segments and head.
    g.ellipse(-5, 0, 3.5, 2.5).fill(0xffffff);
    g.ellipse(0, 0, 2.5, 2).fill(0xdddddd);
    g.ellipse(4.5, 0, 2.5, 2.2).fill(0xffffff);
    this.texture = renderer.generateTexture({ target: g, resolution: 4 });
    this.view = new ParticleContainer({
      dynamicProperties: { position: true, rotation: true, vertex: false, color: true },
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
          scaleX: 1.5,
          scaleY: 1.5,
          tint: 0x151515,
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
      if (alpha >= 1) {
        p.x = cx;
        p.y = cy;
      } else {
        p.x = prev[o]! + (cx - prev[o]!) * alpha;
        p.y = prev[o + 1]! + (cy - prev[o + 1]!) * alpha;
      }
      p.rotation = curr[o + 2]!;
      // Carrying ants are tinted gold.
      p.tint = curr[o + 3]! > 0 ? 0xffc21a : 0x151515;
      if (this.recruitFlags[i]) p.tint = 0x8a6a10;
    }
    const pi = this.playerIndex;
    if (this.lastStyled >= 0 && this.lastStyled !== pi && this.lastStyled < n) {
      const old = list[this.lastStyled]!;
      old.alpha = 1;
    }
    this.lastStyled = -1;
    this.playerPos.valid = false;
    if (pi >= 0 && pi < n) {
      const p = list[pi]!;
      // The player is drawn by PlayerMarker (bigger, yellow); hide its particle.
      p.alpha = 0;
      this.playerPos.x = p.x;
      this.playerPos.y = p.y;
      this.playerPos.valid = true;
      this.lastStyled = pi;
    }
  }
}
