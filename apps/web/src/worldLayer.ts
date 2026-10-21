import { Container, Sprite } from 'pixi.js';
import type { Snapshot } from '@ant/shared';
import type { Art } from './art';
import type { FoodKind } from './art/sprites/world';
import { SURFACE_PX } from './art/sprites/world';

interface Corpse {
  x: number;
  y: number;
  ttl: number;
}

/** Draws the colonies' nest mounds and food piles as pixel sprites. Rebuilt only when they change. */
export class WorldLayer {
  readonly view = new Container();
  private nest = new Container();
  private food = new Container();
  private nestKey = '';
  private foodKey = '';
  /** Piles left by killed predators draw as husks; events carry only a position, so match by it. */
  private corpses = new Set<number>();
  private pending: Corpse[] = [];

  constructor(
    parent: Container,
    private readonly art: Art,
  ) {
    this.view.addChild(this.nest, this.food);
    parent.addChild(this.view);
  }

  update(snapshot: Snapshot): void {
    for (const ev of snapshot.events) {
      if (ev.type === 'spiderKilled' || ev.type === 'antlionKilled') {
        this.pending.push({ x: ev.x, y: ev.y, ttl: 4 });
      }
    }
    if (this.pending.length) {
      this.pending = this.pending.filter((p) => {
        const hit = snapshot.food.find((f) => Math.hypot(f.x - p.x, f.y - p.y) < 40);
        if (hit) this.corpses.add(hit.id);
        return !hit && --p.ttl > 0;
      });
    }
    const nestKey = snapshot.colonies.map((c) => `${c.nest.x},${c.nest.y},${c.queenAlive}`).join();
    if (nestKey !== this.nestKey) {
      this.nestKey = nestKey;
      for (const child of this.nest.removeChildren()) child.destroy();
      for (const c of snapshot.colonies) {
        const { x, y, radius } = c.nest;
        const s = new Sprite(this.art.mound(c.id, radius));
        s.anchor.set(0.5);
        s.scale.set(SURFACE_PX);
        s.position.set(Math.round(x), Math.round(y));
        s.alpha = c.queenAlive ? 1 : 0.55;
        this.nest.addChild(s);
      }
    }
    const foodKey = snapshot.food.map((f) => `${f.id}:${f.x}:${f.y}:${Math.ceil(f.amount)}`).join();
    if (foodKey !== this.foodKey) {
      this.foodKey = foodKey;
      for (const child of this.food.removeChildren()) child.destroy();
      for (const f of snapshot.food) {
        // Visual size follows remaining amount (area ~ amount), capped at the pickup radius.
        const r = Math.max(4, Math.min(f.radius, Math.sqrt(f.amount) * 0.6));
        const kind: FoodKind = this.corpses.has(f.id)
          ? 'corpse'
          : f.id % 3 === 0
            ? 'sugar'
            : 'crumb';
        const s = new Sprite(this.art.food(kind, r, f.id));
        s.anchor.set(0.5);
        s.scale.set(SURFACE_PX);
        s.position.set(Math.round(f.x), Math.round(f.y));
        this.food.addChild(s);
      }
    }
  }
}
