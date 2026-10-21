import type { Texture } from 'pixi.js';
import type { Atlas } from '../atlas';
import { T, soilRamp } from '../palette';
import type { Px } from '../pixels';
import { hash2, lighten, darken, mix } from '../pixels';

/** Nest tile art size in pixels; matches NEST_TILE so one art pixel is one world unit. */
export const TILE = 12;
export const SOIL_VARIANTS = 4;
export const SOIL_BANDS = 4;

/** Mask bits: set where the neighbour on that side is solid (so the tunnel shows a rim there). */
export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;

export interface NestTextures {
  soil: Texture[][];
  tunnel: Texture[];
  /** Per chamber kind (0 = generic): index [kind][mask]. */
  chamber: Texture[][];
  rock: Texture[];
  sky: Texture[];
  grass: Texture[];
  water: Texture[];
  egg: Texture;
  larva: Texture[];
  pupa: Texture;
}

function soilTile(px: Px, band: number, variant: number): void {
  const base = soilRamp(band / (SOIL_BANDS - 1));
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const k = hash2(x, y, variant * 7 + band);
      let c = base;
      if (k > 0.92) c = lighten(base, 0.22);
      else if (k > 0.78) c = lighten(base, 0.1);
      else if (k < 0.1) c = darken(base, 0.3);
      else if (k < 0.24) c = darken(base, 0.14);
      px.set(x, y, c);
    }
  }
  // Embedded pebbles and the odd root.
  if (variant === 1) {
    px.rect(3, 4, 3, 2, T.rock[2]);
    px.set(3, 4, T.rock[3]);
    px.rect(4, 6, 2, 1, T.rock[0]);
  } else if (variant === 2) {
    px.line(1, 9, 5, 7, 0xd8c8a0);
    px.line(5, 7, 9, 8, 0xd8c8a0);
  } else if (variant === 3) {
    px.rect(7, 2, 2, 2, T.rock[1]);
    px.set(7, 2, T.rock[3]);
  }
}

function openTile(px: Px, floor: number, rim: number, mask: number, seed: number): void {
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const k = hash2(x, y, seed);
      px.set(x, y, k > 0.9 ? lighten(floor, 0.1) : k < 0.12 ? darken(floor, 0.25) : floor);
    }
  }
  // Packed-dirt rim wherever the neighbour is solid.
  if (mask & N) {
    px.rect(0, 0, TILE, 2, rim);
    px.rect(0, 2, TILE, 1, mix(rim, floor, 0.5));
  }
  if (mask & S) px.rect(0, TILE - 1, TILE, 1, rim);
  if (mask & W) px.rect(0, 0, 1, TILE, rim);
  if (mask & E) px.rect(TILE - 1, 0, 1, TILE, rim);
}

export function registerNest(atlas: Atlas): NestTextures {
  const soil: Texture[][] = [];
  for (let b = 0; b < SOIL_BANDS; b++) {
    soil[b] = [];
    for (let v = 0; v < SOIL_VARIANTS; v++) {
      soil[b]![v] = atlas.define(`nest/soil/${b}/${v}`, TILE, TILE, (px) => soilTile(px, b, v));
    }
  }
  const tunnel: Texture[] = [];
  for (let m = 0; m < 16; m++) {
    tunnel.push(
      atlas.define(`nest/tunnel/${m}`, TILE, TILE, (px) =>
        openTile(px, T.tunnel, T.tunnelRim, m, 3),
      ),
    );
  }
  const floors = [T.tunnel, T.chamber.queen, T.chamber.food, T.chamber.nursery];
  const chamber: Texture[][] = floors.map((floor, kind) => {
    const f = kind === 0 ? floor : lighten(floor, 0.05);
    return Array.from({ length: 16 }, (_, m) =>
      atlas.define(`nest/chamber/${kind}/${m}`, TILE, TILE, (px) =>
        openTile(px, f, T.tunnelRim, m, 11 + kind),
      ),
    );
  });
  const rock = [0, 1].map((v) =>
    atlas.define(`nest/rock/${v}`, TILE, TILE, (px) => {
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const k = hash2(x, y, 40 + v) + (x + y < 8 ? 0.15 : 0) - (x + y > 15 ? 0.15 : 0);
          px.set(x, y, T.rock[k > 0.75 ? 3 : k > 0.4 ? 2 : k > 0.2 ? 1 : 0]);
        }
      }
      px.rect(0, TILE - 1, TILE, 1, T.rock[0]);
      px.rect(TILE - 1, 0, 1, TILE, T.rock[0]);
    }),
  );
  const sky = [0, 1].map((v) =>
    atlas.define(`nest/sky/${v}`, TILE, TILE, (px) => {
      px.fill(T.sky);
      if (v === 1) {
        px.rect(2, 4, 7, 2, 0xffffff);
        px.rect(4, 3, 4, 1, 0xffffff);
      } else {
        px.rect(0, TILE - 3, TILE, 3, T.skyLight);
      }
    }),
  );
  const grass = [0, 1].map((v) =>
    atlas.define(`nest/grass/${v}`, TILE, TILE, (px) => {
      px.rect(0, 0, TILE, 6, T.sky);
      px.rect(0, 6, TILE, TILE - 6, T.grass[1]);
      px.rect(0, 6, TILE, 2, T.grass[3]);
      for (let x = 0; x < TILE; x++) {
        const h = 1 + Math.floor(hash2(x, v, 5) * 4);
        for (let y = 0; y < h; y++) px.set(x, 6 - y, y === h - 1 ? T.grass[4] : T.grass[2]);
      }
      px.rect(0, TILE - 2, TILE, 2, soilRamp(0));
    }),
  );
  const water = [0, 1, 2].map((v) =>
    atlas.define(`nest/water/${v}`, TILE, TILE, (px) => {
      px.fill(T.water[1]);
      for (let x = 0; x < TILE; x++) {
        const y = 1 + ((x + v * 3) % 6 < 3 ? 0 : 1);
        px.set(x, y, T.water[3]);
        px.set(x, y + 4 + (x % 3), T.water[2]);
      }
    }),
  );
  const egg = atlas.define('brood/egg', 3, 4, (px) => {
    px.rect(0, 1, 3, 2, T.brood.egg);
    px.set(1, 0, T.brood.egg);
    px.set(1, 3, T.brood.larvaShade);
  });
  const larva = [0, 1].map((f) =>
    atlas.define(`brood/larva/${f}`, 7, 5, (px) => {
      for (let i = 0; i < 5; i++) {
        const y = 2 + (f === 0 ? i % 2 : (i + 1) % 2) - 1;
        px.rect(1 + i, y, 1, 2, i % 2 ? T.brood.larva : lighten(T.brood.larva, 0.15));
      }
      px.set(6, 2, T.brood.larvaShade);
      px.set(1, 3, T.brood.larvaShade);
    }),
  );
  const pupa = atlas.define('brood/pupa', 8, 5, (px) => {
    px.ellipse(3.5, 2, 3.6, 2, (_x, _y, u) =>
      Math.abs(u) < 0.2 || Math.abs(u - 0.6) < 0.1 ? T.brood.pupaShade : T.brood.pupa,
    );
    px.outline(darken(T.brood.pupaShade, 0.3));
  });
  return { soil, tunnel, chamber, rock, sky, grass, water, egg, larva, pupa };
}
