import { Container, Graphics, Sprite } from 'pixi.js';
import type { SpiderInfo, Snapshot } from '@ant/shared';
import { SpiderState } from '@ant/shared';
import type { Art } from '../art';
import { SURFACE_PX } from '../art/sprites/world';

const BAR_W = 20;

interface Entry {
  root: Container;
  body: Sprite;
  bar: Graphics;
  /** Smoothed position the sprite is drawn at. */
  x: number;
  y: number;
  heading: number;
  /** Distance walked, drives the leg cycle. */
  phase: number;
  target: SpiderInfo;
}

/**
 * Spiders on the surface: an abdomen + head with eight legs whose tips swing as it walks
 * (alternating tetrapod gait), crouched and still while lurking/eating, plus an HP bar
 * once it is hurt. Positions are eased toward the latest snapshot every frame.
 */
export class SpiderLayer {
  readonly view = new Container();
  private readonly sprites = new Map<number, Entry>();

  private reduceMotion = false;

  constructor(
    parent: Container,
    private readonly art: Art,
  ) {
    parent.addChild(this.view);
  }

  setReduceMotion(on: boolean): void {
    this.reduceMotion = on;
  }

  update(snapshot: Snapshot): void {
    const seen = new Set<number>();
    for (const s of snapshot.spiders) {
      seen.add(s.id);
      let sp = this.sprites.get(s.id);
      if (!sp) {
        sp = this.create(s);
        this.sprites.set(s.id, sp);
      }
      sp.target = s;
    }
    for (const [id, sp] of this.sprites) {
      if (seen.has(id)) continue;
      sp.root.destroy({ children: true });
      this.sprites.delete(id);
    }
  }

  /** Call every frame with the frame time in ms. */
  tick(dtMs: number): void {
    const k = 1 - Math.exp(-dtMs / 70);
    for (const sp of this.sprites.values()) {
      const t = sp.target;
      sp.root.visible = t.state !== SpiderState.Dead;
      if (!sp.root.visible) {
        sp.x = t.x;
        sp.y = t.y;
        continue;
      }
      const px = sp.x;
      const py = sp.y;
      // Teleports (respawn) snap instead of gliding across the yard.
      if (Math.hypot(t.x - sp.x, t.y - sp.y) > 120) {
        sp.x = t.x;
        sp.y = t.y;
      } else {
        sp.x += (t.x - sp.x) * k;
        sp.y += (t.y - sp.y) * k;
      }
      let dh = t.heading - sp.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      sp.heading += dh * Math.min(1, k * 2);
      const moved = Math.hypot(sp.x - px, sp.y - py);
      sp.phase += moved * 0.18;
      sp.root.position.set(sp.x, sp.y);
      sp.body.rotation = Math.round(sp.heading / (Math.PI / 8)) * (Math.PI / 8);
      const crouched = t.state === SpiderState.Lurk || t.state === SpiderState.Eat;
      const walk = this.art.spider.walk;
      sp.body.texture = crouched
        ? this.art.spider.crouch
        : walk[this.reduceMotion || moved < 0.05 ? 0 : Math.floor(sp.phase) % walk.length]!;
      this.drawBar(sp.bar, t, sp.heading);
    }
  }

  private create(s: SpiderInfo): Entry {
    const root = new Container();
    const body = new Sprite(this.art.spider.walk[0]);
    body.anchor.set(0.5);
    const bar = new Graphics();
    // The bar must not rotate with the spider: it is drawn counter-rotated each frame.
    root.addChild(body, bar);
    root.scale.set(SURFACE_PX);
    this.view.addChild(root);
    return { root, body, bar, x: s.x, y: s.y, heading: s.heading, phase: 0, target: s };
  }

  private drawBar(g: Graphics, s: SpiderInfo, heading: number): void {
    g.clear();
    if (s.hp >= s.maxHp - 0.01) return;
    g.rotation = -heading;
    const f = Math.max(0, s.hp / s.maxHp);
    g.rect(-BAR_W / 2 - 1, -27, BAR_W + 2, 5).fill(0x000000);
    g.rect(-BAR_W / 2, -26, Math.round(BAR_W * f), 3).fill(
      f > 0.5 ? 0x6fcf5a : f > 0.3 ? 0xe8c547 : 0xe0523a,
    );
  }
}
