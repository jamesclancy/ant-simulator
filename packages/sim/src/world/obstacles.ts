/** A rock: an impassable disc on the surface. */
export interface Obstacle {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export interface ObstacleFieldState {
  nextId: number;
  items: Obstacle[];
}

export const MIN_OBSTACLE_RADIUS = 6;
export const MAX_OBSTACLE_RADIUS = 120;
/** Blocking grid cells per world edge: coarse on purpose, one byte lookup per ant move. */
const GRID = 256;

/** Output slot for `slide` (keeps the hot path allocation-free). */
export const slid = { x: 0, y: 0 };

/**
 * Surface rocks. Discs are rasterised into a coarse `Uint8Array` so the per-ant test is a
 * single lookup, and `count === 0` lets callers skip the work entirely. Ants steer away
 * from rocks (`avoid`) and, failing that, slide along them (`slide`); anything already
 * inside a blocked cell may walk out. Deterministic: no rng, ids are sequential.
 */
export class ObstacleField {
  private items: Obstacle[] = [];
  private nextId = 1;
  /** Bumps on every change, so snapshots can send the list only when needed. Not saved. */
  version = 0;
  private readonly grid = new Uint8Array(GRID * GRID);
  private readonly inv: number;
  private readonly cell: number;

  constructor(private readonly worldSize: number) {
    this.cell = worldSize / GRID;
    this.inv = GRID / worldSize;
  }

  get count(): number {
    return this.items.length;
  }

  list(): readonly Obstacle[] {
    return this.items;
  }

  /** Rock centred on (x, y); radius clamped to the allowed range. Returns its id. */
  add(x: number, y: number, radius: number): number {
    const r = Math.min(MAX_OBSTACLE_RADIUS, Math.max(MIN_OBSTACLE_RADIUS, radius));
    const id = this.nextId++;
    const px = Math.min(this.worldSize, Math.max(0, x));
    const py = Math.min(this.worldSize, Math.max(0, y));
    this.items.push({ id, x: px, y: py, radius: r });
    this.stamp(px, py, r);
    this.version++;
    return id;
  }

  /** Remove every rock touching the disc at (x, y). Returns how many went. */
  removeNear(x: number, y: number, radius: number): number {
    const before = this.items.length;
    this.items = this.items.filter((o) => Math.hypot(o.x - x, o.y - y) > o.radius + radius);
    const removed = before - this.items.length;
    if (removed) {
      this.rebuild();
      this.version++;
    }
    return removed;
  }

  clear(): void {
    if (!this.items.length) return;
    this.items = [];
    this.grid.fill(0);
    this.version++;
  }

  /** Is the world point inside a rock? Points outside the world are not blocked. */
  blocked(x: number, y: number): boolean {
    const cx = (x * this.inv) | 0;
    const cy = (y * this.inv) | 0;
    if (x < 0 || y < 0 || cx >= GRID || cy >= GRID) return false;
    return this.grid[cy * GRID + cx] !== 0;
  }

  /** The rock containing the point, if any (exact test; used for pushing ants out). */
  rockAt(x: number, y: number): Obstacle | undefined {
    for (const o of this.items) if (Math.hypot(o.x - x, o.y - y) <= o.radius) return o;
    return undefined;
  }

  /**
   * Look `probe` units ahead of (x, y) along heading `h`; if that point is inside a rock,
   * return the nearest clear heading (alternating left/right, `side` picks which first so
   * a crowd does not all swerve the same way), else `h` unchanged.
   */
  avoid(x: number, y: number, h: number, probe: number, side: number): number {
    if (!this.blocked(x + Math.cos(h) * probe, y + Math.sin(h) * probe)) return h;
    const s = side & 1 ? 1 : -1;
    for (let k = 1; k <= 4; k++) {
      const d = k * 0.5 * s;
      if (!this.blocked(x + Math.cos(h + d) * probe, y + Math.sin(h + d) * probe)) return h + d;
      if (!this.blocked(x + Math.cos(h - d) * probe, y + Math.sin(h - d) * probe)) return h - d;
    }
    return h + Math.PI;
  }

  /**
   * Resolve a move from (x0, y0) to (nx, ny): the target if clear, else the part of the move
   * along one axis, else stay. Result in `slid`. A start in the margin around a rock may move anywhere except into the rock.
   */
  slide(x0: number, y0: number, nx: number, ny: number): void {
    if (!this.blocked(nx, ny) || (this.blocked(x0, y0) && this.mayLeave(x0, y0, nx, ny))) {
      slid.x = nx;
      slid.y = ny;
    } else if (!this.blocked(nx, y0)) {
      slid.x = nx;
      slid.y = y0;
    } else if (!this.blocked(x0, ny)) {
      slid.x = x0;
      slid.y = ny;
    } else {
      slid.x = x0;
      slid.y = y0;
    }
  }

  /**
   * From a blocked grid cell: the move is fine unless it walks into the exact disc (the grid
   * is a margin wider than the rocks), and an ant already inside a rock may go anywhere.
   */
  private mayLeave(x0: number, y0: number, nx: number, ny: number): boolean {
    return !this.rockAt(nx, ny) || this.rockAt(x0, y0) !== undefined;
  }

  getState(): ObstacleFieldState {
    return { nextId: this.nextId, items: this.items.map((o) => ({ ...o })) };
  }

  setState(s: ObstacleFieldState): void {
    this.items = s.items.map((o) => ({ ...o }));
    this.nextId = s.nextId;
    this.rebuild();
    this.version++;
  }

  private rebuild(): void {
    this.grid.fill(0);
    for (const o of this.items) this.stamp(o.x, o.y, o.radius);
  }

  private stamp(x: number, y: number, r: number): void {
    const c0 = Math.max(0, Math.floor((x - r) * this.inv) - 1);
    const c1 = Math.min(GRID - 1, Math.floor((x + r) * this.inv) + 1);
    const r0 = Math.max(0, Math.floor((y - r) * this.inv) - 1);
    const r1 = Math.min(GRID - 1, Math.floor((y + r) * this.inv) + 1);
    // Conservative: any cell the disc touches blocks, so nothing ever stands inside the disc.
    const reach = r + this.cell * Math.SQRT1_2;
    const r2 = reach * reach;
    for (let cy = r0; cy <= r1; cy++) {
      const dy = (cy + 0.5) * this.cell - y;
      for (let cx = c0; cx <= c1; cx++) {
        const dx = (cx + 0.5) * this.cell - x;
        if (dx * dx + dy * dy <= r2) this.grid[cy * GRID + cx] = 1;
      }
    }
  }
}
