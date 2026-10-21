import { Container, Sprite } from 'pixi.js';
import type { AntlionInfo, Snapshot } from '@ant/shared';
import type { Art } from '../art';
import { SURFACE_PX } from '../art/sprites/world';

/** Shimmer period of the sliding sand, ms. */
const SHIMMER_MS = 420;

interface Pit {
  root: Container;
  cone: Sprite;
  jaws: Sprite;
  r: number;
  alive: boolean;
}

/**
 * Antlion pits: a stepped sand cone (rings darkening towards the middle) whose sliding grains
 * shimmer between two frames, with the antlion's jaws snapping at the centre. When the antlion
 * is killed the pit is redrawn as flat, pale, inert sand. Draw below the ants.
 */
export class AntlionLayer {
  readonly view = new Container();
  private readonly pits = new Map<number, Pit>();
  private reduceMotion = false;
  private clock = 0;

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
    this.clock += dtMs;
    const step = Math.floor(this.clock / SHIMMER_MS);
    for (const pit of this.pits.values()) {
      if (!pit.alive) continue;
      pit.cone.texture = this.art.pit(pit.r, (step & 1) as 0 | 1);
      pit.jaws.texture = this.art.jaws[(step >> 1) & 1]!;
    }
  }

  private create(a: AntlionInfo): Pit {
    const root = new Container();
    root.position.set(Math.round(a.x), Math.round(a.y));
    root.scale.set(SURFACE_PX);
    const cone = new Sprite(this.art.pit(a.radius, a.alive ? 0 : 2));
    cone.anchor.set(0.5);
    const jaws = new Sprite(this.art.jaws[0]);
    jaws.anchor.set(0.5, 0.75);
    jaws.visible = a.alive;
    root.addChild(cone, jaws);
    this.view.addChild(root);
    return { root, cone, jaws, r: a.radius, alive: a.alive };
  }
}
