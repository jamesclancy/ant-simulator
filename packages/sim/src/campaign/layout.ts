import type { PatchKind } from '@ant/shared';
import { createRng } from '../rng';

/** Yard grid size: `YARD_COLS x YARD_ROWS` patches, plus the house rooms above it. */
export const YARD_COLS = 8;
export const YARD_ROWS = 6;

/**
 * House rooms: a 3x2 block of patches above the yard's top row (rows -1 and -2), so the
 * row -1 rooms border the yard. Kitchen and pantry hold rich food; the rest is bare tile.
 */
const ROOMS: readonly { name: string; col: number; row: number; rich: boolean }[] = [
  { name: 'Kitchen', col: 2, row: -1, rich: true },
  { name: 'Hall', col: 3, row: -1, rich: false },
  { name: 'Living room', col: 4, row: -1, rich: false },
  { name: 'Pantry', col: 2, row: -2, rich: true },
  { name: 'Bathroom', col: 3, row: -2, rich: false },
  { name: 'Bedroom', col: 4, row: -2, rich: false },
];

/** Static, seed-derived facts about a patch (never saved: rebuilt from the campaign seed). */
export interface PatchDef {
  id: number;
  col: number;
  row: number;
  kind: PatchKind;
  name: string;
  /** Seed of the patch's detailed world. */
  seed: number;
  /** Natural food the patch holds at most, and regrows per abstract tick. */
  foodCap: number;
  foodRegen: number;
  /** Food piles in the detailed world. */
  piles: number;
  /** The detailed world has a spider / an antlion pit. */
  spider: boolean;
  antlion: boolean;
}

/** All 54 patches: yard ids `row * YARD_COLS + col`, then the rooms. Deterministic per seed. */
export function buildLayout(seed: number): PatchDef[] {
  const rng = createRng(seed ^ 0x1a7d5eed);
  const defs: PatchDef[] = [];
  for (let row = 0; row < YARD_ROWS; row++) {
    for (let col = 0; col < YARD_COLS; col++) {
      const richness = rng.range(0.6, 1.4);
      defs.push({
        id: defs.length,
        col,
        row,
        kind: 'yard',
        name: '',
        seed: (rng.next() * 0x7fffffff) | 0,
        foodCap: Math.round(5000 * richness),
        foodRegen: Math.round(60 * richness),
        piles: 4 + rng.int(3),
        spider: rng.next() < 0.3,
        antlion: rng.next() < 0.25,
      });
    }
  }
  for (const room of ROOMS) {
    defs.push({
      id: defs.length,
      col: room.col,
      row: room.row,
      kind: 'room',
      name: room.name,
      seed: (rng.next() * 0x7fffffff) | 0,
      foodCap: room.rich ? 9000 : 1200,
      foodRegen: room.rich ? 120 : 15,
      piles: room.rich ? 2 : 1,
      spider: false,
      antlion: false,
    });
  }
  return defs;
}

/** Chebyshev distance between two patches on the map (rooms included). */
export function patchDistance(a: PatchDef, b: PatchDef): number {
  return Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
}
