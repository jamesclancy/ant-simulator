import type { Texture } from 'pixi.js';
import type { Atlas } from '../atlas';
import { darken, lighten } from '../pixels';
import type { Px } from '../pixels';

/** Mower sprite size in art pixels: 40 along the direction of travel, 70 across (140 world units). */
export const MOWER_W = 40;
export const MOWER_H = 70;
/** Shoe sole size in art pixels (toe up); the foot's world radius is about half its height. */
export const SOLE_W = 30;
export const SOLE_H = 54;

export interface YardTextures {
  /** Two blade-spin frames, facing +x. */
  mower: Texture[];
  /** A shoe sole, toe up, in solid dark ink (tinted for the shadow and the print). */
  sole: Texture;
}

const BODY = 0xe0a020;
const DECK = 0xb8281c;
const METAL = [0x2a2a30, 0x4a4a52, 0x7a7a84, 0xb4b4bc];
const SOLE_INK = 0x2a1c14;

/** A circular blade disc with two blades; `turn` swaps between a "+" and an "x". */
function blades(px: Px, cx: number, cy: number, r: number, turn: boolean): void {
  px.ellipse(cx, cy, r, r, METAL[1]!);
  const arms = turn
    ? [
        [-r, -r, r, r],
        [-r, r, r, -r],
      ]
    : [
        [-r, 0, r, 0],
        [0, -r, 0, r],
      ];
  for (const [x0, y0, x1, y1] of arms) {
    px.line(cx + x0! * 0.9, cy + y0! * 0.9, cx + x1! * 0.9, cy + y1! * 0.9, METAL[3]!);
  }
  px.set(cx, cy, METAL[0]!);
}

export function registerYard(atlas: Atlas): YardTextures {
  const mower = [false, true].map((turn, frame) =>
    atlas.define(`yard/mower/${frame}`, MOWER_W, MOWER_H, (px) => {
      // Cutting deck: three blade discs along the front edge (right side).
      px.rect(18, 4, 20, 62, darken(DECK, 0.1));
      for (const cy of [16, 35, 54]) blades(px, 32, cy, 7, turn);
      // Engine housing and grass-bag shoulder.
      px.rect(6, 8, 16, 54, DECK);
      px.rect(8, 10, 12, 50, lighten(DECK, 0.12));
      px.ellipse(14, 35, 6, 9, BODY);
      px.ellipse(14, 35, 3, 5, darken(BODY, 0.3));
      px.rect(10, 12, 6, 3, METAL[3]!);
      px.rect(10, 55, 6, 3, METAL[3]!);
      // Handle bar and the wheels.
      px.rect(0, 12, 6, 2, METAL[0]!);
      px.rect(0, 56, 6, 2, METAL[0]!);
      px.rect(0, 12, 2, 46, METAL[0]!);
      px.rect(22, 2, 8, 4, METAL[0]!);
      px.rect(22, 64, 8, 4, METAL[0]!);
      px.outline(0x14141a, true);
    }),
  );
  const sole = atlas.define('yard/sole', SOLE_W, SOLE_H, (px) => {
    // Toe box, instep and heel, with a few tread bars cut out.
    px.ellipse(15, 15, 13, 15, SOLE_INK);
    px.ellipse(15, 29, 8, 10, SOLE_INK);
    px.ellipse(15, 43, 10, 10, SOLE_INK);
    for (const y of [9, 15, 21, 38, 44]) px.line(7, y, 23, y, lighten(SOLE_INK, 0.22));
    px.ellipse(15, 43, 4, 3, lighten(SOLE_INK, 0.15));
  });
  return { mower, sole };
}
