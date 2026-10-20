import { Container, Graphics } from 'pixi.js';

/** Glyph length in world units at scale 1 (matches the ordinary ant glyph). */
const GLYPH_LEN = 13;
/** Keep the player at least this many screen pixels long at any zoom. */
const MIN_SCREEN_LEN = 44;
const MIN_SCALE = 3;
const TARGET_FADE_MS = 900;

/**
 * Draws the player ant (big, bright yellow, outlined, with a pulsing halo) and the brief
 * move-to target marker. Sized in screen space so the player stays findable when zoomed out.
 */
export class PlayerMarker {
  private root = new Container();
  private ant = new Graphics();
  private halo = new Graphics();
  private target = new Graphics();
  private load = new Graphics();
  private targetAt = { x: 0, y: 0, t: -Infinity };

  constructor(parent: Container) {
    this.ant.ellipse(-5, 0, 3.5, 2.5).fill(0xffe600).stroke({ color: 0x1a1400, width: 0.7 });
    this.ant.ellipse(0, 0, 2.5, 2).fill(0xffd000).stroke({ color: 0x1a1400, width: 0.7 });
    this.ant.ellipse(4.5, 0, 2.5, 2.2).fill(0xffe600).stroke({ color: 0x1a1400, width: 0.7 });
    this.load.circle(8, 0, 2).fill(0xff9d00).stroke({ color: 0x1a1400, width: 0.5 });
    this.ant.addChild(this.load);
    this.halo.circle(0, 0, 10).stroke({ color: 0xffe600, width: 1.2 });
    this.target.circle(0, 0, 1).stroke({ color: 0xffe600, width: 0.12 });
    this.root.addChild(this.halo, this.ant);
    this.root.visible = false;
    this.target.visible = false;
    parent.addChild(this.target, this.root);
  }

  showTarget(x: number, y: number): void {
    this.targetAt = { x, y, t: performance.now() };
  }

  /** `pos` null hides the player (no ants). `zoom` is the camera scale. */
  update(
    pos: { x: number; y: number } | null,
    heading: number,
    carrying: boolean,
    zoom: number,
  ): void {
    const now = performance.now();
    this.root.visible = pos !== null;
    if (pos) {
      const s = Math.max(MIN_SCALE, MIN_SCREEN_LEN / (GLYPH_LEN * zoom));
      this.root.position.set(pos.x, pos.y);
      this.ant.scale.set(s);
      this.ant.rotation = heading;
      this.load.visible = carrying;
      const pulse = 0.5 + 0.5 * Math.sin(now / 220);
      this.halo.scale.set(s * (0.9 + 0.35 * pulse));
      this.halo.alpha = 0.9 - 0.6 * pulse;
    }
    const age = now - this.targetAt.t;
    this.target.visible = age < TARGET_FADE_MS;
    if (this.target.visible) {
      const k = age / TARGET_FADE_MS;
      this.target.position.set(this.targetAt.x, this.targetAt.y);
      this.target.scale.set((10 + 14 * k) / zoom);
      this.target.alpha = 1 - k;
    }
  }
}
