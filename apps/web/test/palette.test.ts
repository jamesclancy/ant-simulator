import { describe, expect, it } from 'vitest';
import { PALETTE_MODES, T, paletteFor } from '../src/art/palette';
import type { PaletteMode } from '../src/art/palette';
import { CLEAR, Px, hash2, mix } from '../src/art/pixels';

type M = readonly [readonly number[], readonly number[], readonly number[]];
// Machado et al. 2009, severity 1.0, applied in linear RGB.
const CVD: Partial<Record<PaletteMode, M>> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

const lin = (v: number): number =>
  (v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const toLab = (rgb: number[]): [number, number, number] => {
  const [r, g, b] = rgb as [number, number, number];
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
};
/** CIE76 distance between two 0xRRGGBB colours as seen through `mode`'s colour deficiency. */
function seen(a: number, b: number, mode: PaletteMode): number {
  const m = CVD[mode];
  const conv = (c: number): [number, number, number] => {
    const l = [lin((c >> 16) & 255), lin((c >> 8) & 255), lin(c & 255)];
    const o = m ? m.map((row) => row[0]! * l[0]! + row[1]! * l[1]! + row[2]! * l[2]!) : l;
    return toLab(o.map((v) => Math.min(1, Math.max(0, v))));
  };
  const [x, y] = [conv(a), conv(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

describe('palettes', () => {
  const ground = T.grass[1];
  for (const mode of PALETTE_MODES) {
    it(`${mode}: colonies and the player are told apart, and stand out from the lawn`, () => {
      const p = paletteFor(mode);
      const [c0, c1] = p.colonies;
      expect(seen(c0.body, c1.body, mode)).toBeGreaterThan(30);
      expect(seen(c0.body, p.player.body, mode)).toBeGreaterThan(30);
      expect(seen(c1.body, p.player.body, mode)).toBeGreaterThan(18);
      // Ants carry a dark/light rim, so either body or rim must contrast with the grass.
      for (const col of [c0, c1, p.player]) {
        const best = Math.max(seen(col.body, ground, mode), seen(col.outline, ground, mode));
        expect(best).toBeGreaterThan(25);
      }
    });

    it(`${mode}: food reads against the lawn, the decor and its own outline`, () => {
      const f = paletteFor(mode).food;
      for (const body of [f.crumb[2], f.sugar[2], f.corpse[2]]) {
        // Every pile has a dark ring, so the body must beat the grass and the ring must beat it too.
        expect(seen(body, ground, mode)).toBeGreaterThan(25);
        expect(seen(f.outline, ground, mode)).toBeGreaterThan(25);
        expect(seen(body, f.outline, mode)).toBeGreaterThan(40);
      }
      // Piles are told apart from each other by hue/lightness, not shape alone.
      expect(seen(f.crumb[2], f.sugar[2], mode)).toBeGreaterThan(15);
      expect(seen(f.crumb[2], f.corpse[2], mode)).toBeGreaterThan(25);
    });

    it(`${mode}: scent layers stay distinguishable`, () => {
      const s = paletteFor(mode).scent;
      const pack = (c: readonly number[]): number => (c[0]! << 16) | (c[1]! << 8) | c[2]!;
      const list = [s.food, s.home, s.alarm, s.enemy].map(pack);
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++)
          expect(seen(list[i]!, list[j]!, mode)).toBeGreaterThan(18);
    });
  }

  it('falls back to the default palette for unknown modes', () => {
    expect(paletteFor('nope' as PaletteMode).mode).toBe('default');
  });
});

describe('pixel buffers', () => {
  it('parses ASCII grids and outlines them', () => {
    const px = Px.fromGrid(['.a.', 'aaa', '.a.'], { a: 0xff0000 });
    expect(px.get(1, 1)).toBe(0xff0000);
    expect(px.get(0, 0)).toBe(CLEAR);
    px.outline(0x000000);
    expect(px.get(-1, 0)).toBe(CLEAR);
  });

  it('ellipses are symmetric and bounded', () => {
    const px = new Px(11, 11);
    px.ellipse(5, 5, 3, 3, 1);
    expect(px.get(5, 5)).toBe(1);
    expect(px.get(5, 1)).toBe(CLEAR);
    expect(px.get(2, 5)).toBe(px.get(8, 5));
  });

  it('hash2 and mix behave', () => {
    expect(hash2(3, 4)).toBe(hash2(3, 4));
    expect(hash2(3, 4)).not.toBe(hash2(4, 3));
    expect(mix(0x000000, 0xffffff, 0.5)).toBe(0x808080);
  });
});
