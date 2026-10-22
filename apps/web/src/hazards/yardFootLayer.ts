import { Container, Graphics, Sprite } from 'pixi.js';
import type { FootstepInfo } from '@ant/shared';
import type { Art } from '../art';
import { SOLE_H } from '../art/sprites/yard';

const SHADOW = 0x000000;
const PRINT = 0x3a2a20;
const WARN = 0xffb020;

interface Foot {
  root: Container;
  shadow: Sprite;
  ring: Graphics;
  print: Sprite;
  radius: number;
}

/**
 * Human feet in the yard: a dark sole-shaped shadow that grows darker and tightens as the foot
 * comes down (with an amber outline so it reads on any palette), then a solid print for the
 * few ticks after the stamp. Feet face the way the human is walking.
 */
export class YardFootLayer {
  readonly view = new Container();
  private readonly feet = new Map<number, Foot>();

  constructor(
    parent: Container,
    private readonly art: Art,
  ) {
    this.view.eventMode = 'none';
    parent.addChild(this.view);
  }

  update(feet: readonly FootstepInfo[] | undefined): void {
    const seen = new Set<number>();
    for (const f of feet ?? []) {
      seen.add(f.id);
      let foot = this.feet.get(f.id);
      if (!foot) {
        foot = this.create(f);
        this.feet.set(f.id, foot);
      }
      foot.root.position.set(f.x, f.y);
      foot.root.rotation = (f.angle ?? 0) + Math.PI / 2;
      const base = (f.radius * 1.9) / SOLE_H;
      if (f.stamped) {
        foot.shadow.visible = foot.ring.visible = false;
        foot.print.visible = true;
        foot.print.scale.set(base);
        continue;
      }
      const spread = 1.5 - 0.5 * f.progress;
      foot.print.visible = false;
      foot.shadow.visible = foot.ring.visible = true;
      foot.shadow.scale.set(base * spread);
      foot.shadow.alpha = 0.15 + 0.45 * f.progress;
      foot.ring.scale.set(1);
      foot.ring.alpha = 0.4 + 0.5 * f.progress;
    }
    for (const [id, foot] of this.feet) {
      if (seen.has(id)) continue;
      foot.root.destroy({ children: true });
      this.feet.delete(id);
    }
  }

  private create(f: FootstepInfo): Foot {
    const root = new Container();
    const shadow = new Sprite(this.art.yard.sole);
    shadow.anchor.set(0.5);
    shadow.tint = SHADOW;
    const print = new Sprite(this.art.yard.sole);
    print.anchor.set(0.5);
    print.tint = PRINT;
    print.alpha = 0.85;
    print.visible = false;
    const ring = new Graphics();
    ring.ellipse(0, 0, f.radius * 0.62, f.radius).stroke({ color: WARN, width: 3 });
    root.addChild(shadow, print, ring);
    this.view.addChild(root);
    return { root, shadow, ring, print, radius: f.radius };
  }
}
