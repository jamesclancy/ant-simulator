import { Container, Graphics } from 'pixi.js';
import type { SpiderInfo, Snapshot } from '@ant/shared';
import { SpiderState } from '@ant/shared';

const BODY = 0x2a1a2e;
const BODY_HI = 0x4b2f55;
const LEG = 0x1c1220;
const EYES = 0xff4040;
const BAR_W = 34;

interface Sprite {
  root: Container;
  legs: Graphics;
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
  private readonly sprites = new Map<number, Sprite>();

  constructor(parent: Container) {
    parent.addChild(this.view);
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
      sp.phase += moved * 0.35;
      sp.root.position.set(sp.x, sp.y);
      sp.root.rotation = sp.heading;
      this.drawLegs(sp.legs, sp.phase, moved > 0.05, t.state);
      this.drawBar(sp.bar, t, sp.heading);
    }
  }

  private create(s: SpiderInfo): Sprite {
    const root = new Container();
    const legs = new Graphics();
    const body = new Graphics();
    // Abdomen behind, head/thorax in front (the spider faces +x).
    body.ellipse(-9, 0, 11, 8.5).fill(BODY).stroke({ color: BODY_HI, width: 1 });
    body.ellipse(-10, 0, 5, 3.5).fill({ color: BODY_HI, alpha: 0.7 });
    body.ellipse(5, 0, 7, 6).fill(BODY).stroke({ color: BODY_HI, width: 1 });
    body.circle(10, -2.2, 1.3).fill(EYES).circle(10, 2.2, 1.3).fill(EYES);
    const bar = new Graphics();
    // The bar must not rotate with the spider: it is drawn counter-rotated each frame.
    root.addChild(legs, body, bar);
    root.scale.set(1.6);
    this.view.addChild(root);
    return { root, legs, bar, x: s.x, y: s.y, heading: s.heading, phase: 0, target: s };
  }

  private drawLegs(g: Graphics, phase: number, walking: boolean, state: number): void {
    g.clear();
    const crouch = state === SpiderState.Lurk || state === SpiderState.Eat ? 0.8 : 1;
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 4; i++) {
        // Legs fan from front (i=0) to back (i=3); alternate legs swing in antiphase.
        const base = 0.9 - i * 0.55;
        const baseX = 7 - i * 4.5;
        const swing = walking ? Math.sin(phase + (i + (side > 0 ? 0 : 1)) * Math.PI) * 0.35 : 0;
        const a = side * (Math.PI / 2 - base * 0.9 + swing);
        const knee = 15 * crouch;
        const kx = baseX + Math.cos(a) * knee * 0.7;
        const ky = side * Math.abs(Math.sin(a)) * knee * 0.9 + (side > 0 ? -2 : 2);
        const tx = baseX + Math.cos(a) * 24 * crouch;
        const ty = side * Math.abs(Math.sin(a)) * 22 * crouch;
        g.moveTo(baseX, side * 3)
          .lineTo(kx, ky)
          .lineTo(tx, ty);
      }
    }
    g.stroke({ color: LEG, width: 2, cap: 'round', join: 'round' });
  }

  private drawBar(g: Graphics, s: SpiderInfo, heading: number): void {
    g.clear();
    if (s.hp >= s.maxHp - 0.01) return;
    g.rotation = -heading;
    g.scale.set(1 / 1.6);
    const f = Math.max(0, s.hp / s.maxHp);
    g.roundRect(-BAR_W / 2, -30, BAR_W, 5, 2).fill({ color: 0x000000, alpha: 0.6 });
    g.roundRect(-BAR_W / 2, -30, BAR_W * f, 5, 2).fill(
      f > 0.5 ? 0x6fcf5a : f > 0.3 ? 0xe8c547 : 0xe0523a,
    );
  }
}
