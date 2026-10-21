import type { Texture } from 'pixi.js';
import type { Atlas } from '../atlas';
import type { AntColors, Palette } from '../palette';
import { T } from '../palette';
import { Px, mix } from '../pixels';

/** Castes are indexed like `Caste` in @ant/shared: worker, soldier, breeder. */
export const CASTE_COUNT = 3;
export type AntState = 'walk' | 'food' | 'dirt' | 'fight';
export const STATE_FRAMES: Record<AntState, number> = { walk: 4, food: 4, dirt: 4, fight: 2 };
export const ANT_STATES: readonly AntState[] = ['walk', 'food', 'dirt', 'fight'];
/** Who an ant sprite belongs to: colony 0, colony 1, or the player's yellow ant. */
export type Who = 0 | 1 | 'p';
export type AntSet = 'surf' | 'nest';

interface Size {
  w: number;
  h: number;
  /** Body centre inside the frame. */
  cx: number;
  cy: number;
}

/** Frame sizes per caste (odd sizes so the centre pixel is the rotation pivot). */
export const ANT_SIZE: readonly Size[] = [
  { w: 19, h: 11, cx: 9, cy: 5 },
  { w: 25, h: 15, cx: 12, cy: 7 },
  { w: 25, h: 19, cx: 12, cy: 9 },
];

const key = (set: AntSet, who: Who, caste: number, state: AntState, frame: number): string =>
  `ant/${set}/${who}/${caste}/${state}/${frame}`;

/** Triangle fill with optional translucency, used for wings. */
function tri(
  px: Px,
  p: readonly [number, number, number, number, number, number],
  color: number,
  alpha: number,
): void {
  const [x0, y0, x1, y1, x2, y2] = p;
  const minX = Math.floor(Math.min(x0, x1, x2));
  const maxX = Math.ceil(Math.max(x0, x1, x2));
  const minY = Math.floor(Math.min(y0, y1, y2));
  const maxY = Math.ceil(Math.max(y0, y1, y2));
  const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const w0 = ((x1 - x) * (y2 - y) - (x2 - x) * (y1 - y)) / area;
      const w1 = ((x2 - x) * (y0 - y) - (x0 - x) * (y2 - y)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 >= 0 && w1 >= 0 && w2 >= 0) px.setA(x, y, color, alpha);
    }
  }
}

interface Pose {
  who: Who;
  caste: number;
  state: AntState;
  frame: number;
  nest: boolean;
}

function drawAnt(px: Px, pal: Palette, pose: Pose): void {
  const col: AntColors = pose.who === 'p' ? pal.player : pal.colonies[pose.who];
  const { caste, state, frame } = pose;
  const size = ANT_SIZE[caste]!;
  const soldier = caste === 1;
  const breeder = caste === 2;
  const pointed = pose.who === 1;
  const lunge = state === 'fight' && frame === 1 ? 1 : 0;
  const cx = size.cx + lunge;
  const cy = size.cy;
  const nest = pose.nest;
  const ring = nest ? col.nestOutline : col.outline;
  const body = nest ? mix(col.body, col.nestOutline, 0.12) : col.body;
  const light = nest ? mix(col.light, col.nestOutline, 0.2) : col.light;
  const shade = col.shade;
  const tone = (v: number): number => (v < -0.4 ? light : v > 0.45 ? shade : body);

  // Proportions per caste.
  const headR = soldier ? 3.2 : breeder ? 2.1 : 2.1;
  const headX = cx + (soldier ? 6 : breeder ? 5 : 4.5);
  const thR = soldier ? 2.8 : breeder ? 3 : 2.2;
  const abX = cx - (soldier ? 6.5 : breeder ? 7 : 5);
  const abRx = soldier ? 4.8 : breeder ? 5.2 : 3.8;
  const abRy = soldier ? 3.4 : breeder ? 3.2 : 2.7;

  const abdomen = (x: number, y: number, u: number, v: number): number | null => {
    if (pointed && !(u > -0.3 || Math.abs(v) <= (u + 1) * 1.25)) return null;
    // Identity marks: colony 1 wears two pale bands, colony 0 a pale spot, the player a stripe.
    if (pose.who === 1 && (Math.round(x - abX) === -1 || Math.round(x - abX) === 2)) return col.mark;
    if (pose.who === 0 && Math.abs(u) < 0.34 && Math.abs(v) < 0.34) return col.mark;
    if (pose.who === 'p' && Math.abs(v) < 0.2) return col.mark;
    return tone(v);
  };

  // Wings sit behind the body so the abdomen shows through at the edge; drawn first.
  if (breeder) {
    for (const s of [-1, 1]) {
      tri(px, [cx - 1, cy + s * 2, cx - 10, cy + s * 7, cx - 11, cy + s * 3], 0xe8f2ff, 175);
      px.line(cx - 1, cy + s * 2, cx - 10, cy + s * 7, 0xffffff);
    }
  }

  px.ellipse(abX, cy, abRx, abRy, abdomen);
  px.ellipse(cx, cy, thR, soldier ? 2.3 : breeder ? 2.4 : 1.8, (_x, _y, _u, v) => tone(v));
  // Waist link so the segments read as one body.
  px.rect(Math.round((abX + abRx + cx - thR) / 2) - 1, cy, 2, 1, body);
  px.ellipse(headX, cy, headR, headR * (pointed ? 0.9 : 1), (_x, _y, u, v) => {
    if (soldier && Math.abs(v) < 0.3 && u > 0.1) return shade;
    return tone(v);
  });
  px.outline(ring, pal.highContrast);

  // Eyes.
  const eyeY = soldier ? 1.6 : 1.2;
  px.set(headX + 0.6, cy - eyeY, col.accent);
  px.set(headX + 0.6, cy + eyeY, col.accent);

  // Legs: alternating tripods, swinging one pixel fore and aft.
  const legColor = nest ? mix(ring, body, 0.35) : ring;
  const reach = soldier ? 6.4 : breeder ? 7 : 4.6;
  const sway = state === 'fight' ? 0 : [0, 1, 0, -1][frame % 4]!;
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const groupA = (i + (s > 0 ? 0 : 1)) % 2 === 0;
      const d = sway * (groupA ? 1 : -1);
      const bx = cx + (1 - i) * (soldier ? 2.2 : 1.7);
      const tx = bx + (1 - i) * 2.2 + d;
      const ty = cy + s * reach;
      px.line(bx, cy + s * (thR * 0.55), tx, cy + s * (reach - 1.2), legColor);
      px.under(tx, ty, legColor);
    }
  }

  // Mandibles and antennae.
  const mx = headX + headR - 0.5;
  const open = state === 'fight' && frame === 0;
  const big = soldier ? 2 : 1;
  for (const s of [-1, 1]) {
    if (open) {
      for (let k = 0; k <= big; k++) px.set(mx + k, cy + s * (1.5 + k * 0.8), col.accent);
    } else if (state === 'fight') {
      for (let k = 0; k <= big; k++) px.set(mx + k, cy + s * Math.max(0.4, 1.5 - k), col.accent);
    } else {
      for (let k = 0; k <= big; k++) px.set(mx + k, cy + s * (1.4 - k * 0.45), legColor);
    }
    // Antennae: bent out and forward.
    px.line(headX + 1.2, cy + s * 1.5, headX + 2.5, cy + s * 3, legColor);
    px.set(headX + 3.5, cy + s * 3.4, legColor);
  }
  if (state === 'fight' && frame === 1) {
    px.set(mx + big + 2, cy - 3, 0xffffff);
    px.set(mx + big + 3, cy + 2, 0xffe84a);
    px.set(mx + big + 1, cy + 4, 0xffffff);
  }

  // Load held between the mandibles.
  if (state === 'food') {
    const x = mx + big + 1;
    px.rect(x, cy - 1, 3, 3, T.crumb[1]);
    px.set(x, cy - 1, T.crumb[3]);
    px.set(x + 1, cy - 1, T.crumb[3]);
    px.set(x + 2, cy + 1, T.crumb[0]);
    px.set(x + 1, cy + 1, T.crumb[0]);
  } else if (state === 'dirt') {
    const x = mx + big + 1;
    px.rect(x, cy - 1, 3, 3, T.dirt[2]);
    px.set(x, cy - 1, T.dirt[4]);
    px.set(x + 2, cy + 1, T.dirt[0]);
    px.set(x + 1, cy + 1, T.dirt[0]);
  }
}

export interface AntTextures {
  /** [set][who][caste][state] -> frames. `who` index: 0, 1, 2 (= player). */
  frames: Record<AntSet, Texture[][][][]>;
  queen: Texture[];
  queenDead: Texture;
}

const WHO: readonly Who[] = [0, 1, 'p'];

export function registerAnts(atlas: Atlas): AntTextures {
  const frames = { surf: [] as Texture[][][][], nest: [] as Texture[][][][] };
  for (const set of ['surf', 'nest'] as const) {
    WHO.forEach((who, wi) => {
      frames[set][wi] = [];
      for (let caste = 0; caste < CASTE_COUNT; caste++) {
        const size = ANT_SIZE[caste]!;
        const byState: Texture[][] = [];
        ANT_STATES.forEach((state, si) => {
          byState[si] = [];
          for (let frame = 0; frame < STATE_FRAMES[state]; frame++) {
            byState[si]![frame] = atlas.define(
              key(set, who, caste, state, frame),
              size.w,
              size.h,
              (px, pal) => drawAnt(px, pal, { who, caste, state, frame, nest: set === 'nest' }),
            );
          }
        });
        frames[set][wi]![caste] = byState;
      }
    });
  }
  const queen = [0, 1].map((c) =>
    atlas.define(`queen/${c}`, 31, 15, (px, pal) => drawQueen(px, pal, c, true)),
  );
  const queenDead = atlas.define('queen/dead', 31, 15, (px, pal) => drawQueen(px, pal, 0, false));
  return { frames, queen, queenDead };
}

/** State index into `AntTextures.frames`. */
export const STATE_INDEX: Record<AntState, number> = { walk: 0, food: 1, dirt: 2, fight: 3 };

function drawQueen(px: Px, pal: Palette, colony: number, alive: boolean): void {
  const col = pal.colonies[colony === 1 ? 1 : 0];
  const cy = 7;
  const grey = [0x444444, 0x6a6a6a, 0x9a9a9a];
  const body = alive ? col.body : grey[1]!;
  const light = alive ? col.light : grey[2]!;
  const shade = alive ? col.shade : grey[0]!;
  const ring = alive ? col.nestOutline : 0xbbbbbb;
  const bands = alive ? col.mark : 0x777777;
  // Swollen abdomen with pale growth bands (colony 1 pointed, like its workers).
  px.ellipse(22, cy, 8.5, 5.4, (x, _y, u, v) => {
    if (colony === 1 && !(u > -0.3 || Math.abs(v) <= (u + 1) * 1.25)) return null;
    if (alive && (x === 19 || x === 23 || x === 27) && Math.abs(v) < 0.85) return bands;
    return v < -0.4 ? light : v > 0.45 ? shade : body;
  });
  px.ellipse(11, cy, 3.4, 2.6, (_x, _y, _u, v) => (v < -0.3 ? light : v > 0.4 ? shade : body));
  px.ellipse(5, cy, 3, 2.6, (_x, _y, _u, v) => (v < -0.3 ? light : v > 0.4 ? shade : body));
  px.outline(ring, pal.highContrast);
  px.set(5.5, cy - 1.3, alive ? col.accent : 0x222222);
  px.set(5.5, cy + 1.3, alive ? col.accent : 0x222222);
  for (const s of [-1, 1]) {
    px.line(10, cy + s * 2, 12, cy + s * 5, ring);
    px.line(12, cy + s * 2, 15, cy + s * 5, ring);
    px.line(8, cy + s * 2, 7, cy + s * 5, ring);
    px.line(3, cy + s * 2, 1, cy + s * 4, ring);
  }
  // A little crown marks her out.
  if (alive) {
    px.set(5, cy - 4, 0xffd84a);
    px.set(3, cy - 5, 0xffd84a);
    px.set(5, cy - 5, 0xffd84a);
    px.set(7, cy - 5, 0xffd84a);
  }
}
