import { PHEROMONE_RESOLUTION, PHEROMONE_TYPES } from '@ant/shared';
import type { PheromoneType } from '@ant/shared';

/** Per-layer tuning. Rates are per tick (fixed 20Hz), not per second. */
export interface PheromoneLayerConfig {
  /** Fraction of each cell's value lost per tick (0..1). 0.01 => ~3.5s half-life at 20Hz. */
  evaporation: number;
  /**
   * Diffusion strength per axis per tick (0..0.5). Each pass moves `diffusion/2` of a cell's
   * value to each neighbour, so the field is blurred by [d/2, 1-d, d/2] horizontally then vertically.
   */
  diffusion: number;
  /** Cell values are clamped to [0, max]. Also the full-scale value for `quantize`. */
  max: number;
}

export const DEFAULT_LAYER_CONFIG: Record<PheromoneType, PheromoneLayerConfig> = {
  food: { evaporation: 0.006, diffusion: 0.08, max: 1 },
  home: { evaporation: 0.01, diffusion: 0.05, max: 1 },
  alarm: { evaporation: 0.01, diffusion: 0.4, max: 1 },
  enemy: { evaporation: 0.01, diffusion: 0.1, max: 1 },
};

export interface PheromoneFieldOptions {
  /** World edge length in world units. */
  worldSize: number;
  /** Cells per edge. Default `PHEROMONE_RESOLUTION` (256). */
  resolution?: number;
  /** Layers to allocate. Default `['food', 'home']`. */
  types?: readonly PheromoneType[];
  /** Overrides merged over `DEFAULT_LAYER_CONFIG` per type. */
  layers?: Partial<Record<PheromoneType, Partial<PheromoneLayerConfig>>>;
  /**
   * Slow layers to update every other `update()` call with two ticks' worth of diffusion
   * and evaporation (variance and decay compound, so the field evolves at the same rate).
   * Halves their cost; their phases are staggered so the work is spread evenly. Requires
   * `2 * diffusion <= 1`. Default: none (every layer every call).
   */
  halfRate?: readonly PheromoneType[];
}

/** With evaporation on, values below this are snapped to 0 so trails fully disappear. */
const EPSILON = 1e-4;

export interface PheromoneFieldState {
  updates: number;
  /** One entry per `PHEROMONE_TYPES` slot; null where the type is not allocated. */
  layers: (Float32Array | null)[];
}

function rowEmpty(d: Float32Array, start: number, len: number): boolean {
  for (let i = start, end = start + len; i < end; i++) if (d[i] !== 0) return false;
  return true;
}

/**
 * Per-type scalar grids over the square world. Cell (cx, cy) covers world
 * `[cx*cellSize, (cx+1)*cellSize)` and is stored at `cy * resolution + cx`.
 *
 * Mutation (`deposit`, `update`, `clear`) happens only inside the sim worker.
 * Steering code reads via `sample` or, in hot loops, grabs `layer(type)` once
 * and indexes it directly. All methods are allocation-free except `quantize`
 * when no output buffer is passed.
 */
export class PheromoneField {
  readonly resolution: number;
  readonly worldSize: number;
  readonly cellSize: number;
  /** Allocated layers, in snapshot order. */
  readonly types: readonly PheromoneType[];
  readonly config: Record<PheromoneType, PheromoneLayerConfig>;
  private readonly data: (Float32Array | undefined)[] = [];
  private readonly scratch: Float32Array;
  private readonly invCell: number;
  /** Per layer id: 0 = every update, else updated when `(updates + phase) % 2 === 0`. */
  private readonly half: number[] = [];
  private updates = 0;
  /** Multiplies every layer's evaporation (weather); not saved, the weather re-applies it each tick. */
  evaporationScale = 1;

  constructor(opts: PheromoneFieldOptions) {
    this.worldSize = opts.worldSize;
    this.resolution = opts.resolution ?? PHEROMONE_RESOLUTION;
    this.cellSize = this.worldSize / this.resolution;
    this.invCell = 1 / this.cellSize;
    this.types = opts.types ?? ['food', 'home'];
    this.config = {} as Record<PheromoneType, PheromoneLayerConfig>;
    for (const t of PHEROMONE_TYPES) {
      this.config[t] = { ...DEFAULT_LAYER_CONFIG[t], ...opts.layers?.[t] };
    }
    const n = this.resolution * this.resolution;
    for (const t of this.types) this.data[PHEROMONE_TYPES.indexOf(t)] = new Float32Array(n);
    let phase = 0;
    for (const t of opts.halfRate ?? []) {
      const id = PHEROMONE_TYPES.indexOf(t);
      if (!this.data[id] || this.config[t].diffusion * 2 > 1) continue;
      this.half[id] = 1 + (phase++ % 2);
    }
    this.scratch = new Float32Array(n);
  }

  has(type: PheromoneType): boolean {
    return this.data[PHEROMONE_TYPES.indexOf(type)] !== undefined;
  }

  /**
   * Raw row-major grid for a type (`resolution * resolution`, index `cy * resolution + cx`).
   * Live view, not a copy: do not write to it from outside the sim step.
   */
  layer(type: PheromoneType): Float32Array {
    const d = this.data[PHEROMONE_TYPES.indexOf(type)];
    if (!d) throw new Error(`pheromone layer not allocated: ${type}`);
    return d;
  }

  /** Adds `amount` to the cell containing world point (x, y), clamped to the layer max. Out-of-world points are ignored. */
  deposit(type: PheromoneType, x: number, y: number, amount: number): void {
    const cx = Math.floor(x * this.invCell);
    const cy = Math.floor(y * this.invCell);
    const res = this.resolution;
    if (cx < 0 || cy < 0 || cx >= res || cy >= res) return;
    const d = this.layer(type);
    const i = cy * res + cx;
    const max = this.config[type].max;
    const v = d[i]! + amount;
    d[i] = v > max ? max : v < 0 ? 0 : v;
  }

  /**
   * Bilinear sample at world point (x, y), interpolating between cell centres.
   * Points outside the world are clamped to the nearest edge. Returns 0 for
   * layers that are not allocated.
   */
  sample(type: PheromoneType, x: number, y: number): number {
    const d = this.data[PHEROMONE_TYPES.indexOf(type)];
    if (!d) return 0;
    const res = this.resolution;
    const last = res - 1;
    // Cell centres sit at (i + 0.5) * cellSize.
    let fx = x * this.invCell - 0.5;
    let fy = y * this.invCell - 0.5;
    fx = fx < 0 ? 0 : fx > last ? last : fx;
    fy = fy < 0 ? 0 : fy > last ? last : fy;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = x0 < last ? x0 + 1 : x0;
    const y1 = y0 < last ? y0 + 1 : y0;
    const tx = fx - x0;
    const ty = fy - y0;
    const r0 = y0 * res;
    const r1 = y1 * res;
    const top = d[r0 + x0]! + (d[r0 + x1]! - d[r0 + x0]!) * tx;
    const bot = d[r1 + x0]! + (d[r1 + x1]! - d[r1 + x0]!) * tx;
    return top + (bot - top) * ty;
  }

  /**
   * One tick: separable diffusion then evaporation, per allocated layer (`halfRate`
   * layers every other call, two ticks at once).
   * Diffusion uses reflecting (zero-flux) borders, so it conserves total mass;
   * only evaporation (and the `max` clamp on deposit) removes it.
   */
  update(): void {
    const u = this.updates++;
    for (let t = 0; t < this.data.length; t++) {
      const d = this.data[t];
      if (!d) continue;
      const cfg = this.config[PHEROMONE_TYPES[t]!];
      const half = this.half[t];
      const evaporation = Math.min(1, cfg.evaporation * this.evaporationScale);
      if (!half) {
        this.blurAndEvaporate(d, cfg.diffusion, 1 - evaporation);
      } else if ((u + half) % 2 === 0) {
        const keep = 1 - evaporation;
        this.blurAndEvaporate(d, cfg.diffusion * 2, keep * keep);
      }
    }
  }

  /**
   * Rows that are entirely zero stay zero except where diffusion reaches them from a
   * neighbouring row, so only the band `[first nonzero row - 1, last nonzero row + 1]` is
   * processed. Sparse layers (alarm, enemy scent, small trails) cost little more than the
   * row scan; an empty layer is skipped outright.
   */
  private blurAndEvaporate(d: Float32Array, diffusion: number, keep: number): void {
    const res = this.resolution;
    const last = res - 1;
    let r0 = 0;
    while (r0 < res && rowEmpty(d, r0 * res, res)) r0++;
    if (r0 === res) return;
    let r1 = last;
    while (r1 > r0 && rowEmpty(d, r1 * res, res)) r1--;
    // Rows written by the vertical pass, and the tmp rows it reads.
    const v0 = r0 > 0 ? r0 - 1 : 0;
    const v1 = r1 < last ? r1 + 1 : last;
    const h0 = v0 > 0 ? v0 - 1 : 0;
    const h1 = v1 < last ? v1 + 1 : last;
    const tmp = this.scratch;
    const side = diffusion * 0.5;
    const center = 1 - diffusion;
    // Horizontal pass: d -> tmp
    for (let y = h0; y <= h1; y++) {
      const row = y * res;
      let left = d[row]!;
      let cur = left;
      for (let x = 0; x < res - 1; x++) {
        const right = d[row + x + 1]!;
        tmp[row + x] = center * cur + side * (left + right);
        left = cur;
        cur = right;
      }
      tmp[row + res - 1] = center * cur + side * (left + cur);
    }
    // Vertical pass with evaporation: tmp -> d
    // Only snap tiny values to 0 when evaporating, so pure diffusion conserves mass.
    const eps = keep < 1 ? EPSILON : 0;
    for (let y = v0; y <= v1; y++) {
      const up = (y > 0 ? y - 1 : 0) * res;
      const mid = y * res;
      const down = (y < last ? y + 1 : last) * res;
      for (let x = 0; x < res; x++) {
        const v = (center * tmp[mid + x]! + side * (tmp[up + x]! + tmp[down + x]!)) * keep;
        d[mid + x] = v < eps ? 0 : v;
      }
    }
  }

  /** Exact copy of every layer plus the half-rate phase counter. */
  getState(): PheromoneFieldState {
    return { updates: this.updates, layers: this.data.map((d) => d?.slice() ?? null) };
  }

  setState(s: PheromoneFieldState): void {
    if (s.layers.length !== this.data.length) throw new Error('pheromone layer count mismatch');
    s.layers.forEach((l, t) => {
      const d = this.data[t];
      if (!d !== !l) throw new Error('pheromone layer set mismatch');
      if (d && l) d.set(l);
    });
    this.updates = s.updates;
  }

  /** Zeroes one layer, or all layers when `type` is omitted. */
  clear(type?: PheromoneType): void {
    if (type) {
      this.layer(type).fill(0);
      return;
    }
    for (const d of this.data) d?.fill(0);
  }

  /** Sum of all cells in a layer (diagnostics / tests). */
  total(type: PheromoneType): number {
    const d = this.layer(type);
    let s = 0;
    for (let i = 0; i < d.length; i++) s += d[i]!;
    return s;
  }

  /**
   * Writes all allocated layers as bytes into `out` (layer-major, in `types`
   * order; length `types.length * resolution^2`). Each byte is
   * `round(255 * sqrt(value / max))` so faint trails stay visible.
   * Allocates a fresh buffer when `out` is omitted.
   */
  quantize(out?: Uint8Array): Uint8Array {
    const n = this.resolution * this.resolution;
    const buf = out ?? new Uint8Array(n * this.types.length);
    for (let l = 0; l < this.types.length; l++) {
      const type = this.types[l]!;
      const d = this.layer(type);
      const scale = 1 / this.config[type].max;
      const base = l * n;
      for (let i = 0; i < n; i++) {
        const v = d[i]! * scale;
        buf[base + i] = v >= 1 ? 255 : (Math.sqrt(v) * 255 + 0.5) | 0;
      }
    }
    return buf;
  }
}
