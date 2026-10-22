import type { Container } from 'pixi.js';

const MIN_ZOOM = 0.125;
const MAX_ZOOM = 8;
/** Zoom stops: at these levels every art pixel covers a whole (or half) number of screen pixels. */
export const ZOOM_STEPS = [0.125, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8] as const;
/** Wheel distance (px) per zoom step. */
const WHEEL_STEP = 50;

const nearestStep = (z: number): number => {
  let best: number = ZOOM_STEPS[0];
  for (const s of ZOOM_STEPS)
    if (Math.abs(Math.log(s / z)) < Math.abs(Math.log(best / z))) best = s;
  return best;
};

/** Pan/zoom controller for a world container: wheel, mouse drag, one-finger drag, pinch. */
export class Camera {
  /** Disabled cameras ignore input (the hidden layer's camera while another is shown). */
  enabled = true;
  /**
   * One finger (or the left mouse button) drags the view. Off while a paint tool owns that
   * gesture; two-finger pan/zoom, the wheel and mouse right/middle drag still work.
   */
  oneFingerPan = true;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private wheelAcc = 0;
  private pinchMid = { x: 0, y: 0 };
  private shakeLeft = 0;
  private shakeSpan = 1;
  private shakeAmp = 0;
  private shakeOff = { x: 0, y: 0 };
  /** Device pixel ratio used to keep the view on whole device pixels. */
  pixelRatio = 1;

  constructor(
    private world: Container,
    private el: HTMLElement,
  ) {
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onUp);
  }

  get zoom(): number {
    return this.world.scale.x;
  }

  /** Center the camera on a world point at the given zoom. */
  focus(wx: number, wy: number, zoom: number): void {
    const r = this.el.getBoundingClientRect();
    this.world.scale.set(zoom);
    this.world.position.set(r.width / 2 - wx * zoom, r.height / 2 - wy * zoom);
  }

  /** Pan so a world point is at the centre of the view, keeping the current zoom. */
  centerOn(wx: number, wy: number): void {
    const r = this.el.getBoundingClientRect();
    const z = this.world.scale.x;
    this.world.position.set(r.width / 2 - wx * z, r.height / 2 - wy * z);
  }

  private zoomAt(sx: number, sy: number, factor: number): void {
    const old = this.world.scale.x;
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, old * factor));
    const k = next / old;
    this.world.position.set(sx - (sx - this.world.x) * k, sy - (sy - this.world.y) * k);
    this.world.scale.set(next);
  }

  private local(e: PointerEvent): { x: number; y: number } {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onWheel = (e: WheelEvent): void => {
    if (!this.enabled) return;
    e.preventDefault();
    const r = this.el.getBoundingClientRect();
    this.wheelAcc += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    const steps = Math.trunc(this.wheelAcc / WHEEL_STEP);
    if (steps === 0) return;
    this.wheelAcc -= steps * WHEEL_STEP;
    let i = ZOOM_STEPS.indexOf(nearestStep(this.world.scale.x) as (typeof ZOOM_STEPS)[number]);
    i = Math.max(
      0,
      Math.min(ZOOM_STEPS.length - 1, i - Math.sign(steps) * Math.min(2, Math.abs(steps))),
    );
    this.zoomAt(e.clientX - r.left, e.clientY - r.top, ZOOM_STEPS[i]! / this.world.scale.x);
  };

  /** Shake the view by up to `amp` screen pixels, fading over `ms`. A stronger shake wins. */
  shake(amp: number, ms: number): void {
    if (amp < this.shakeAmp * (this.shakeLeft / this.shakeSpan)) return;
    this.shakeAmp = amp;
    this.shakeLeft = this.shakeSpan = ms;
  }

  /** Take back last frame's shake offset: call before anything that moves the view. */
  unshake(): void {
    this.world.position.x -= this.shakeOff.x;
    this.world.position.y -= this.shakeOff.y;
    this.shakeOff = { x: 0, y: 0 };
  }

  /** Apply this frame's shake offset (whole pixels): call after the view is placed. */
  applyShake(dtMs: number): void {
    if (this.shakeLeft <= 0) return;
    this.shakeLeft = Math.max(0, this.shakeLeft - dtMs);
    const k = (this.shakeAmp * this.shakeLeft) / this.shakeSpan;
    const t = this.shakeLeft;
    this.shakeOff = {
      x: Math.round(Math.sin(t * 0.09) * k),
      y: Math.round(Math.cos(t * 0.13) * k),
    };
    this.world.position.x += this.shakeOff.x;
    this.world.position.y += this.shakeOff.y;
  }

  /** Keep the world on whole device pixels so nearest-neighbour art never shimmers. Call each frame. */
  snapToPixels(): void {
    const k = this.pixelRatio;
    this.world.position.set(Math.round(this.world.x * k) / k, Math.round(this.world.y * k) / k);
  }

  private onDown = (e: PointerEvent): void => {
    if (!this.enabled) return;
    this.el.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, this.local(e));
    if (this.pointers.size === 2) this.pinchDist = this.pinchDistance();
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.enabled) return;
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const cur = this.local(e);
    if (this.pointers.size === 1) {
      if (!this.oneFingerPan && !(e.pointerType === 'mouse' && e.buttons & 6)) {
        this.pointers.set(e.pointerId, cur);
        return;
      }
      this.world.position.x += cur.x - prev.x;
      this.world.position.y += cur.y - prev.y;
      this.pointers.set(e.pointerId, cur);
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()] as [
        { x: number; y: number },
        { x: number; y: number },
      ];
      const midBefore = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.pointers.set(e.pointerId, cur);
      const [c, d] = [...this.pointers.values()] as [
        { x: number; y: number },
        { x: number; y: number },
      ];
      const midAfter = { x: (c.x + d.x) / 2, y: (c.y + d.y) / 2 };
      this.world.position.x += midAfter.x - midBefore.x;
      this.world.position.y += midAfter.y - midBefore.y;
      const dist = this.pinchDistance();
      if (this.pinchDist > 0 && dist > 0)
        this.zoomAt(midAfter.x, midAfter.y, dist / this.pinchDist);
      this.pinchDist = dist;
      this.pinchMid = midAfter;
    }
  };

  private onUp = (e: PointerEvent): void => {
    const wasPinch = this.pointers.size === 2;
    this.pointers.delete(e.pointerId);
    // Pinch is continuous while the fingers are down, then settles on the nearest zoom stop.
    if (wasPinch) {
      this.zoomAt(
        this.pinchMid.x,
        this.pinchMid.y,
        nearestStep(this.world.scale.x) / this.world.scale.x,
      );
    }
    if (this.pointers.size === 2) this.pinchDist = this.pinchDistance();
  };

  private pinchDistance(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
}
