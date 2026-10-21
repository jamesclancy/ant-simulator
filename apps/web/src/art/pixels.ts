/** Colours are 0xRRGGBB; `CLEAR` marks a transparent pixel in a `Px`. */
export const CLEAR = -1;

/** Deterministic hash in [0, 1) for tile/decor variation (no RNG state to carry around). */
export function hash2(x: number, y: number, salt = 0): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(salt | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Small seeded generator (mulberry32) for decor scatter. */
export function rng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rgb = (c: number): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
export const pack = (r: number, g: number, b: number): number =>
  (clamp8(r) << 16) | (clamp8(g) << 8) | clamp8(b);
const clamp8 = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));

export function mix(a: number, b: number, t: number): number {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  return pack(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}
export const lighten = (c: number, t: number): number => mix(c, 0xffffff, t);
export const darken = (c: number, t: number): number => mix(c, 0x000000, t);

/** A small RGBA pixel buffer with the handful of drawing primitives the sprite generators need. */
export class Px {
  readonly data: Int32Array;
  /** Per-pixel alpha (255 = opaque); only meaningful where `data` is not `CLEAR`. */
  readonly alpha: Uint8Array;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Int32Array(w * h).fill(CLEAR);
    this.alpha = new Uint8Array(w * h).fill(255);
  }

  get(x: number, y: number): number {
    return x < 0 || y < 0 || x >= this.w || y >= this.h ? CLEAR : this.data[y * this.w + x]!;
  }

  set(x: number, y: number, c: number): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.data[y * this.w + x] = c;
    this.alpha[y * this.w + x] = 255;
  }

  /** Set a translucent pixel (alpha 0..255). */
  setA(x: number, y: number, c: number, a: number): void {
    this.set(x, y, c);
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.alpha[y * this.w + x] = a;
  }

  /** Paint only where nothing is drawn yet. */
  under(x: number, y: number, c: number): void {
    if (this.get(Math.round(x), Math.round(y)) === CLEAR) this.set(x, y, c);
  }

  rect(x: number, y: number, w: number, h: number, c: number): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }

  fill(c: number): void {
    this.data.fill(c);
  }

  /** Filled ellipse by pixel-centre distance; `fn` picks each pixel's colour (null = skip). */
  ellipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    c: number | ((x: number, y: number, u: number, v: number) => number | null),
  ): void {
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        const u = (x - cx) / rx;
        const v = (y - cy) / ry;
        if (u * u + v * v > 1) continue;
        const col = typeof c === 'number' ? c : c(x, y, u, v);
        if (col !== null) this.set(x, y, col);
      }
    }
  }

  /** Bresenham line. */
  line(x0: number, y0: number, x1: number, y1: number, c: number): void {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  /** Draw `src` with its top-left at (dx, dy); transparent pixels are skipped. */
  blit(src: Px, dx: number, dy: number): void {
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const c = src.data[y * src.w + x]!;
        if (c !== CLEAR) this.setA(dx + x, dy + y, c, src.alpha[y * src.w + x]!);
      }
    }
  }

  /** Add a 1-px ring of `color` around everything already drawn (4-neighbourhood, or 8 if `diag`). */
  outline(color: number, diag = false): void {
    const add: number[] = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.data[y * this.w + x] !== CLEAR) continue;
        if (
          this.get(x - 1, y) !== CLEAR ||
          this.get(x + 1, y) !== CLEAR ||
          this.get(x, y - 1) !== CLEAR ||
          this.get(x, y + 1) !== CLEAR ||
          (diag &&
            (this.get(x - 1, y - 1) !== CLEAR ||
              this.get(x + 1, y - 1) !== CLEAR ||
              this.get(x - 1, y + 1) !== CLEAR ||
              this.get(x + 1, y + 1) !== CLEAR))
        )
          add.push(y * this.w + x);
      }
    }
    for (const i of add) this.data[i] = color;
  }

  /** Light from the top-left: tint exposed top/left edges lighter and bottom/right edges darker. */
  bevel(hi: number, lo: number, only?: number): void {
    const src = this.data.slice();
    const at = (x: number, y: number): number =>
      x < 0 || y < 0 || x >= this.w || y >= this.h ? CLEAR : src[y * this.w + x]!;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const c = at(x, y);
        if (c === CLEAR || (only !== undefined && c !== only)) continue;
        if (at(x, y - 1) === CLEAR || at(x - 1, y) === CLEAR) this.data[y * this.w + x] = hi;
        else if (at(x, y + 1) === CLEAR || at(x + 1, y) === CLEAR) this.data[y * this.w + x] = lo;
      }
    }
  }

  /** Parse an ASCII picture: '.' or ' ' is transparent, other characters index `legend`. */
  static fromGrid(rows: readonly string[], legend: Readonly<Record<string, number>>): Px {
    const w = Math.max(...rows.map((r) => r.length));
    const px = new Px(w, rows.length);
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const ch = row[x]!;
        if (ch === '.' || ch === ' ') continue;
        const c = legend[ch];
        if (c === undefined) throw new Error(`unknown pixel '${ch}'`);
        px.set(x, y, c);
      }
    });
    return px;
  }

  /** RGBA bytes for `ImageData`. */
  toRgba(): Uint8ClampedArray<ArrayBuffer> {
    const out = new Uint8ClampedArray(this.w * this.h * 4);
    for (let i = 0; i < this.data.length; i++) {
      const c = this.data[i]!;
      if (c === CLEAR) continue;
      out[i * 4] = (c >> 16) & 255;
      out[i * 4 + 1] = (c >> 8) & 255;
      out[i * 4 + 2] = c & 255;
      out[i * 4 + 3] = this.alpha[i]!;
    }
    return out;
  }
}
