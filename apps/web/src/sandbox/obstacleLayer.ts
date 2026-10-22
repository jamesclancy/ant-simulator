import { Container, Sprite } from 'pixi.js';
import type { ObstacleInfo } from '@ant/shared';
import type { Art } from '../art';
import { SURFACE_PX } from '../art/sprites/world';

/** Draws sandbox rocks as pixel boulders. The sim sends the list only when it changes. */
export class ObstacleLayer {
  readonly view = new Container();

  constructor(
    parent: Container,
    private readonly art: Art,
  ) {
    parent.addChild(this.view);
  }

  update(rocks: readonly ObstacleInfo[]): void {
    for (const child of this.view.removeChildren()) child.destroy();
    for (const r of rocks) {
      const s = new Sprite(this.art.rock(r.radius, r.id));
      s.anchor.set(0.5);
      s.scale.set(SURFACE_PX);
      s.position.set(Math.round(r.x), Math.round(r.y));
      this.view.addChild(s);
    }
  }
}
