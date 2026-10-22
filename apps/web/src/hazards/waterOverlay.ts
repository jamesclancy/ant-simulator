import { Container, Sprite } from 'pixi.js';
import { NEST_GRID_W, NEST_TILE } from '@ant/shared';
import type { Art } from '../art';

const T = NEST_TILE;
/** Surface ripple period, ms. */
const RIPPLE_MS = 500;

/**
 * Flood water in a nest cross-section: one translucent pixel-water tile per wet tile, deeper
 * water more opaque. Levels arrive only when they change (`WaterGridSnapshot`), so the
 * sprites are rebuilt per update and not per frame; the ripple frame flips on a timer.
 */
export class WaterOverlay {
  readonly view = new Container();
  private key = -1;
  private tiles: Sprite[] = [];
  private frame = 0;
  private reduceMotion = false;

  constructor(
    private readonly art: Art,
    private readonly width = NEST_GRID_W,
  ) {}

  setReduceMotion(on: boolean): void {
    this.reduceMotion = on;
  }

  /** Draw `levels` (0..255 per tile); an unchanged `version` is ignored. */
  update(levels: Uint8Array, version: number): void {
    if (version === this.key) return;
    this.key = version;
    for (const child of this.view.removeChildren()) child.destroy();
    this.tiles = [];
    for (let i = 0; i < levels.length; i++) {
      const v = levels[i]!;
      if (v < 6) continue;
      const x = i % this.width;
      const y = (i - x) / this.width;
      const s = new Sprite(this.art.nest.water[(x + y) % 3]);
      s.position.set(x * T, y * T);
      s.alpha = 0.22 + 0.55 * (v / 255);
      this.view.addChild(s);
      this.tiles.push(s);
    }
    this.view.visible = this.tiles.length > 0;
  }

  /** Flip ripple frames (call every frame with the clock in ms). */
  tick(now: number): void {
    if (!this.view.visible || this.reduceMotion) return;
    const f = Math.floor(now / RIPPLE_MS) % 3;
    if (f === this.frame) return;
    this.frame = f;
    for (const [n, s] of this.tiles.entries()) s.texture = this.art.nest.water[(n + f) % 3]!;
  }
}
