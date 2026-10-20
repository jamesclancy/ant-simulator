import { Graphics } from 'pixi.js';
import type { Container } from 'pixi.js';
import type { Snapshot } from '@ant/shared';

/** Surface dirt heap beside the nest entrance; grows with the dirt diggers have hauled out. */
export class DirtMound {
  private g = new Graphics();
  private shown = -1;

  constructor(parent: Container) {
    parent.addChild(this.g);
  }

  update(snapshot: Snapshot): void {
    const dirt = snapshot.colony.dirt;
    const bucket = Math.floor(Math.sqrt(dirt) * 2);
    if (bucket === this.shown) return;
    this.shown = bucket;
    const { x, y, radius } = snapshot.nest;
    const r = Math.min(radius * 1.2, 4 + bucket * 0.9);
    this.g.clear();
    if (dirt <= 0) return;
    const cx = x + radius * 1.5;
    this.g
      .ellipse(cx, y + radius * 0.3, r * 1.3, r * 0.8)
      .fill({ color: 0x7a5535, alpha: 0.95 })
      .stroke({ color: 0x4a3320, width: 1 })
      .ellipse(cx - r * 0.2, y + radius * 0.1, r * 0.7, r * 0.45)
      .fill({ color: 0x9a7048, alpha: 0.9 });
  }
}
