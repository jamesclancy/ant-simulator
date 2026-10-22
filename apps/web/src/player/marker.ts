import { Container, Graphics, Sprite } from 'pixi.js';
import type { Texture } from 'pixi.js';
import type { Art } from '../art';
import { ANT_SIZE, STATE_INDEX } from '../art/sprites/ants';

/** Screen pixels per art pixel: whole numbers keep the player's pixels square. */
const SCREEN_PX = 3;
const TARGET_FADE_MS = 900;
const FRAME_MS = 100;

/**
 * Draws the player ant (the yellow pixel ant at a whole-number pixel scale with a pulsing halo)
 * and the brief move-to target marker. Sized in screen space so the player stays findable
 * when zoomed out.
 */
export class PlayerMarker {
  private root = new Container();
  private ant = new Sprite();
  private halo = new Graphics();
  private target = new Graphics();
  private walk: Texture[];
  private carry: Texture[];
  private targetAt = { x: 0, y: 0, t: -Infinity };
  private last = { x: 0, y: 0 };
  private animate = true;

  constructor(parent: Container, art: Art) {
    const set = art.ants.frames.surf[2]![0]!;
    this.walk = set[STATE_INDEX.walk]!;
    this.carry = set[STATE_INDEX.food]!;
    this.ant.texture = this.walk[0]!;
    this.ant.anchor.set(0.5);
    const r = ANT_SIZE[0]!.w * 0.55;
    this.halo.circle(0, 0, r).stroke({ color: 0xffe600, width: 1.2 });
    this.target.circle(0, 0, 1).stroke({ color: 0xffe600, width: 0.12 });
    this.root.addChild(this.halo, this.ant);
    this.root.visible = false;
    this.target.visible = false;
    parent.addChild(this.target, this.root);
  }

  setReduceMotion(on: boolean): void {
    this.animate = !on;
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
      const s = SCREEN_PX / zoom;
      const moving = Math.abs(pos.x - this.last.x) + Math.abs(pos.y - this.last.y) > 0.05;
      this.last = { x: pos.x, y: pos.y };
      this.root.position.set(Math.round(pos.x), Math.round(pos.y));
      this.ant.scale.set(s);
      this.ant.rotation = Math.round(heading / (Math.PI / 8)) * (Math.PI / 8);
      const frames = carrying ? this.carry : this.walk;
      this.ant.texture =
        frames[this.animate && moving ? Math.floor(now / FRAME_MS) % frames.length : 0]!;
      const pulse = this.animate ? 0.5 + 0.5 * Math.sin(now / 220) : 0.5;
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
