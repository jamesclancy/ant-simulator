import { Sprite } from 'pixi.js';
import type { Container } from 'pixi.js';
import type { Snapshot } from '@ant/shared';
import type { Art } from '../art';
import { SURFACE_PX } from '../art/sprites/world';

/** Surface dirt heap beside a colony's nest entrance; grows with the dirt hauled out. */
export class DirtMound {
  private sprite = new Sprite();
  private shown = -1;

  constructor(
    parent: Container,
    private colony: number,
    private art: Art,
  ) {
    this.sprite.anchor.set(0.5, 0.75);
    this.sprite.scale.set(SURFACE_PX);
    this.sprite.visible = false;
    parent.addChild(this.sprite);
  }

  update(snapshot: Snapshot): void {
    const c = snapshot.colonies[this.colony];
    if (!c) return;
    const dirt = c.dirt;
    const level = dirt <= 0 ? -1 : Math.min(4, Math.floor(Math.sqrt(dirt) / 2.2));
    if (level === this.shown) return;
    this.shown = level;
    this.sprite.visible = level >= 0;
    if (level < 0) return;
    const { x, y, radius } = c.nest;
    this.sprite.texture = this.art.dirtHeap(level);
    this.sprite.position.set(Math.round(x + radius * 1.9), Math.round(y + radius * 0.4));
  }
}
