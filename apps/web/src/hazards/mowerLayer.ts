import { Container, Graphics, Sprite } from 'pixi.js';
import type { MowerInfo, Snapshot } from '@ant/shared';
import type { Art } from '../art';
import { MOWER_W } from '../art/sprites/yard';
import { SURFACE_PX } from '../art/sprites/world';

const LANE_FILL = 0xffb020;
const LANE_EDGE = 0xffd060;
/** Blade-spin frame period, ms. */
const SPIN_MS = 60;
/** Dashes along the lane edges, world units. */
const DASH = 36;

/**
 * The lawnmower. While it warms up its lanes are marked on the grass (amber stripes that pulse
 * faster as the start nears), then the mower sweeps them one after another, blades spinning;
 * lanes it already cut are cleared. With reduced motion the stripes stay steady and the blades
 * do not spin. The stripes sit just above the ground (`lanes`), the mower on top of the ants.
 */
export class MowerLayer {
  /** Add just above the ground, below everything that walks on it. */
  readonly lanes = new Container();
  /** Add on top of the surface layers. */
  readonly view = new Container();
  private readonly stripes = new Graphics();
  private readonly mower: Sprite;
  private info: MowerInfo | undefined;
  private key = '';
  private clock = 0;
  private shownPos = 0;
  private reduceMotion = false;

  constructor(
    parent: Container,
    private readonly worldSize: number,
    private readonly art: Art,
  ) {
    this.lanes.addChild(this.stripes);
    this.lanes.eventMode = 'none';
    this.mower = new Sprite(art.yard.mower[0]);
    this.mower.anchor.set(0.5);
    this.mower.scale.set(SURFACE_PX);
    this.mower.visible = false;
    this.view.addChild(this.mower);
    this.view.eventMode = 'none';
    parent.addChild(this.view);
  }

  setReduceMotion(on: boolean): void {
    this.reduceMotion = on;
  }

  /** The mower's front on screen (world units) while it is on the field, else null. */
  get position(): { x: number; y: number } | null {
    const m = this.info;
    if (!m || !m.onField) return null;
    const lane = m.lanes[m.pass] ?? 0;
    return m.axis === 'x' ? { x: this.shownPos, y: lane } : { x: lane, y: this.shownPos };
  }

  update(snapshot: Snapshot): void {
    const m = snapshot.mower;
    if (!m) {
      this.info = undefined;
      return;
    }
    if (!this.info || !this.info.onField || !m.onField || m.pass !== this.info.pass)
      this.shownPos = m.pos;
    this.info = m;
  }

  /** Call every frame with the frame time in ms. */
  tick(dtMs: number): void {
    const m = this.info;
    this.lanes.visible = this.mower.visible = !!m;
    if (!m) {
      this.key = '';
      return;
    }
    this.clock += dtMs;
    // Lanes still to be cut (the current one included).
    const from = m.phase === 'warning' ? 0 : m.pass;
    const key = `${m.axis}:${m.lanes.join(',')}:${from}`;
    if (key !== this.key) {
      this.key = key;
      this.drawLanes(m, from);
    }
    const urgency = m.phase === 'warning' ? 1 - Math.min(1, m.startsIn / 200) : 1;
    this.lanes.alpha = this.reduceMotion
      ? 0.8
      : 0.65 + 0.35 * Math.sin((this.clock / 1000) * (3 + 9 * urgency));

    this.mower.visible = m.onField;
    if (!m.onField) return;
    // Ease towards the latest snapshot position (it advances in steps of a few units).
    this.shownPos += (m.pos - this.shownPos) * Math.min(1, dtMs / 60);
    const lane = m.lanes[m.pass] ?? 0;
    // Place the body behind its front edge, along the direction of travel.
    const along = this.shownPos - m.dir * (MOWER_W * SURFACE_PX) * 0.5;
    this.mower.position.set(
      Math.round(m.axis === 'x' ? along : lane),
      Math.round(m.axis === 'x' ? lane : along),
    );
    this.mower.rotation =
      m.axis === 'x' ? (m.dir > 0 ? 0 : Math.PI) : (m.dir > 0 ? 1 : -1) * (Math.PI / 2);
    const frame = this.reduceMotion ? 0 : Math.floor(this.clock / SPIN_MS) & 1;
    this.mower.texture = this.art.yard.mower[frame]!;
  }

  private drawLanes(m: MowerInfo, from: number): void {
    const g = this.stripes.clear();
    const half = m.width / 2;
    for (let k = from; k < m.lanes.length; k++) {
      const lane = m.lanes[k]!;
      const rect = (a: number, b: number, w: number, h: number): void => {
        if (m.axis === 'x') g.rect(a, lane + b, w, h);
        else g.rect(lane + b, a, h, w);
      };
      rect(0, -half, this.worldSize, m.width);
      g.fill({ color: LANE_FILL, alpha: k === from ? 0.2 : 0.12 });
      for (let a = 0; a < this.worldSize; a += DASH * 2) {
        rect(a, -half, DASH, 4);
        rect(a, half - 4, DASH, 4);
      }
      g.fill({ color: LANE_EDGE, alpha: 0.8 });
    }
  }
}
