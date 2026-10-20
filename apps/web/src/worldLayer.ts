import { Container, Graphics } from 'pixi.js';
import type { Snapshot } from '@ant/shared';

const FOOD_COLOR = 0xe8c547;
/** Mound colour around each colony's entrance (index = colony id). */
const MOUND_COLORS = [0x5a4632, 0x7a3a26];

/** Draws the colonies' nests and food piles. Cheap enough to redraw food from every snapshot. */
export class WorldLayer {
  readonly view = new Container();
  private nest = new Graphics();
  private food = new Graphics();
  private nestKey = '';
  private foodKey = '';

  constructor(parent: Container) {
    this.view.addChild(this.nest, this.food);
    parent.addChild(this.view);
  }

  update(snapshot: Snapshot): void {
    const nestKey = snapshot.colonies.map((c) => `${c.nest.x},${c.nest.y},${c.queenAlive}`).join();
    if (nestKey !== this.nestKey) {
      this.nestKey = nestKey;
      this.nest.clear();
      for (const c of snapshot.colonies) {
        const { x, y, radius } = c.nest;
        this.nest
          .circle(x, y, radius * 1.6)
          .fill({ color: MOUND_COLORS[c.id] ?? 0x5a4632, alpha: c.queenAlive ? 0.6 : 0.25 })
          .circle(x, y, radius)
          .fill(0x1a120a);
      }
    }
    const foodKey = snapshot.food.map((f) => `${f.id}:${f.x}:${f.y}:${Math.ceil(f.amount)}`).join();
    if (foodKey !== this.foodKey) {
      this.foodKey = foodKey;
      this.food.clear();
      for (const f of snapshot.food) {
        // Visual size follows remaining amount (area ~ amount), capped at the pickup radius.
        const r = Math.max(3, Math.min(f.radius, Math.sqrt(f.amount) * 0.6));
        this.food.circle(f.x, f.y, r).fill(FOOD_COLOR).stroke({ color: 0x8a6d1a, width: 1.5 });
      }
    }
  }
}
