import { Container, Sprite, Texture, TilingSprite } from 'pixi.js';
import type { Art } from './index';
import { T } from './palette';
import { hash2, rng } from './pixels';
import { SURFACE_PX } from './sprites/world';

const TILE = 128;
const LATTICE = 8;
const CELL = TILE / LATTICE;

/** Periodic value noise in [0, 1) so the ground tile repeats seamlessly. */
function noise(x: number, y: number, salt: number): number {
  const fx = x / CELL;
  const fy = y / CELL;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const h = (i: number, j: number): number =>
    hash2((i + LATTICE) % LATTICE, (j + LATTICE) % LATTICE, salt);
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = h(x0, y0) + (h(x0 + 1, y0) - h(x0, y0)) * sx;
  const b = h(x0, y0 + 1) + (h(x0 + 1, y0 + 1) - h(x0, y0 + 1)) * sx;
  return a + (b - a) * sy;
}

/** Seamless grass tile on its own repeating canvas texture. */
export function makeGroundTexture(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = TILE;
  canvas.height = TILE;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(TILE, TILE);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const n = noise(x, y, 1) * 0.65 + noise(x * 2, y * 2, 2) * 0.35;
      const speck = hash2(x, y, 9);
      let tone = n > 0.62 ? 3 : n > 0.5 ? 2 : n > 0.36 ? 1 : 0;
      if (speck > 0.965) tone = Math.min(4, tone + 1);
      else if (speck < 0.03) tone = Math.max(0, tone - 1);
      // Short vertical blades give the lawn grain.
      if (hash2(x, y, 4) > 0.985) tone = 4;
      const c = T.grass[tone]!;
      const i = (y * TILE + x) * 4;
      img.data[i] = (c >> 16) & 255;
      img.data[i + 1] = (c >> 8) & 255;
      img.data[i + 2] = c & 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = Texture.from(canvas, true);
  tex.source.scaleMode = 'nearest';
  tex.source.addressMode = 'repeat';
  return tex;
}

/**
 * The yard floor: a repeating lawn tile plus seeded tufts, pebbles, bare patches and leaves,
 * and rain puddles that fade in with `setWetness`. Static, so it costs one batch of draws.
 */
export class GroundLayer {
  readonly view = new Container();
  private readonly puddles = new Container();

  constructor(
    art: Art,
    worldSize: number,
    seed: number,
    keepClear: readonly { x: number; y: number }[],
  ) {
    const lawn = new TilingSprite({ texture: art.groundTile, width: worldSize, height: worldSize });
    lawn.tileScale.set(SURFACE_PX);
    this.view.addChild(lawn);
    const d = art.decor;
    const rand = rng(seed ^ 0x51ed);
    const decor = new Container();
    const away = (x: number, y: number): boolean =>
      keepClear.every((p) => Math.hypot(p.x - x, p.y - y) > 70);
    const place = (list: Texture[], count: number, alpha = 1): void => {
      for (let i = 0; i < count; i++) {
        const x = Math.round(rand() * worldSize);
        const y = Math.round(rand() * worldSize);
        const tex = list[Math.floor(rand() * list.length)]!;
        if (!away(x, y)) continue;
        const s = new Sprite(tex);
        s.anchor.set(0.5, 0.8);
        s.scale.set(SURFACE_PX);
        s.position.set(x, y);
        s.alpha = alpha;
        decor.addChild(s);
      }
    };
    const n = (worldSize / 2048) ** 2;
    place(d.patches, Math.round(60 * n), 0.9);
    place(d.leaves, Math.round(40 * n));
    place(d.pebbles, Math.round(120 * n));
    place(d.clover, Math.round(110 * n));
    place(d.grass, Math.round(420 * n));
    this.view.addChild(decor);
    for (let i = 0; i < Math.round(26 * n); i++) {
      const x = Math.round(rand() * worldSize);
      const y = Math.round(rand() * worldSize);
      if (!away(x, y)) continue;
      const s = new Sprite(d.puddles[i % d.puddles.length]);
      s.anchor.set(0.5);
      s.scale.set(SURFACE_PX * (1 + Math.floor(rand() * 2)));
      s.position.set(x, y);
      this.puddles.addChild(s);
    }
    this.puddles.visible = false;
    this.view.addChild(this.puddles);
    this.view.eventMode = 'none';
  }

  /** 0..1: how much standing water to show. */
  setWetness(w: number): void {
    this.puddles.visible = w > 0.03;
    this.puddles.alpha = Math.min(1, w * 1.4);
  }
}
