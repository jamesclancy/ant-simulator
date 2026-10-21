import { Container, Graphics } from 'pixi.js';
import type { ObstacleInfo } from '@ant/shared';

const ROCK_FILL = 0x7d7a72;
const ROCK_SHADE = 0x5a5850;
const ROCK_LIGHT = 0x9a978d;

/** Draws sandbox rocks. The sim sends the list only when it changes, so this redraws rarely. */
export class ObstacleLayer {
  readonly view = new Container();
  private gfx = new Graphics();

  constructor(parent: Container) {
    this.view.addChild(this.gfx);
    parent.addChild(this.view);
  }

  update(rocks: readonly ObstacleInfo[]): void {
    this.gfx.clear();
    for (const r of rocks) {
      this.gfx
        .circle(r.x + r.radius * 0.06, r.y + r.radius * 0.1, r.radius)
        .fill({ color: 0x000000, alpha: 0.25 })
        .circle(r.x, r.y, r.radius)
        .fill(ROCK_FILL)
        .stroke({ color: ROCK_SHADE, width: 2 })
        .circle(r.x - r.radius * 0.28, r.y - r.radius * 0.28, r.radius * 0.35)
        .fill({ color: ROCK_LIGHT, alpha: 0.55 });
    }
  }
}
