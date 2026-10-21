import type { Container } from 'pixi.js';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;

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
    this.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
  };

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
    }
  };

  private onUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 2) this.pinchDist = this.pinchDistance();
  };

  private pinchDistance(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
}
