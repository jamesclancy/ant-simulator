import { Container, Graphics, Particle, ParticleContainer, Sprite, Text } from 'pixi.js';
import { ChamberKind, NEST_TILE, TileType } from '@ant/shared';
import type { ColonySnapshot, NestGridSnapshot, WaterGridSnapshot } from '@ant/shared';
import { WaterOverlay } from '../hazards/waterOverlay';
import type { Art } from '../art';
import { E, N, S, SOIL_BANDS, SOIL_VARIANTS, W } from '../art/sprites/nest';
import { T as PAL } from '../art/palette';
import { hash2 } from '../art/pixels';

export const NEST_BACKGROUND = 0x140d08;
const LARVA_MS = 600;
const T = NEST_TILE;

const KIND_LABEL: Record<number, string> = {
  [ChamberKind.Queen]: 'Queen',
  [ChamberKind.Food]: 'Food',
  [ChamberKind.Nursery]: 'Nursery',
};

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
  private bleed = new Graphics();
  private soil = new ParticleContainer({ dynamicProperties: { position: false } });
  private features = new Container();
  private labels = new Container();
  private brood = new Container();
  private queen = new Container();
  private queenSprite: Sprite;
  private queenBar = new Graphics();
  private water: WaterOverlay;
  /** Layer ants are drawn into (between tunnels and brood overlays is fine). */
  readonly antParent = new Container();
  private grid: NestGridSnapshot | null = null;
  private soilDrawn = false;
  private broodKey = '';
  private nurseryTiles: number[] = [];
  private cells: Sprite[] = [];
  private larvae: Sprite[] = [];
  private larvaFrame = 0;
  private reduceMotion = false;

  /** `colony` picks the queen's art (0 black, 1 red). */
  constructor(
    readonly colony: number,
    private readonly art: Art,
  ) {
    this.water = new WaterOverlay(art);
    this.queenSprite = new Sprite(art.ants.queen[colony === 1 ? 1 : 0]);
    this.queenSprite.anchor.set(0.2, 0.5);
    this.queen.addChild(this.queenSprite, this.queenBar);
    this.view.addChild(
      this.bleed,
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

  setReduceMotion(on: boolean): void {
    this.reduceMotion = on;
    this.water.setReduceMotion(on);
  }

  /** Per-frame animation: rippling water and wriggling larvae. */
  tick(now: number): void {
    this.water.tick(now);
    if (this.reduceMotion) return;
    const f = Math.floor(now / LARVA_MS) % 2;
    if (f === this.larvaFrame) return;
    this.larvaFrame = f;
    for (const l of this.larvae) l.texture = this.art.nest.larva[f]!;
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
    const nest = this.art.nest;
    const b = this.bleed;
    b.clear();
    // Sky above, packed earth beyond the grid sides and bottom so its edge isn't a cliff.
    b.rect(-40 * T, -30 * T, (w + 80) * T, 30 * T).fill(PAL.sky);
    b.rect(-40 * T, T, 40 * T, (h - 1) * T + 40 * T).fill(0x4a3320);
    b.rect(w * T, T, 40 * T, (h - 1) * T + 40 * T).fill(0x4a3320);
    b.rect(0, h * T, w * T, 40 * T).fill(0x3a2716);
    for (const p of this.soil.particleChildren.slice()) this.soil.removeParticle(p);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const band = Math.min(SOIL_BANDS - 1, Math.floor((y / h) * SOIL_BANDS));
        const texture =
          y === 0
            ? nest.grass[hash2(x, 0, 3) > 0.5 ? 1 : 0]!
            : nest.soil[band]![Math.floor(hash2(x, y) * SOIL_VARIANTS)]!;
        this.soil.addParticle(new Particle({ texture, x: x * T, y: y * T }));
      }
    }
    this.soil.update();
  }

  private drawFeatures(g: NestGridSnapshot): void {
    const { width: w, height: h, cells } = g;
    const nest = this.art.nest;
    this.nurseryTiles = [];
    const kindTiles = new Map<number, number[]>();
    const solid = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= w || y >= h) return false;
      const t = cells[y * w + x]! & 7;
      return t === TileType.Soil || t === TileType.Rock;
    };
    if (this.cells.length !== cells.length) {
      for (const c of this.cells) c.destroy();
      this.features.removeChildren();
      this.cells = Array.from(cells, (_, i) => {
        const s = new Sprite();
        s.position.set((i % w) * T, Math.floor(i / w) * T);
        s.visible = false;
        this.features.addChild(s);
        return s;
      });
    }
    for (let i = 0; i < cells.length; i++) {
      const type = cells[i]! & 7;
      const spr = this.cells[i]!;
      const x = i % w;
      const y = (i - x) / w;
      if (type === TileType.Soil || type === TileType.Air) {
        spr.visible = false;
        continue;
      }
      spr.visible = true;
      if (type === TileType.Rock) {
        spr.texture = nest.rock[hash2(x, y) > 0.5 ? 1 : 0]!;
        continue;
      }
      const mask =
        (solid(x, y - 1) ? N : 0) |
        (solid(x + 1, y) ? E : 0) |
        (solid(x, y + 1) ? S : 0) |
        (solid(x - 1, y) ? W : 0);
      const kind = cells[i]! >> 3;
      spr.texture =
        type === TileType.Chamber && kind ? nest.chamber[kind]![mask]! : nest.tunnel[mask]!;
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
          text: KIND_LABEL[kind]!,
          style: { fontSize: 10, fill: 0xffffff, fontFamily: '"Pixelify Sans", monospace' },
        });
        label.alpha = 0.6;
        label.anchor.set(0.5, 0);
        label.position.set(Math.round((cx / group.length) * T), top * T + 1);
        this.labels.addChild(label);
      }
    }
  }

  private drawQueen(c: ColonySnapshot): void {
    const q = this.queenSprite;
    q.texture = c.queenAlive
      ? this.art.ants.queen[this.colony === 1 ? 1 : 0]!
      : this.art.ants.queenDead;
    const x = Math.round((c.queenX + 0.5) * T);
    const y = Math.round((c.queenY + 0.5) * T);
    q.position.set(x, y);
    const bar = this.queenBar;
    bar.clear();
    if (c.queenAlive && c.queenHp < c.queenMaxHp) {
      // Health bar while she is being attacked.
      const w = 24;
      const f = Math.max(0, c.queenHp / c.queenMaxHp);
      bar.rect(x - w / 2, y - 14, w, 4).fill(0x220000);
      bar
        .rect(x - w / 2 + 1, y - 13, Math.round((w - 2) * f), 2)
        .fill(f > 0.5 ? 0x5ad04a : f > 0.25 ? 0xe0c040 : 0xe04030);
    }
  }

  private drawBrood(c: ColonySnapshot): void {
    const key = `${c.eggs}:${c.larvae}:${c.pupae}`;
    if (key === this.broodKey) return;
    this.broodKey = key;
    for (const child of this.brood.removeChildren()) child.destroy();
    this.larvae = [];
    const tiles = this.nurseryTiles.filter((i) => i !== c.queenY * this.grid!.width + c.queenX);
    if (!tiles.length) return;
    const w = this.grid!.width;
    const nest = this.art.nest;
    let k = 0;
    const place = (tex: Sprite['texture']): Sprite => {
      const tile = tiles[k % tiles.length]!;
      const sub = Math.floor(k / tiles.length) % 4;
      k++;
      const tx = tile % w;
      const ty = (tile - tx) / w;
      const s = new Sprite(tex);
      s.position.set(tx * T + 1 + (sub % 2) * 5, ty * T + 1 + (sub >> 1) * 5);
      this.brood.addChild(s);
      return s;
    };
    for (let n = 0; n < c.eggs; n++) place(nest.egg);
    for (let n = 0; n < c.larvae; n++) this.larvae.push(place(nest.larva[this.larvaFrame]!));
    for (let n = 0; n < c.pupae; n++) place(nest.pupa);
  }
}
