import { Sprite, Texture } from 'pixi.js';
import type { Container } from 'pixi.js';
import type { PheromoneSnapshot } from '@ant/shared';

import type { Art } from './art';

const MAX_ALPHA = 0.85;

/**
 * "Scent vision": draws quantized pheromone layers as one semi-transparent
 * texture stretched over the world. Layers are blended by intensity-weighted
 * colour; opacity follows the strongest layer in each cell.
 */
export class ScentOverlay {
  readonly view: Sprite;
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private image: ImageData | null = null;
  private pixels: Uint32Array | null = null;
  private texture: Texture | null = null;
  private worldSize: number;
  /** Minimum ms between repaints (the governor raises it on slow devices). */
  minIntervalMs = 0;
  private lastPaint = -Infinity;

  constructor(
    parent: Container,
    worldSize: number,
    private readonly art: Art,
  ) {
    this.worldSize = worldSize;
    this.view = new Sprite();
    this.view.visible = false;
    parent.addChild(this.view);
  }

  get visible(): boolean {
    return this.view.visible;
  }

  setVisible(visible: boolean): void {
    this.view.visible = visible;
  }

  /** Repaint from a snapshot's pheromone block. Cheap enough at ~5Hz for 256². */
  update(p: PheromoneSnapshot): void {
    const t = performance.now();
    if (t - this.lastPaint < this.minIntervalMs) return;
    this.lastPaint = t;
    const res = p.resolution;
    if (!this.image || this.canvas.width !== res) this.resize(res);
    const px = this.pixels!;
    const n = res * res;
    const layers = p.types.length;
    const scent = this.art.palette.scent;
    const rgb = p.types.map((t) => scent[t] ?? ([255, 255, 255] as const));
    for (let i = 0; i < n; i++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let sum = 0;
      let peak = 0;
      for (let l = 0; l < layers; l++) {
        const v = p.data[l * n + i]!;
        if (v === 0) continue;
        const c = rgb[l]!;
        r += c[0] * v;
        g += c[1] * v;
        b += c[2] * v;
        sum += v;
        if (v > peak) peak = v;
      }
      if (sum === 0) {
        px[i] = 0;
        continue;
      }
      const a = (peak * MAX_ALPHA) | 0;
      // Little-endian ABGR; non-premultiplied, Pixi premultiplies on upload.
      px[i] = (a << 24) | (((b / sum) | 0) << 16) | (((g / sum) | 0) << 8) | ((r / sum) | 0);
    }
    this.ctx.putImageData(this.image!, 0, 0);
    this.texture!.source.update();
  }

  private resize(res: number): void {
    this.canvas.width = res;
    this.canvas.height = res;
    this.image = this.ctx.createImageData(res, res);
    this.pixels = new Uint32Array(this.image.data.buffer);
    this.texture?.destroy(true);
    this.texture = Texture.from(this.canvas, true);
    this.texture.source.scaleMode = 'nearest';
    this.view.texture = this.texture;
    this.view.width = this.worldSize;
    this.view.height = this.worldSize;
  }
}
