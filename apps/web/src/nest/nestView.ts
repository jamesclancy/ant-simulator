import { Container, Graphics, Text } from 'pixi.js';
import { ChamberKind, NEST_TILE, TileType } from '@ant/shared';
import type { ColonySnapshot, NestGridSnapshot, WaterGridSnapshot } from '@ant/shared';
import { WaterOverlay } from '../hazards/waterOverlay';

export const NEST_BACKGROUND = 0x140d08;
const T = NEST_TILE;

const KIND_TINT: Record<number, { fill: number; label: string }> = {
  [ChamberKind.Queen]: { fill: 0x4a2c28, label: 'Queen' },
  [ChamberKind.Food]: { fill: 0x4a4018, label: 'Food' },
  [ChamberKind.Nursery]: { fill: 0x2e3a4a, label: 'Nursery' },
};

/** Cheap deterministic per-tile noise in [0, 1). */
function hash(x: number, y: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function lerpColor(a: number, b: number, t: number): number {
  const r = ((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t;
  const g = ((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t;
  const bl = (a & 255) * (1 - t) + (b & 255) * t;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

function shade(color: number, k: number): number {
  const c = (v: number): number => Math.max(0, Math.min(255, Math.round(v * k)));
  return (c((color >> 16) & 255) << 16) | (c((color >> 8) & 255) << 8) | c(color & 255);
}

/**
 * Side-view cross-section of the nest: tinted soil, dark tunnels, labelled chambers,
 * the queen and brood. Add `view` to the stage and drive it with a `Camera`; underground
 * ants are drawn by an `AntLayer` (layer 1) parented to `view`.
 *
 * The grid arrives only when it changes (`NestGridSnapshot`); soil is drawn once, the
 * open tiles and labels are redrawn per grid version, brood/queen per snapshot change.
 */
export class NestView {
  readonly view = new Container();
  private soil = new Graphics();
  private features = new Graphics();
  private labels = new Container();
  private brood = new Graphics();
  private queen = new Graphics();
  private water = new WaterOverlay();
  /** Layer ants are drawn into (between tunnels and brood overlays is fine). */
  readonly antParent = new Container();
  private grid: NestGridSnapshot | null = null;
  private soilDrawn = false;
  private broodKey = '';
  private nurseryTiles: number[] = [];

  /** `colony` picks the queen's colours (0 black, 1 red). */
  constructor(readonly colony = 0) {
    this.view.addChild(
      this.soil,
      this.features,
      this.labels,
      this.brood,
      this.antParent,
      this.queen,
      this.water.view,
    );
    this.view.visible = false;
  }

  get gridSize(): { width: number; height: number; entranceX: number } | null {
    return this.grid
      ? { width: this.grid.width, height: this.grid.height, entranceX: this.grid.entranceX }
      : null;
  }

  /** Apply the parts of a snapshot this view cares about. */
  update(grid: NestGridSnapshot | undefined, colony: ColonySnapshot): void {
    if (grid) this.setGrid(grid);
    if (!this.grid) return;
    this.drawQueen(colony);
    this.drawBrood(colony);
  }

  /** Flood water for this nest (sent only when it changed). */
  setWater(w: WaterGridSnapshot | undefined): void {
    if (w) this.water.update(w.levels, w.version);
  }

  private setGrid(g: NestGridSnapshot): void {
    this.grid = g;
    if (!this.soilDrawn) {
      this.soilDrawn = true;
      this.drawSoil(g);
    }
    this.drawFeatures(g);
    this.broodKey = '';
  }

  private drawSoil(g: NestGridSnapshot): void {
    const { width: w, height: h } = g;
    const s = this.soil;
    s.clear();
    // Sky + grass along row 0, plus bleed past the grid sides.
    s.rect(-40 * T, -30 * T, (w + 80) * T, 30 * T).fill(0x6fb4d8);
    s.rect(-40 * T, 0, (w + 80) * T, T).fill(0x6fb4d8);
    s.rect(-40 * T, T - 4, (w + 80) * T, 4).fill(0x4f8f3a);
    for (let y = 1; y < h; y++) {
      const depth = y / h;
      const base = lerpColor(0x93653a, 0x4a2f1a, depth);
      for (let x = 0; x < w; x++) {
        s.rect(x * T, y * T, T + 0.5, T + 0.5).fill(shade(base, 0.88 + 0.24 * hash(x, y)));
      }
    }
    // Side/bottom bleed so the grid edge isn't a cliff.
    s.rect(-40 * T, T, 40 * T, (h - 1) * T + 40 * T).fill(0x4a3320);
    s.rect(w * T, T, 40 * T, (h - 1) * T + 40 * T).fill(0x4a3320);
    s.rect(0, h * T, w * T, 40 * T).fill(0x3a2716);
  }

  private drawFeatures(g: NestGridSnapshot): void {
    const { width: w, height: h, cells } = g;
    const f = this.features;
    f.clear();
    this.nurseryTiles = [];
    const kindTiles = new Map<number, number[]>();
    for (let i = 0; i < cells.length; i++) {
      const type = cells[i]! & 7;
      if (type === TileType.Soil || type === TileType.Air) continue;
      const x = i % w;
      const y = (i - x) / w;
      if (type === TileType.Rock) {
        f.roundRect(x * T, y * T, T, T, 3).fill(shade(0x8a8a8a, 0.8 + 0.3 * hash(x, y)));
        continue;
      }
      // Tunnels slightly overdrawn so neighbouring tiles merge into smooth passages.
      const kind = cells[i]! >> 3;
      const tint = KIND_TINT[kind];
      f.rect(x * T - 0.5, y * T - 0.5, T + 1, T + 1).fill(
        type === TileType.Chamber && tint ? shade(tint.fill, 0.85 + 0.3 * hash(x, y)) : 0x24170c,
      );
      if (kind) {
        const list = kindTiles.get(kind) ?? [];
        list.push(i);
        kindTiles.set(kind, list);
        if (kind === ChamberKind.Queen || kind === ChamberKind.Nursery) this.nurseryTiles.push(i);
      }
    }
    // Chamber labels: one per connected group of same-kind tiles.
    for (const child of this.labels.removeChildren()) child.destroy();
    for (const [kind, tiles] of kindTiles) {
      const set = new Set(tiles);
      for (const start of tiles) {
        if (!set.has(start)) continue;
        const group: number[] = [];
        const stack = [start];
        set.delete(start);
        while (stack.length) {
          const i = stack.pop()!;
          group.push(i);
          for (const n of [i - 1, i + 1, i - w, i + w]) {
            if (n >= 0 && n < w * h && set.has(n)) {
              set.delete(n);
              stack.push(n);
            }
          }
        }
        if (group.length < 4) continue;
        let top = Infinity;
        let cx = 0;
        for (const i of group) {
          const x = i % w;
          cx += x + 0.5;
          top = Math.min(top, Math.floor(i / w));
        }
        const label = new Text({
          text: KIND_TINT[kind]!.label,
          style: { fontSize: 9, fill: 0xffffff, fontFamily: 'system-ui, sans-serif' },
        });
        label.alpha = 0.55;
        label.anchor.set(0.5, 0);
        label.position.set((cx / group.length) * T, top * T + 1);
        this.labels.addChild(label);
      }
    }
  }

  private drawQueen(c: ColonySnapshot): void {
    const q = this.queen;
    q.clear();
    const x = (c.queenX + 0.5) * T;
    const y = (c.queenY + 0.5) * T;
    const red = this.colony === 1;
    const body = c.queenAlive ? (red ? 0xb02a18 : 0x7a3b1c) : 0x666666;
    const abdomen = c.queenAlive ? (red ? 0xe0603a : 0xe0b04a) : 0x888888;
    q.ellipse(x + 7, y, 9, 5)
      .fill(abdomen)
      .stroke({ color: 0x5a3a10, width: 0.6 });
    q.ellipse(x - 1, y, 4, 3.2).fill(body);
    q.ellipse(x - 6, y, 3.2, 2.8).fill(body);
    if (c.queenAlive) q.circle(x - 6, y - 4.5, 1.3).fill(0xffd84a); // crown
    if (c.queenAlive && c.queenHp < c.queenMaxHp) {
      // Health bar while she is being attacked.
      const w = 24;
      const f = Math.max(0, c.queenHp / c.queenMaxHp);
      q.rect(x - w / 2, y - 12, w, 3).fill(0x220000);
      q.rect(x - w / 2, y - 12, w * f, 3).fill(f > 0.5 ? 0x5ad04a : f > 0.25 ? 0xe0c040 : 0xe04030);
    }
  }

  private drawBrood(c: ColonySnapshot): void {
    const key = `${c.eggs}:${c.larvae}:${c.pupae}`;
    if (key === this.broodKey) return;
    this.broodKey = key;
    const g = this.brood;
    g.clear();
    const tiles = this.nurseryTiles.filter((i) => i !== c.queenY * this.grid!.width + c.queenX);
    if (!tiles.length) return;
    const w = this.grid!.width;
    let k = 0;
    const place = (): { x: number; y: number } => {
      const tile = tiles[k % tiles.length]!;
      const sub = Math.floor(k / tiles.length) % 4;
      k++;
      const tx = tile % w;
      const ty = (tile - tx) / w;
      return { x: tx * T + 3 + (sub % 2) * 6, y: ty * T + 3 + (sub >> 1) * 6 };
    };
    for (let n = 0; n < c.eggs; n++) {
      const p = place();
      g.circle(p.x, p.y, 1.8).fill(0xf4f0e0);
    }
    for (let n = 0; n < c.larvae; n++) {
      const p = place();
      g.ellipse(p.x, p.y, 3.2, 2).fill(0xe8d9a8).stroke({ color: 0xb89c5a, width: 0.5 });
    }
    for (let n = 0; n < c.pupae; n++) {
      const p = place();
      g.roundRect(p.x - 3.5, p.y - 2, 7, 4, 2).fill(0xa8752c);
    }
  }
}
