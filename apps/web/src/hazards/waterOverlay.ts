import { Graphics } from 'pixi.js';
import { NEST_GRID_W, NEST_TILE } from '@ant/shared';

const T = NEST_TILE;
const WATER = 0x3b8ed8;
const FOAM = 0xbfe2ff;

/**
 * Flood water in a nest cross-section: one translucent blue square per wet tile, deeper
 * water more opaque. Levels arrive only when they change (`WaterGridSnapshot`), so the
 * graphics are rebuilt per update and not per frame.
 */
export class WaterOverlay {
  readonly view = new Graphics();
  private key = -1;

  constructor(private readonly width = NEST_GRID_W) {}

  /** Draw `levels` (0..255 per tile); an unchanged `version` is ignored. */
  update(levels: Uint8Array, version: number): void {
    if (version === this.key) return;
    this.key = version;
    const g = this.view;
    g.clear();
    let any = false;
    for (let i = 0; i < levels.length; i++) {
      const v = levels[i]!;
      if (v < 6) continue;
      any = true;
      const x = i % this.width;
      const y = (i - x) / this.width;
      const k = v / 255;
      g.rect(x * T - 0.5, y * T - 0.5, T + 1, T + 1).fill({ color: WATER, alpha: 0.18 + 0.5 * k });
      // A pale surface line once the tile is more than half full.
      if (k > 0.5) g.rect(x * T, y * T, T, 1.2).fill({ color: FOAM, alpha: 0.35 });
    }
    this.view.visible = any;
  }
}
