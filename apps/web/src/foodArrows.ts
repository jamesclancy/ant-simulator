/** Where the pickup reach ends, world units (mirrors the sim's `PLAYER_PICKUP_REACH`). */
export const PICKUP_REACH = 14;

const POOL = 5;
/** Arrow half-size plus a margin, so an arrow never touches a bar or the screen edge. */
const PAD = 22;

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
    const area = this.playArea(size);
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
      const hw = dx < 0 ? cx - area.left : area.right - cx;
      const hh = dy < 0 ? cy - area.top : area.bottom - cy;
      const t = Math.min(hw / Math.max(1e-6, Math.abs(dx)), hh / Math.max(1e-6, Math.abs(dy)));
      let x = cx + dx * t;
      const y = cy + dy * t;
      // On phones the joystick floats over the left edge: slide arrows out from under it.
      const j = area.joystick;
      if (j && x < j.right && y > j.top && y < j.bottom) x = j.right;
      a.hidden = false;
      a.style.transform = `translate(${x}px, ${y}px) rotate(${Math.atan2(dy, dx)}rad)`;
    }
  }

  /**
   * The part of the viewport not covered by the HUD bars (measured, so it follows the UI scale,
   * safe-area insets, wrapped bars on phones and orientation), the arrow's own margin inside it.
   */
  private playArea(size: { w: number; h: number }): {
    left: number;
    right: number;
    top: number;
    bottom: number;
    joystick: { right: number; top: number; bottom: number } | null;
  } {
    const box = (sel: string): DOMRect | null => {
      const el = document.querySelector(sel);
      if (!el || el.getClientRects().length === 0) return null;
      return el.getBoundingClientRect();
    };
    const top = box('#player-hud .bar');
    const bottom = box('#hud .bar');
    const stick = box('#joystick');
    // The root pads itself by the safe-area insets (see style.css), so read them back resolved.
    const pad = getComputedStyle(this.root);
    const edge = (side: 'Top' | 'Right' | 'Bottom' | 'Left'): number =>
      parseFloat(pad[`padding${side}`]) || 0;
    return {
      left: PAD + edge('Left'),
      right: size.w - PAD - edge('Right'),
      top: Math.max(PAD + edge('Top'), top ? top.bottom + PAD : 0),
      bottom: Math.min(size.h - PAD - edge('Bottom'), bottom ? bottom.top - PAD : size.h),
      joystick: stick
        ? { right: stick.right + PAD, top: stick.top - PAD, bottom: stick.bottom + PAD }
        : null,
    };
  }

  private hide(from: number): void {
    for (let i = from; i < this.arrows.length; i++) this.arrows[i]!.hidden = true;
  }
}
