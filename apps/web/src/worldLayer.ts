import { Container, Sprite } from 'pixi.js';
import type { Snapshot } from '@ant/shared';
import type { Art } from './art';
import type { FoodKind } from './art/sprites/world';
import { SURFACE_PX } from './art/sprites/world';
import { hash2 } from './art/pixels';

/** Food never draws smaller than this on screen (CSS px across), so it stays findable zoomed out. */
const MIN_SCREEN_PX = 20;
const MAX_BOOST = 8;
const GLINT_PERIOD_MS = 2600;
const GLINT_FRAMES = [0, 1, 2, 1, 0];

interface Pile {
  sprite: Sprite;
  glint: Sprite;
  /** Sprite width in world units at normal scale. */
  size: number;
  /** Current on-screen boost over normal scale. */
  k: number;
  id: number;
  x: number;
  y: number;
}

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
  private piles: Pile[] = [];
  private zoom = 1;
  private reduceMotion = false;

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
      this.piles = [];
      for (const f of snapshot.food) {
        // Visual size follows remaining amount (area ~ amount), well over the pickup radius.
        const r = Math.max(8, Math.min(f.radius, Math.sqrt(f.amount) * 0.6) * 1.5);
        const kind: FoodKind = this.corpses.has(f.id)
          ? 'corpse'
          : f.id % 3 === 0
            ? 'sugar'
            : 'crumb';
        const tex = this.art.food(kind, r, f.id);
        const s = new Sprite(tex);
        s.anchor.set(0.5);
        s.position.set(Math.round(f.x), Math.round(f.y));
        const glint = new Sprite(this.art.glint(0));
        glint.anchor.set(0.5);
        glint.visible = false;
        // Twinkle on the upper-left of the heap, where the light hits.
        const a = hash2(f.id, 3, 5) * Math.PI * 2;
        glint.position.set(
          s.x + Math.cos(a) * r * 0.5 - r * 0.2,
          s.y + Math.sin(a) * r * 0.4 - r * 0.3,
        );
        this.food.addChild(s, glint);
        this.piles.push({
          sprite: s,
          glint,
          size: tex.width * SURFACE_PX,
          k: 1,
          id: f.id,
          x: f.x,
          y: f.y,
        });
      }
      this.applyScale();
    }
  }

  /** Known piles' world positions (for the off-screen arrows). */
  get positions(): readonly { x: number; y: number }[] {
    return this.piles;
  }

  setReduceMotion(on: boolean): void {
    this.reduceMotion = on;
  }

  /** Per frame: keep piles a minimum size on screen and twinkle them. */
  tick(now: number, zoom: number): void {
    if (zoom !== this.zoom) {
      this.zoom = zoom;
      this.applyScale();
    }
    for (const p of this.piles) {
      const phase = (now / GLINT_PERIOD_MS + hash2(p.id, 1, 2)) % 1;
      const i = Math.floor(phase * 8);
      const frame = this.reduceMotion || i >= GLINT_FRAMES.length ? -1 : GLINT_FRAMES[i]!;
      p.glint.visible = frame >= 0;
      if (frame >= 0) {
        p.glint.texture = this.art.glint(frame);
        p.glint.scale.set(SURFACE_PX * Math.min(p.k, 3));
      }
    }
  }

  private applyScale(): void {
    for (const p of this.piles) {
      const onScreen = p.size * this.zoom;
      const k = Math.min(MAX_BOOST, Math.max(1, MIN_SCREEN_PX / onScreen));
      p.sprite.scale.set(SURFACE_PX * k);
      p.k = k;
    }
  }
}
