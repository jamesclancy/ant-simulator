/** Where the pickup reach ends, world units (mirrors the sim's `PLAYER_PICKUP_REACH`). */
export const PICKUP_REACH = 14;

const POOL = 5;
/** Keep arrows clear of the HUD bars along the top and bottom edges. */
const INSET = { x: 18, top: 84, bottom: 78 };

/**
 * Small edge-of-screen arrows pointing at known food piles that are out of view but near it.
 * Plain DOM (a handful of absolutely positioned triangles), so it costs nothing on the GPU.
 */
export class FoodArrows {
  private readonly root = document.createElement('div');
  private readonly arrows: HTMLElement[] = [];
  private on = true;

  constructor(host: HTMLElement) {
    this.root.className = 'food-arrows';
    this.root.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < POOL; i++) {
      const a = document.createElement('div');
      a.className = 'food-arrow';
      a.hidden = true;
      this.root.append(a);
      this.arrows.push(a);
    }
    host.append(this.root);
  }

  setEnabled(on: boolean): void {
    this.on = on;
    if (!on) this.hide(0);
  }

  /**
   * `view` is the world container's offset and scale; `size` the viewport in CSS px. Piles
   * already on screen, or farther than about two screens away, get no arrow.
   */
  update(
    piles: readonly { x: number; y: number }[],
    view: { x: number; y: number; zoom: number },
    size: { w: number; h: number },
    show: boolean,
  ): void {
    if (!this.on || !show) return this.hide(0);
    const cx = size.w / 2;
    const cy = size.h / 2;
    const reach = Math.max(size.w, size.h) * 1.5;
    const found: { sx: number; sy: number; d: number }[] = [];
    for (const p of piles) {
      const sx = p.x * view.zoom + view.x;
      const sy = p.y * view.zoom + view.y;
      const onScreen = sx > 0 && sx < size.w && sy > 0 && sy < size.h;
      const d = Math.hypot(sx - cx, sy - cy);
      if (!onScreen && d < reach) found.push({ sx, sy, d });
    }
    found.sort((a, b) => a.d - b.d);
    for (let i = 0; i < POOL; i++) {
      const a = this.arrows[i]!;
      const f = found[i];
      if (!f) {
        a.hidden = true;
        continue;
      }
      const dx = f.sx - cx;
      const dy = f.sy - cy;
      const hw = cx - INSET.x;
      const hh = dy < 0 ? cy - INSET.top : cy - INSET.bottom;
      const t = Math.min(hw / Math.max(1e-6, Math.abs(dx)), hh / Math.max(1e-6, Math.abs(dy)));
      a.hidden = false;
      a.style.transform = `translate(${cx + dx * t}px, ${cy + dy * t}px) rotate(${Math.atan2(dy, dx)}rad)`;
    }
  }

  private hide(from: number): void {
    for (let i = from; i < this.arrows.length; i++) this.arrows[i]!.hidden = true;
  }
}
