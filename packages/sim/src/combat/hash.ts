import { NEST_GRID_H, NEST_GRID_W, NEST_TILE } from '@ant/shared';
import type { AntStore } from '../ants/store';

/** Cell edge in world units. Must be >= the largest engage range (3x3 cells are scanned). */
export const HASH_CELL = 32;

/**
 * Uniform-grid spatial hash over every space ants live in: the surface plus one region per
 * colony nest (underground coordinates are per nest). Rebuilt from scratch every tick with
 * a counting sort, so it is allocation-free and deterministic: bucket order is ant index
 * order.
 *
 * Buckets are keyed by `(cell, colony)`, so a query for "enemies near me" walks only the
 * other colonies' ants in the 3x3 cells around a point and skips its own colony's crowd
 * entirely. `mask[cell]` has bit c set when colony c has an ant in the cell, so "is any
 * enemy near?" is nine byte reads.
 */
export class SpatialHash {
  readonly surfCols: number;
  readonly nestCols: number;
  readonly nestRows: number;
  private readonly surfCells: number;
  private readonly nestCells: number;
  private readonly buckets: number;
  /** Per cell: bit c set if colony c has an ant there. */
  readonly mask: Uint8Array;
  /** Bucket b holds `items[start[b] .. start[b + 1])`. */
  readonly start: Int32Array;
  private readonly cursor: Int32Array;
  readonly items: Int32Array;
  /** Per ant: its bucket (`cell * colonies + colony`). */
  private readonly antBucket: Int32Array;

  constructor(
    worldSize: number,
    readonly colonies: number,
    capacity: number,
  ) {
    this.surfCols = Math.max(1, Math.ceil(worldSize / HASH_CELL));
    this.surfCells = this.surfCols * this.surfCols;
    this.nestCols = Math.ceil((NEST_GRID_W * NEST_TILE) / HASH_CELL);
    this.nestRows = Math.ceil((NEST_GRID_H * NEST_TILE) / HASH_CELL);
    this.nestCells = this.nestCols * this.nestRows;
    this.buckets = (this.surfCells + colonies * this.nestCells) * colonies;
    this.mask = new Uint8Array(this.surfCells + colonies * this.nestCells);
    this.start = new Int32Array(this.buckets + 1);
    this.cursor = new Int32Array(this.buckets);
    this.items = new Int32Array(capacity);
    this.antBucket = new Int32Array(capacity);
  }

  /** Columns / rows of the space an ant on `layer` lives in. */
  cols(layer: number): number {
    return layer === 0 ? this.surfCols : this.nestCols;
  }
  rows(layer: number): number {
    return layer === 0 ? this.surfCols : this.nestRows;
  }

  /** First cell index of the space for `layer` (0 surface, 1 + c nest of colony c). */
  base(layer: number): number {
    return layer === 0 ? 0 : this.surfCells + (layer - 1) * this.nestCells;
  }

  /** Clamped cell coordinate along one axis. */
  static coord(v: number, n: number): number {
    const c = Math.floor(v / HASH_CELL);
    return c < 0 ? 0 : c >= n ? n - 1 : c;
  }

  build(ants: AntStore): void {
    const { start, cursor, items, antBucket, mask } = this;
    const nc = this.colonies;
    const { x, y, layer, colony } = ants;
    start.fill(0);
    mask.fill(0);
    for (let i = 0; i < ants.count; i++) {
      const l = layer[i]!;
      const cols = l === 0 ? this.surfCols : this.nestCols;
      const rows = l === 0 ? this.surfCols : this.nestRows;
      const cx = SpatialHash.coord(x[i]!, cols);
      const cy = SpatialHash.coord(y[i]!, rows);
      const cell = this.base(l) + cy * cols + cx;
      const c = colony[i]!;
      const b = cell * nc + c;
      mask[cell]! |= 1 << c;
      antBucket[i] = b;
      start[b + 1]!++;
    }
    for (let b = 0; b < this.buckets; b++) start[b + 1]! += start[b]!;
    cursor.set(start.subarray(0, this.buckets));
    for (let i = 0; i < ants.count; i++) items[cursor[antBucket[i]!]!++] = i;
  }
}
