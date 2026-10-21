// Pixel ant mark shared by the icon generators (plain JS so the .mjs scripts can import it).
// The mark is authored on a 32x32 grid and scaled with nearest-neighbour, so it stays crisp.
export const GRID = 32;
export const COLORS = {
  grassDark: 0x335a27,
  grass: 0x3f6a2e,
  grassLight: 0x4d7a35,
  ink: 0x15151c,
  body: 0x2b2b36,
  light: 0x5a5a70,
  shade: 0x101016,
  spot: 0x9aa0b4,
  ring: 0xffd21a,
  ringShade: 0xb8901c,
  eye: 0xf4ecd2,
  splashInk: 0xf4ecd2,
};

const hash = (x, y) => {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Returns a GRID*GRID array of 0xRRGGBB colours or -1 for transparent. */
export function markGrid({ ring = true, ink = null } = {}) {
  const g = new Array(GRID * GRID).fill(-1);
  const set = (x, y, c) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < GRID && y < GRID) g[y * GRID + x] = c;
  };
  const ellipse = (cx, cy, rx, ry, fn) => {
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++)
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        const u = (x - cx) / rx;
        const v = (y - cy) / ry;
        if (u * u + v * v <= 1) set(x, y, fn(u, v));
      }
  };
  const line = (x0, y0, x1, y1, c) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 || 1;
    for (let i = 0; i <= n; i++) set(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c);
  };
  if (ring) {
    for (let y = 0; y < GRID; y++)
      for (let x = 0; x < GRID; x++) {
        const d = Math.hypot(x - 15.5, y - 15.5);
        if (d > 13.2 && d < 15.2) set(x, y, d > 14.4 ? COLORS.ringShade : COLORS.ring);
      }
  }
  const body = ink ?? COLORS.body;
  const tone = (v) => (ink ? ink : v < -0.4 ? COLORS.light : v > 0.45 ? COLORS.shade : body);
  // Legs and antennae first; the ant faces up.
  for (const s of [-1, 1]) {
    for (const [y0, dy, dx] of [
      [12, -3, 7],
      [15, 0, 8],
      [18, 4, 7],
    ]) {
      line(16 + s * 2, y0, 16 + s * dx, y0 + dy - 1, COLORS.ink);
      line(16 + s * dx, y0 + dy - 1, 16 + s * (dx + 1), y0 + dy + 3, COLORS.ink);
    }
    line(15 + s * 1.5, 6, 15 + s * 4, 2, COLORS.ink);
    line(15 + s * 4, 2, 15 + s * 6, 3, COLORS.ink);
  }
  ellipse(15.5, 23, 4.6, 5.8, (u, v) => tone(v));
  ellipse(15.5, 15, 3, 3.4, (u, v) => tone(v));
  ellipse(15.5, 9, 3.1, 3.1, (u, v) => tone(v));
  set(15, 22, COLORS.spot);
  set(16, 22, COLORS.spot);
  set(15, 23, COLORS.spot);
  set(16, 23, COLORS.spot);
  set(14, 8, COLORS.eye);
  set(17, 8, COLORS.eye);
  // Mandibles.
  set(14, 5, COLORS.ink);
  set(17, 5, COLORS.ink);
  return g;
}

/** RGBA pixels of a `size` square: nearest-neighbour scaled mark centred at `scale` of the frame. */
export function renderMark(size, { bg = null, scale = 0.9, ring = true, ink = null } = {}) {
  const grid = markGrid({ ring, ink });
  const out = new Uint8Array(size * size * 4);
  const cell = (size * scale) / GRID;
  const offset = (size - size * scale) / 2;
  const pixelBg = (x, y) => {
    if (bg === null) return -1;
    // Dithered lawn, scaled with the mark so its pixels match.
    const bgCell = (size * Math.max(scale, 0.5)) / GRID;
    const gx = Math.floor(x / (bgCell * 2));
    const gy = Math.floor(y / (bgCell * 2));
    const k = hash(gx, gy);
    return k > 0.86 ? COLORS.grassLight : k < 0.2 ? COLORS.grassDark : COLORS.grass;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = Math.floor((x - offset) / cell);
      const gy = Math.floor((y - offset) / cell);
      let c = gx >= 0 && gy >= 0 && gx < GRID && gy < GRID ? grid[gy * GRID + gx] : -1;
      if (c === -1) c = pixelBg(x, y);
      const o = (y * size + x) * 4;
      if (c === -1) continue;
      out[o] = (c >> 16) & 255;
      out[o + 1] = (c >> 8) & 255;
      out[o + 2] = c & 255;
      out[o + 3] = 255;
    }
  }
  return out;
}
