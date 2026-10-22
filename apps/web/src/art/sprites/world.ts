import type { Texture } from 'pixi.js';
import type { Atlas } from '../atlas';
import { T } from '../palette';
import { CLEAR, hash2, mix, darken, lighten } from '../pixels';
import type { Px } from '../pixels';

/** World units per art pixel on the surface. */
export const SURFACE_PX = 2;

export type FoodKind = 'crumb' | 'sugar' | 'corpse';

/** Tiny seeded scatter inside a disc: returns offsets in [-r, r], sorted top to bottom. */
function scatter(n: number, r: number, seed: number): { x: number; y: number; h: number }[] {
  const out: { x: number; y: number; h: number }[] = [];
  for (let i = 0; i < n * 6 && out.length < n; i++) {
    const x = (hash2(i, seed, 1) * 2 - 1) * r;
    const y = (hash2(i, seed, 2) * 2 - 1) * r * 0.85;
    if (x * x + (y * y) / 0.72 <= r * r) out.push({ x, y, h: hash2(i, seed, 3) });
  }
  return out.sort((a, b) => a.y - b.y);
}

/** Soft drop shadow: every drawn pixel casts a translucent one down and to the right. */
function dropShadow(px: Px): void {
  const solid: number[] = [];
  for (let y = 0; y < px.h; y++)
    for (let x = 0; x < px.w; x++) if (px.get(x, y) !== CLEAR) solid.push(x, y);
  for (let i = 0; i < solid.length; i += 2) {
    const x = solid[i]!;
    const y = solid[i + 1]!;
    for (const [dx, dy] of [
      [1, 2],
      [2, 2],
      [1, 1],
    ] as const)
      if (px.get(x + dx, y + dy) === CLEAR) px.setA(x + dx, y + dy, 0x000000, 90);
  }
}

/**
 * A food pile `r` art pixels in radius: a heap of golden bread chunks, white sugar cubes, or
 * a beetle husk. Every pile has a dark ring and a drop shadow so it reads against the lawn, and
 * the number of pieces follows the pile's area so a depleted pile visibly shrinks.
 */
export function foodTexture(atlas: Atlas, kind: FoodKind, r: number, variant: number): Texture {
  const size = r * 2 + 6;
  return atlas.define(`food/${kind}/${r}/${variant}`, size, size, (px, pal) => {
    const f = pal.food;
    const c = r + 2;
    const seed = variant * 31 + r;
    if (kind === 'crumb') {
      // Darker base heap so the chunks never leave grass showing through the pile.
      px.ellipse(c, c + 1, r - 1, (r - 1) * 0.8, f.crumb[1]);
      // Chunk size grows with the pile so a big heap shows bold pieces, not noise.
      const n = Math.max(3, Math.round(r * r * (r >= 8 ? 0.2 : 0.3)));
      for (const s of scatter(n, r - 2, seed)) {
        const w = (r >= 8 ? 5 : 4) + (s.h > 0.5 ? 1 : 0);
        const h = w - 1;
        const x = Math.round(c + s.x - w / 2);
        const y = Math.round(c + s.y - h / 2);
        // Bread chunk: dark crust edge, lit top face, shaded right and bottom.
        px.rect(x, y, w, h, f.crumb[0]);
        px.rect(x + 1, y + 1, w - 2, h - 2, f.crumb[2]);
        px.rect(x + 1, y + 1, w - 2, 1, f.crumb[3]);
        px.rect(x + w - 2, y + 2, 1, h - 3, f.crumb[1]);
        px.rect(x + 1, y + h - 2, w - 2, 1, f.crumb[1]);
        if (s.h > 0.75) px.set(x + 2, y + 2, f.crumb[1]);
      }
      px.outline(f.outline, true);
    } else if (kind === 'sugar') {
      px.ellipse(c, c + 1, r - 1, (r - 1) * 0.8, darken(f.sugar[0], 0.4));
      const n = Math.max(2, Math.round(r * r * (r >= 8 ? 0.22 : 0.3)));
      for (const s of scatter(n, r - 2, seed + 7)) {
        const w = r >= 8 ? 6 : 5;
        const x = Math.round(c + s.x - w / 2);
        const y = Math.round(c + s.y - w / 2);
        // Cube: grey-lilac edge, bright top-left face, shaded right and bottom.
        px.rect(x, y, w, w, f.sugar[0]);
        px.rect(x + 1, y + 1, w - 2, w - 2, f.sugar[2]);
        px.rect(x + w - 2, y + 1, 1, w - 2, f.sugar[1]);
        px.rect(x + 1, y + w - 2, w - 2, 1, f.sugar[1]);
        if (s.h > 0.55) px.set(x + 2, y + 2, f.sugar[3]);
      }
      px.outline(f.outline, true);
    } else {
      // Husk of a beetle: domed shell with a centre seam, legs curled out, bright rim light.
      const rx = Math.max(3, r * 0.72);
      const ry = Math.max(4, r * 0.88);
      for (const s of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          const y = c - ry * 0.4 + i * (ry * 0.5);
          px.line(c + s * rx * 0.8, y, c + s * (rx + 2), y - 1 + i, f.corpse[1]);
        }
      }
      px.ellipse(c, c + 1, rx, ry, (_x, _y, u, v) =>
        Math.abs(u) < 0.1
          ? f.corpse[0]
          : v < -0.4
            ? f.corpse[3]
            : v > 0.4
              ? f.corpse[1]
              : f.corpse[2],
      );
      px.ellipse(c, c - ry * 0.85, rx * 0.45, ry * 0.28, f.corpse[1]);
      px.set(c - 1, c - ry * 0.5, f.sparkle);
      px.outline(f.outline, true);
    }
    dropShadow(px);
  });
}

/** Four-point twinkle laid over a food pile; three frames from a pinprick to a full star. */
export function glintTexture(atlas: Atlas, frame: number): Texture {
  return atlas.define(`food/glint/${frame}`, 7, 7, (px, pal) => {
    const col = pal.food.sparkle;
    px.set(3, 3, col);
    if (frame >= 1) {
      for (const [x, y] of [
        [2, 3],
        [4, 3],
        [3, 2],
        [3, 4],
      ] as const)
        px.set(x, y, col);
    }
    if (frame >= 2) {
      for (const [x, y] of [
        [1, 3],
        [5, 3],
        [3, 1],
        [3, 5],
      ] as const)
        px.set(x, y, col);
    }
  });
}

/** A rock `r` art pixels in radius with a lumpy outline, lit from the top left. */
export function rockTexture(atlas: Atlas, r: number, variant: number): Texture {
  const size = r * 2 + 6;
  return atlas.define(`rock/${r}/${variant}`, size, size, (px) => {
    const c = r + 2;
    const lump = (a: number): number =>
      1 + 0.11 * Math.sin(a * 3 + variant * 2.1) + 0.07 * Math.sin(a * 5 + variant * 4.7);
    // Shadow first, offset down-right.
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - c - 1.5;
        const dy = y - c - 1.5;
        if (dx * dx + dy * dy <= (r * lump(Math.atan2(dy, dx))) ** 2) px.setA(x, y, 0x000000, 70);
      }
    }
    px.ellipse(c, c, r + 1, r + 1, (x, y, u, v) => {
      const a = Math.atan2(v, u);
      const d = Math.hypot(u, v) * (r + 1);
      if (d > r * lump(a)) return null;
      const lit = -(u * 0.65 + v * 0.75);
      const k = lit + (hash2(x, y, variant) - 0.5) * 0.35;
      const i = k > 0.55 ? 4 : k > 0.15 ? 3 : k > -0.3 ? 2 : k > -0.65 ? 1 : 0;
      return T.rock[i];
    });
    px.outline(0x23232a, true);
    // Cracks.
    const cr = Math.max(2, Math.round(r * 0.5));
    px.line(c - cr * 0.2, c - cr, c + cr * 0.1, c, T.rock[0]);
    px.line(c + cr * 0.1, c, c + cr * 0.5, c + cr * 0.6, T.rock[0]);
  });
}

/** Nest entrance: a ring of packed dirt around a dark hole, `r` art pixels across the mound. */
export function moundTexture(atlas: Atlas, colony: number, r: number, hole: number): Texture {
  const size = r * 2 + 4;
  return atlas.define(`mound/${colony}/${r}/${hole}`, size, size, (px) => {
    const c = r + 2;
    const tint = colony === 1 ? 0xb4604a : 0x8a6238;
    const ramp = [
      darken(tint, 0.5),
      darken(tint, 0.25),
      tint,
      lighten(tint, 0.2),
      lighten(tint, 0.38),
    ];
    px.ellipse(c, c, r, r * 0.92, (x, y, u, v) => {
      const lit = -(u * 0.5 + v * 0.7);
      const k = lit + (hash2(x, y, colony) - 0.5) * 0.4;
      return ramp[k > 0.5 ? 4 : k > 0.1 ? 3 : k > -0.35 ? 2 : k > -0.7 ? 1 : 0]!;
    });
    px.outline(darken(tint, 0.7));
    // Pebbles around the rim: round for colony 0, flat sherds for colony 1 (shape cue, too).
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.3;
      const x = Math.round(c + Math.cos(a) * r * 0.85);
      const y = Math.round(c + Math.sin(a) * r * 0.78);
      px.set(x, y, T.rock[3]);
      if (colony === 1) px.set(x + 1, y, T.rock[2]);
      else px.set(x, y + 1, T.rock[1]);
    }
    // Entrance hole.
    px.ellipse(c, c, hole, hole * 0.85, (_x, _y, u, v) => (v < -0.4 ? 0x3a2412 : 0x120b05));
  });
}

/** Heap of excavated soil, five sizes. */
export function dirtHeapTexture(atlas: Atlas, level: number): Texture {
  const r = 3 + level * 2;
  const w = r * 2 + 4;
  const h = r * 1.5 + 4;
  return atlas.define(`dirt/${level}`, w, Math.ceil(h), (px) => {
    const cx = w / 2;
    const cy = h - 3;
    px.ellipse(cx, cy, r, r * 0.8, (x, y, u, v) => {
      const k = -(u * 0.5 + v * 0.8) + (hash2(x, y, level) - 0.5) * 0.4;
      return T.dirt[k > 0.45 ? 4 : k > 0.05 ? 3 : k > -0.4 ? 2 : 1];
    });
    px.outline(T.dirt[0]);
  });
}

/** Bare-earth decor: dark and muted so nothing on the lawn shares food's gold. */
const PATCH_SOIL = [
  mix(T.dirt[1], T.grass[0], 0.55),
  mix(T.dirt[1], T.grass[1], 0.4),
  mix(T.dirt[2], T.grass[1], 0.5),
] as const;

const PEBBLE = [
  mix(T.rock[0], T.grass[0], 0.3),
  mix(T.rock[1], T.grass[1], 0.3),
  mix(T.rock[2], T.grass[2], 0.3),
] as const;

export const GRASS_TUFTS = 4;
export const PEBBLES = 4;
export const CLOVERS = 2;
export const PATCHES = 2;
export const PUDDLES = 2;
export const LEAVES = 2;

export interface DecorTextures {
  grass: Texture[];
  pebbles: Texture[];
  clover: Texture[];
  patches: Texture[];
  leaves: Texture[];
  puddles: Texture[];
}

export function registerDecor(atlas: Atlas): DecorTextures {
  const grass: Texture[] = [];
  for (let i = 0; i < GRASS_TUFTS; i++) {
    grass.push(
      atlas.define(`decor/grass/${i}`, 11, 9, (px) => {
        const blades = 3 + (i % 3);
        for (let b = 0; b < blades; b++) {
          const x = 2 + Math.round(((b + 0.5) / blades) * 7);
          const lean = Math.round((b - (blades - 1) / 2) * 0.9);
          const hgt = 4 + Math.round(hash2(b, i, 5) * 3);
          for (let y = 0; y < hgt; y++) {
            const px0 = x + Math.round((lean * y) / hgt);
            px.set(px0, 8 - y, y > hgt - 3 ? T.grass[4] : y > 1 ? T.grass[3] : T.grassDark);
          }
        }
        px.rect(3, 8, 5, 1, T.grassDark);
      }),
    );
  }
  const pebbles: Texture[] = [];
  for (let i = 0; i < PEBBLES; i++) {
    const w = 4 + (i % 3);
    pebbles.push(
      atlas.define(`decor/pebble/${i}`, w + 2, 6, (px) => {
        px.ellipse((w + 1) / 2, 2.6, w / 2, 2, (_x, _y, u, v) =>
          v < -0.2 && u < 0.3 ? PEBBLE[2] : v > 0.4 ? PEBBLE[0] : PEBBLE[1],
        );
        px.outline(0x2c2c32);
      }),
    );
  }
  const clover: Texture[] = [];
  for (let i = 0; i < CLOVERS; i++) {
    clover.push(
      atlas.define(`decor/clover/${i}`, 7, 7, (px) => {
        for (const [x, y] of [
          [2, 2],
          [4, 2],
          [3, 4],
        ] as const) {
          px.rect(x - 1, y - 1, 2, 2, T.grass[4]);
          px.set(x - 1, y - 1, lighten(T.grass[4], 0.3));
        }
        px.set(3, 5, T.grassDark);
        px.set(3, 6, T.grassDark);
        if (i === 1) px.set(3, 3, 0xffffff);
      }),
    );
  }
  const patches: Texture[] = [];
  for (let i = 0; i < PATCHES; i++) {
    patches.push(
      atlas.define(`decor/patch/${i}`, 15, 9, (px) => {
        px.ellipse(7, 4, 6.6, 3.6, (x, y) => {
          const k = hash2(x, y, i + 20);
          return k > 0.8 ? PATCH_SOIL[2] : k > 0.35 ? PATCH_SOIL[1] : PATCH_SOIL[0];
        });
        // Ragged edge: thin out the border.
        for (let y = 0; y < 9; y++) {
          for (let x = 0; x < 15; x++) {
            if (px.get(x, y) >= 0 && hash2(x, y, i) > 0.72 && (x < 2 || x > 12 || y < 1 || y > 7))
              px.set(x, y, -1);
          }
        }
      }),
    );
  }
  const leaves: Texture[] = [];
  for (let i = 0; i < LEAVES; i++) {
    leaves.push(
      atlas.define(`decor/leaf/${i}`, 9, 6, (px) => {
        const col = i === 0 ? 0x5e4a2c : 0x4e6226;
        px.ellipse(4, 2.6, 4, 2.2, (_x, _y, _u, v) => (v < -0.2 ? lighten(col, 0.22) : col));
        px.line(1, 3, 7, 2, darken(col, 0.4));
        px.outline(darken(col, 0.6));
      }),
    );
  }
  const puddles: Texture[] = [];
  for (let i = 0; i < PUDDLES; i++) {
    puddles.push(
      atlas.define(`decor/puddle/${i}`, 25, 13, (px) => {
        px.ellipse(12, 6, 11.5, 5.5, (x, y, _u, v) => {
          const wob = hash2(x >> 1, y, i) > 0.9;
          if (v > 0.55 && hash2(x, y, i + 3) > 0.6) return null;
          return wob ? T.water[2] : v < -0.35 ? T.water[2] : T.water[1];
        });
        px.line(5, 4, 10, 4, T.water[3]);
        px.line(14, 7, 18, 7, T.water[3]);
        px.outline(T.water[0]);
        for (let k = 0; k < px.data.length; k++) if (px.data[k]! >= 0) px.alpha[k] = 215;
      }),
    );
  }
  return { grass, pebbles, clover, patches, leaves, puddles };
}

export interface RainTextures {
  drops: Texture[];
  splash: Texture[];
}

export function registerRain(atlas: Atlas): RainTextures {
  const drops = [0, 1, 2].map((i) =>
    atlas.define(`rain/drop/${i}`, 3, 4 + i * 2, (px) => {
      const h = 4 + i * 2;
      for (let y = 0; y < h; y++) {
        const x = 2 - Math.floor((y * 3) / h);
        px.set(x, y, y > h - 3 ? 0xe4f2ff : 0x9cc4ea);
      }
    }),
  );
  const splash = [0, 1, 2].map((i) =>
    atlas.define(`rain/splash/${i}`, 9, 5, (px) => {
      const col = [0xe4f2ff, 0xbfd9f2, 0x8fb4d8][i]!;
      if (i === 0) {
        px.set(4, 3, col);
        px.set(3, 2, col);
        px.set(5, 2, col);
      } else if (i === 1) {
        px.line(2, 3, 6, 3, col);
        px.set(1, 2, col);
        px.set(7, 2, col);
        px.set(4, 1, col);
      } else {
        px.line(1, 3, 7, 3, col);
        px.set(0, 2, mix(col, 0x000000, 0.1));
        px.set(8, 2, col);
      }
    }),
  );
  return { drops, splash };
}
