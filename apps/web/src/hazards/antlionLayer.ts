import { Container, Graphics } from 'pixi.js';
import type { AntlionInfo, Snapshot } from '@ant/shared';

const SAND_RIM = 0xe3cd90;
const SAND_MID = 0xc9ab62;
const SAND_DEEP = 0x8a6a30;
const SAND_DEAD = 0xd6c79a;
const JAW = 0x2b1d10;

interface Pit {
  root: Container;
  spiral: Graphics;
  alive: boolean;
}

/**
 * Antlion pits: a sand cone (rings getting darker towards the middle, a faint spiral of
 * sliding grains) with the antlion's jaws at the centre. When the antlion is killed the
 * pit is redrawn as flat, pale, inert sand. Draw below the ants.
 */
export class AntlionLayer {
  readonly view = new Container();
  private readonly pits = new Map<number, Pit>();
  private reduceMotion = false;

  constructor(parent: Container) {
    parent.addChild(this.view);
  }

  setReduceMotion(on: boolean): void {
    this.reduceMotion = on;
  }

  update(snapshot: Snapshot): void {
    const seen = new Set<number>();
    for (const a of snapshot.antlions) {
      seen.add(a.id);
      let pit = this.pits.get(a.id);
      if (!pit || pit.alive !== a.alive) {
        pit?.root.destroy({ children: true });
        pit = this.create(a);
        this.pits.set(a.id, pit);
      }
    }
    for (const [id, pit] of this.pits) {
      if (seen.has(id)) continue;
      pit.root.destroy({ children: true });
      this.pits.delete(id);
    }
  }

  /** Call every frame with the frame time in ms. */
  tick(dtMs: number): void {
    if (this.reduceMotion) return;
    for (const pit of this.pits.values()) if (pit.alive) pit.spiral.rotation -= dtMs * 0.0008;
  }

  private create(a: AntlionInfo): Pit {
    const root = new Container();
    root.position.set(a.x, a.y);
    const base = new Graphics();
    const spiral = new Graphics();
    const r = a.radius;
    if (a.alive) {
      const rings = 9;
      for (let k = 0; k < rings; k++) {
        const t = k / (rings - 1);
        const color =
          t < 0.5 ? lerp(SAND_RIM, SAND_MID, t * 2) : lerp(SAND_MID, SAND_DEEP, (t - 0.5) * 2);
        base.circle(0, 0, r * (1 - t * 0.9)).fill(color);
      }
      base.circle(0, 0, r).stroke({ color: 0xf2e3b0, width: 1.5, alpha: 0.7 });
      // Spiral of grains running down the slope.
      for (let arm = 0; arm < 3; arm++) {
        const a0 = (arm * Math.PI * 2) / 3;
        for (let s = 0; s <= 24; s++) {
          const t = s / 24;
          const ang = a0 + t * 3.2;
          const rr = r * (0.92 - t * 0.8);
          const x = Math.cos(ang) * rr;
          const y = Math.sin(ang) * rr;
          if (s === 0) spiral.moveTo(x, y);
          else spiral.lineTo(x, y);
        }
      }
      spiral.stroke({ color: 0x6b4f24, width: 1, alpha: 0.35 });
      const jaws = new Graphics();
      for (const side of [-1, 1]) {
        jaws
          .moveTo(side * 1.5, 2)
          .quadraticCurveTo(side * 6, -1, side * 3.5, -6)
          .stroke({ color: JAW, width: 2, cap: 'round' });
      }
      root.addChild(base, spiral, jaws);
    } else {
      base.circle(0, 0, r).fill({ color: SAND_DEAD, alpha: 0.85 });
      base.circle(0, 0, r * 0.45).fill({ color: SAND_DEAD, alpha: 0.6 });
      base.circle(0, 0, r).stroke({ color: 0xb59f6a, width: 1, alpha: 0.5 });
      root.addChild(base, spiral);
    }
    this.view.addChild(root);
    return { root, spiral, alive: a.alive };
  }
}

function lerp(a: number, b: number, t: number): number {
  const c = (s: number): number => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (c(16) << 16) | (c(8) << 8) | c(0);
}
