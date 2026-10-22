import type { Texture } from 'pixi.js';
import { Atlas } from './atlas';
import { paletteFor } from './palette';
import type { Palette, PaletteMode } from './palette';
import { makeGroundTexture } from './ground';
import { registerAnts } from './sprites/ants';
import type { AntTextures } from './sprites/ants';
import { registerNest } from './sprites/nest';
import type { NestTextures } from './sprites/nest';
import { jawTextures, pitTexture, registerSpider } from './sprites/creatures';
import type { SpiderTextures } from './sprites/creatures';
import {
  dirtHeapTexture,
  foodTexture,
  glintTexture,
  moundTexture,
  registerDecor,
  registerRain,
  rockTexture,
} from './sprites/world';
import type { DecorTextures, FoodKind, RainTextures } from './sprites/world';
import { registerYard } from './sprites/yard';
import type { YardTextures } from './sprites/yard';

export { PALETTE_LABELS, PALETTE_MODES, paletteFor } from './palette';
export type { PaletteMode, Palette } from './palette';

type Listener = (palette: Palette) => void;

/** Every sprite the renderer draws, packed into one atlas, plus the active accessibility palette. */
export class Art {
  readonly atlas: Atlas;
  readonly ants: AntTextures;
  readonly nest: NestTextures;
  readonly spider: SpiderTextures;
  readonly decor: DecorTextures;
  readonly rain: RainTextures;
  readonly yard: YardTextures;
  readonly jaws: Texture[];
  readonly groundTile: Texture;
  private pal: Palette;
  private readonly listeners = new Set<Listener>();

  constructor(mode: PaletteMode = 'default') {
    this.pal = paletteFor(mode);
    this.atlas = new Atlas(this.pal, 1024);
    this.ants = registerAnts(this.atlas);
    this.nest = registerNest(this.atlas);
    this.spider = registerSpider(this.atlas);
    this.decor = registerDecor(this.atlas);
    this.rain = registerRain(this.atlas);
    this.yard = registerYard(this.atlas);
    this.jaws = jawTextures(this.atlas);
    this.groundTile = makeGroundTexture();
  }

  get palette(): Palette {
    return this.pal;
  }

  /** Switch accessibility palette: sprites are redrawn in place, listeners refresh anything derived. */
  setMode(mode: PaletteMode): void {
    if (mode === this.pal.mode) return;
    this.pal = paletteFor(mode);
    this.atlas.setPalette(this.pal);
    for (const fn of this.listeners) fn(this.pal);
  }

  onPalette(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Surface world units per art pixel for a world radius, as whole art pixels (min 2). */
  private px(worldRadius: number, per: number): number {
    return Math.max(2, Math.round(worldRadius / per));
  }

  /** Food pile sprite; piles never draw smaller than 4 art pixels in radius, however depleted. */
  food(kind: FoodKind, worldRadius: number, id: number): Texture {
    return foodTexture(this.atlas, kind, Math.max(4, this.px(worldRadius, 2)), id % 3);
  }
  glint(frame: number): Texture {
    return glintTexture(this.atlas, frame);
  }
  rock(worldRadius: number, id: number): Texture {
    return rockTexture(this.atlas, this.px(worldRadius, 2), id % 3);
  }
  mound(colony: number, worldRadius: number): Texture {
    const r = this.px(worldRadius * 1.6, 2);
    return moundTexture(this.atlas, colony, r, Math.max(3, Math.round(r / 1.9)));
  }
  dirtHeap(level: number): Texture {
    return dirtHeapTexture(this.atlas, Math.max(0, Math.min(4, level)));
  }
  pit(worldRadius: number, frame: 0 | 1 | 2): Texture {
    return pitTexture(this.atlas, this.px(worldRadius, 2), frame);
  }
}
