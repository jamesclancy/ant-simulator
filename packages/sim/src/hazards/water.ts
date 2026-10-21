import type { NestGrid } from '../underground/grid';

/** Levels below this are snapped to dry. */
const DRY = 0.004;

export interface WaterState {
  levels: Float32Array;
  version: number;
}

/**
 * Water in one nest: a level 0..1 per tile (only open tiles hold water), same layout as the
 * `NestGrid`. Rain pours in at the entrance tile; each tick neighbouring open tiles exchange
 * water (a little faster downhill than uphill), a fraction seeps into the soil and, once the
 * rain has stopped, a fixed amount drains away. The front therefore creeps down the shaft
 * and thins out with distance from the entrance: deep or distant chambers stay dry.
 */
export class Water {
  readonly levels: Float32Array;
  private readonly delta: Float32Array;
  /** Bumps whenever the levels change (and once more when they dry out). */
  version = 0;
  /** Tiles holding water after the last step. */
  wet = 0;

  constructor(private readonly grid: NestGrid) {
    this.levels = new Float32Array(grid.size);
    this.delta = new Float32Array(grid.size);
  }

  /** Level on the tile at flat index `i`. */
  at(i: number): number {
    return this.levels[i]!;
  }

  /**
   * One tick. `inflow` is the water added at the entrance this tick, `loss` the constant
   * amount drained from every wet tile.
   */
  step(inflow: number, flow: number, seep: number, loss: number): void {
    const lv = this.levels;
    const g = this.grid;
    if (inflow > 0) {
      const e = g.entranceIndex;
      lv[e] = Math.min(1, lv[e]! + inflow);
      if (this.wet === 0) this.wet = 1;
    }
    if (this.wet === 0) return;
    const w = g.width;
    const h = g.height;
    const d = this.delta;
    const tiles = g.tiles;
    d.fill(0);
    const side = flow;
    const down = flow * 1.2;
    const up = flow * 0.6;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const t = tiles[i]!;
        if (t !== 1 && t !== 2) continue;
        const a = lv[i]!;
        if (x < w - 1) {
          const r = i + 1;
          const tr = tiles[r]!;
          if (tr === 1 || tr === 2) {
            const f = (a - lv[r]!) * side;
            d[i]! -= f;
            d[r]! += f;
          }
        }
        if (y < h - 1) {
          const b = i + w;
          const tb = tiles[b]!;
          if (tb === 1 || tb === 2) {
            const diff = a - lv[b]!;
            const f = diff * (diff > 0 ? down : up);
            d[i]! -= f;
            d[b]! += f;
          }
        }
      }
    }
    let wet = 0;
    const keep = 1 - seep;
    for (let i = 0; i < lv.length; i++) {
      const t = tiles[i]!;
      if (t !== 1 && t !== 2) {
        lv[i] = 0;
        continue;
      }
      let v = (lv[i]! + d[i]!) * keep - (lv[i]! > 0 ? loss : 0);
      if (v < DRY) v = 0;
      else if (v > 1) v = 1;
      lv[i] = v;
      if (v > 0) wet++;
    }
    this.version++;
    this.wet = wet;
  }

  /** Dry the whole nest. */
  clear(): void {
    this.levels.fill(0);
    this.wet = 0;
    this.version++;
  }

  /** Levels as bytes for a snapshot. */
  pack(out = new Uint8Array(this.levels.length)): Uint8Array {
    const lv = this.levels;
    for (let i = 0; i < lv.length; i++) out[i] = Math.round(lv[i]! * 255);
    return out;
  }

  getState(): WaterState {
    return { levels: this.levels.slice(), version: this.version };
  }

  setState(s: WaterState): void {
    this.levels.set(s.levels);
    this.version = s.version;
    let wet = 0;
    for (let i = 0; i < this.levels.length; i++) if (this.levels[i]! > 0) wet++;
    this.wet = wet;
  }
}
