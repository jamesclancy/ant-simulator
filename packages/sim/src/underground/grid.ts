import { ChamberKind, NEST_GRID_H, NEST_GRID_W, TileType } from '@ant/shared';
import type { Rng } from '../rng';

/**
 * Side-view tile grid of one nest. Row 0 is the surface line (`Air`, except the single
 * `Tunnel` entrance tile); rows grow downward. Tiles are `TileType`s; `Chamber` tiles also
 * carry a `ChamberKind`. `version` bumps on every change so snapshots can send the grid
 * only when it differs.
 */
export class NestGrid {
  readonly tiles: Uint8Array;
  readonly kinds: Uint8Array;
  version = 1;
  /** Tiles where Tunnel/Chamber (walkable). */
  openCount = 0;
  /** Queen + Nursery chamber tiles (brood capacity). */
  nurseryCount = 0;
  /** Flat indices of Queen/Nursery tiles, rebuilt on change (used to place brood). */
  nurseryTiles: number[] = [];
  foodTiles: number[] = [];
  /** Flat indices of Queen chamber tiles (raid target). */
  queenTiles: number[] = [];

  constructor(
    readonly width = NEST_GRID_W,
    readonly height = NEST_GRID_H,
    readonly entranceX = NEST_GRID_W >> 1,
  ) {
    this.tiles = new Uint8Array(width * height);
    this.kinds = new Uint8Array(width * height);
  }

  get size(): number {
    return this.tiles.length;
  }

  idx(x: number, y: number): number {
    return y * this.width + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  get entranceIndex(): number {
    return this.entranceX;
  }

  isOpenIndex(i: number): boolean {
    const t = this.tiles[i]!;
    return t === TileType.Tunnel || t === TileType.Chamber;
  }

  isOpen(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.isOpenIndex(y * this.width + x);
  }

  /** Set a tile (and chamber kind); bumps `version` when anything changed. */
  set(i: number, type: TileType, kind: ChamberKind = ChamberKind.None): void {
    if (this.tiles[i] === type && this.kinds[i] === kind) return;
    this.tiles[i] = type;
    this.kinds[i] = kind;
    this.version++;
  }

  /** Recount derived data. Call after a batch of `set`s (generate / dig). */
  refresh(): void {
    let open = 0;
    this.nurseryTiles = [];
    this.foodTiles = [];
    this.queenTiles = [];
    for (let i = 0; i < this.tiles.length; i++) {
      const t = this.tiles[i]!;
      if (t !== TileType.Tunnel && t !== TileType.Chamber) continue;
      open++;
      const k = this.kinds[i]!;
      if (k === ChamberKind.Queen || k === ChamberKind.Nursery) this.nurseryTiles.push(i);
      if (k === ChamberKind.Queen) this.queenTiles.push(i);
      else if (k === ChamberKind.Food) this.foodTiles.push(i);
    }
    this.openCount = open;
    this.nurseryCount = this.nurseryTiles.length;
  }

  /** Packed cells for snapshots: `type | kind << 3`. */
  pack(out = new Uint8Array(this.tiles.length)): Uint8Array {
    for (let i = 0; i < out.length; i++) out[i] = this.tiles[i]! | (this.kinds[i]! << 3);
    return out;
  }

  fillRect(x0: number, y0: number, w: number, h: number, type: TileType, kind: ChamberKind): void {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) this.set(this.idx(x, y), type, kind);
    }
  }

  /**
   * Fresh nest: soil with a seeded rock scatter, an entrance shaft from the surface, a
   * queen chamber at its foot and a small food store and nursery either side of the shaft.
   * Draws only from `rng`, so the layout is deterministic per seed.
   */
  generate(rng: Rng): void {
    const { width: w, height: h, entranceX: ex } = this;
    this.tiles.fill(TileType.Soil);
    this.kinds.fill(0);
    this.tiles.fill(TileType.Air, 0, w);
    // Rock: scattered single stones plus a few small clumps, never near the starter nest.
    const clear = (x: number, y: number): boolean => Math.abs(x - ex) <= 10 && y <= 14;
    const stones = Math.floor(w * h * 0.012);
    for (let n = 0; n < stones; n++) {
      const cx = rng.int(w);
      const cy = 3 + rng.int(h - 3);
      const r = rng.next() < 0.3 ? 2 : 1;
      for (let dy = -r + 1; dy < r; dy++) {
        for (let dx = -r + 1; dx < r; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x > 0 && x < w - 1 && y > 2 && y < h - 1 && !clear(x, y)) {
            this.tiles[y * w + x] = TileType.Rock;
          }
        }
      }
    }
    // Starter nest.
    for (let y = 0; y <= 7; y++) this.tiles[y * w + ex] = TileType.Tunnel;
    this.fillRect(ex - 3, 8, 7, 3, TileType.Chamber, ChamberKind.Queen);
    this.fillRect(ex + 1, 4, 2, 1, TileType.Tunnel, ChamberKind.None);
    this.fillRect(ex + 3, 3, 4, 3, TileType.Chamber, ChamberKind.Food);
    this.fillRect(ex - 2, 4, 2, 1, TileType.Tunnel, ChamberKind.None);
    this.fillRect(ex - 6, 3, 4, 3, TileType.Chamber, ChamberKind.Nursery);
    this.refresh();
    this.version++;
  }
}
