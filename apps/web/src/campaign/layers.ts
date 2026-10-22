import { Container, Graphics } from 'pixi.js';
import type { FootstepInfo } from '@ant/shared';

/** Placeholder colours (the art pass restyles these). */
const TILE_A = 0xcfc6b4;
const TILE_B = 0xb9af9b;
const GROUT = 0x8f8676;
const TILE = 96;

/** House rooms: a tiled floor drawn over the grass. Static, drawn once per patch. */
export class FloorLayer {
  readonly view = new Container();

  constructor(parent: Container, worldSize: number) {
    const g = new Graphics();
    g.rect(0, 0, worldSize, worldSize).fill(TILE_A);
    for (let y = 0; y < worldSize; y += TILE) {
      for (let x = (y / TILE) % 2 ? 0 : TILE; x < worldSize; x += TILE * 2) {
        g.rect(x, y, TILE, TILE);
      }
    }
    g.fill(TILE_B);
    for (let i = 0; i <= worldSize; i += TILE) {
      g.moveTo(i, 0).lineTo(i, worldSize).moveTo(0, i).lineTo(worldSize, i);
    }
    g.stroke({ color: GROUT, width: 2 });
    this.view.addChild(g);
    // Right above the background, below every layer that walks on it.
    parent.addChildAt(this.view, Math.min(1, parent.children.length));
  }
}

/**
 * Human feet over a house room: a shadow that darkens and tightens as the foot comes down,
 * then a solid sole print for the few ticks after it stamped.
 */
export class FootstepLayer {
  readonly view = new Container();
  private gfx = new Graphics();

  constructor(parent: Container) {
    this.view.addChild(this.gfx);
    parent.addChild(this.view);
  }

  update(feet: readonly FootstepInfo[] | undefined): void {
    const g = this.gfx.clear();
    for (const f of feet ?? []) {
      if (f.stamped) {
        g.ellipse(f.x, f.y, f.radius * 0.62, f.radius).fill({ color: 0x3a2a20, alpha: 0.85 });
        continue;
      }
      const spread = 1.6 - 0.6 * f.progress;
      g.ellipse(f.x, f.y, f.radius * 0.62 * spread, f.radius * spread).fill({
        color: 0x000000,
        alpha: 0.12 + 0.4 * f.progress,
      });
      g.ellipse(f.x, f.y, f.radius * 0.62, f.radius).stroke({
        color: 0xff4030,
        width: 3,
        alpha: 0.4 + 0.5 * f.progress,
      });
    }
  }
}
