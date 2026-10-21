/** A pile of food on the surface. Radius is fixed at creation; `amount` shrinks as ants take it. */
export interface FoodSource {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  /** Pickup reach in world units (grows when food is merged in, see `addNear`). */
  radius: number;
  amount: number;
}

export interface FoodFieldState {
  nextId: number;
  sources: FoodSource[];
}

/** Largest radius a pile can have; bounds the grid search margin. */
export const MAX_FOOD_RADIUS = 40;
export const MIN_FOOD_RADIUS = 6;
const CELL = 64;

/** Pickup radius grows with the square root of the pile (area ~ amount). */
export function foodRadiusFor(amount: number): number {
  return Math.min(MAX_FOOD_RADIUS, Math.max(MIN_FOOD_RADIUS, Math.sqrt(amount) * 0.6));
}

/**
 * Food piles with a uniform-grid spatial lookup. Each pile is bucketed by its centre, so
 * queries scan only the few cells within `radius + MAX_FOOD_RADIUS` of the point.
 * Everything is deterministic: ids are sequential and iteration is in insertion order.
 */
export class FoodField {
  private sources = new Map<number, FoodSource>();
  private cells: number[][];
  private cols: number;
  private nextId = 1;

  constructor(private worldSize: number) {
    this.cols = Math.max(1, Math.ceil(worldSize / CELL));
    this.cells = Array.from({ length: this.cols * this.cols }, () => []);
  }

  /** Live piles in creation order. Do not mutate. */
  list(): IterableIterator<FoodSource> {
    return this.sources.values();
  }

  get size(): number {
    return this.sources.size;
  }

  get(id: number): FoodSource | undefined {
    return this.sources.get(id);
  }

  /** Add a pile (position clamped to the world). Returns its id, or -1 if amount <= 0. */
  add(x: number, y: number, amount: number): number {
    if (!(amount > 0)) return -1;
    const px = Math.min(this.worldSize, Math.max(0, x));
    const py = Math.min(this.worldSize, Math.max(0, y));
    const id = this.nextId++;
    this.sources.set(id, { id, x: px, y: py, radius: foodRadiusFor(amount), amount });
    this.cells[this.cellIndex(px, py)]!.push(id);
    return id;
  }

  /**
   * Add food to the nearest pile whose centre is within `mergeRadius` of (x, y), or start a
   * new pile there. Keeps corpse food from turning a battlefield into hundreds of piles.
   */
  addNear(x: number, y: number, amount: number, mergeRadius: number): number {
    if (!(amount > 0)) return -1;
    const id = this.findFoodNear(x, y, mergeRadius);
    const s = id >= 0 ? this.sources.get(id)! : undefined;
    if (!s || Math.hypot(s.x - x, s.y - y) > mergeRadius) return this.add(x, y, amount);
    s.amount += amount;
    s.radius = Math.max(s.radius, foodRadiusFor(s.amount));
    return id;
  }

  /** Remove a pile outright. Returns whether it existed. */
  remove(id: number): boolean {
    const s = this.sources.get(id);
    if (!s) return false;
    this.sources.delete(id);
    const bucket = this.cells[this.cellIndex(s.x, s.y)]!;
    bucket.splice(bucket.indexOf(id), 1);
    return true;
  }

  /**
   * Id of the nearest pile whose edge is within `radius` of (x, y), or -1.
   * `radius = 0` means "standing on a pile". Ties break towards the lower id.
   */
  findFoodNear(x: number, y: number, radius: number): number {
    if (this.sources.size === 0) return -1;
    const reach = radius + MAX_FOOD_RADIUS;
    const c0 = Math.max(0, Math.floor((x - reach) / CELL));
    const c1 = Math.min(this.cols - 1, Math.floor((x + reach) / CELL));
    const r0 = Math.max(0, Math.floor((y - reach) / CELL));
    const r1 = Math.min(this.cols - 1, Math.floor((y + reach) / CELL));
    let best = -1;
    let bestGap = Infinity;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        for (const id of this.cells[r * this.cols + c]!) {
          const s = this.sources.get(id)!;
          const gap = Math.hypot(s.x - x, s.y - y) - s.radius;
          if (gap <= radius && (gap < bestGap || (gap === bestGap && id < best))) {
            best = id;
            bestGap = gap;
          }
        }
      }
    }
    return best;
  }

  /** Take up to `amount` from a pile; the pile is removed when emptied. Returns the amount taken. */
  takeFood(id: number, amount: number): number {
    const s = this.sources.get(id);
    if (!s || !(amount > 0)) return 0;
    const taken = Math.min(s.amount, amount);
    s.amount -= taken;
    if (s.amount <= 0) this.remove(id);
    return taken;
  }

  getState(): FoodFieldState {
    return { nextId: this.nextId, sources: [...this.sources.values()].map((s) => ({ ...s })) };
  }

  /** Rebuilds the id map and grid buckets; piles keep their creation order (= id order). */
  setState(s: FoodFieldState): void {
    this.sources.clear();
    for (const b of this.cells) b.length = 0;
    for (const src of s.sources) {
      this.sources.set(src.id, { ...src });
      this.cells[this.cellIndex(src.x, src.y)]!.push(src.id);
    }
    this.nextId = s.nextId;
  }

  private cellIndex(x: number, y: number): number {
    const c = Math.min(this.cols - 1, Math.floor(x / CELL));
    const r = Math.min(this.cols - 1, Math.floor(y / CELL));
    return r * this.cols + c;
  }
}
