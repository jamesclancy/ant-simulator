import { Rectangle, Texture } from 'pixi.js';
import type { Palette } from './palette';
import { Px } from './pixels';

export type Draw = (px: Px, palette: Palette) => void;

interface Entry {
  x: number;
  y: number;
  w: number;
  h: number;
  draw: Draw;
  texture: Texture;
}

/**
 * One shared canvas texture holding every sprite (nearest-neighbour sampled). Sprites are
 * authored as draw functions over a `Px` buffer; their rectangles are fixed when first
 * defined, so a palette change just redraws the pixels in place and every `Texture` handed
 * out earlier shows the new colours without anyone re-fetching it.
 */
export class Atlas {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly base: Texture;
  private readonly entries = new Map<string, Entry>();
  private cursorX = 0;
  private cursorY = 0;
  private rowH = 0;
  private palette: Palette;

  constructor(
    palette: Palette,
    readonly size = 1024,
  ) {
    this.palette = palette;
    this.canvas = document.createElement('canvas');
    this.canvas.width = size;
    this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d')!;
    this.base = Texture.from(this.canvas, true);
    this.base.source.scaleMode = 'nearest';
    this.base.source.autoGenerateMipmaps = false;
  }

  /** Fraction of the atlas area used (for tests and budget checks). */
  get used(): number {
    return (this.cursorY * this.size + this.rowH * this.cursorX) / (this.size * this.size);
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  get(key: string): Texture {
    const e = this.entries.get(key);
    if (!e) throw new Error(`missing sprite '${key}'`);
    return e.texture;
  }

  /** Define (once) and draw a sprite. Returns the existing texture if `key` is known. */
  define(key: string, w: number, h: number, draw: Draw): Texture {
    const known = this.entries.get(key);
    if (known) return known.texture;
    if (this.cursorX + w + 1 > this.size) {
      this.cursorX = 0;
      this.cursorY += this.rowH + 1;
      this.rowH = 0;
    }
    if (this.cursorY + h + 1 > this.size) throw new Error('sprite atlas is full');
    const x = this.cursorX;
    const y = this.cursorY;
    this.cursorX += w + 1;
    this.rowH = Math.max(this.rowH, h);
    const texture = new Texture({ source: this.base.source, frame: new Rectangle(x, y, w, h) });
    const entry: Entry = { x, y, w, h, draw, texture };
    this.entries.set(key, entry);
    this.paint(entry);
    this.base.source.update();
    return texture;
  }

  /** Redraw every sprite with a new palette (same rectangles). */
  setPalette(palette: Palette): void {
    this.palette = palette;
    for (const e of this.entries.values()) this.paint(e);
    this.base.source.update();
  }

  private paint(e: Entry): void {
    const px = new Px(e.w, e.h);
    e.draw(px, this.palette);
    this.ctx.putImageData(new ImageData(px.toRgba(), e.w, e.h), e.x, e.y);
  }
}
