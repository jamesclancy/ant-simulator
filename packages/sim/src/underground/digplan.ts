import { ChamberKind, TileType } from '@ant/shared';
import type { Rng } from '../rng';
import type { NestGrid } from './grid';

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [-1, 0],
  [1, 0],
];

/** Chamber kinds the planner cycles through when it adds a chamber. */
const CHAMBER_CYCLE = [ChamberKind.Nursery, ChamberKind.Nursery, ChamberKind.Food] as const;

/**
 * Decides what to dig next. Keeps a queue of planned tiles (`tile`, `type`, `kind`); the
 * front is the current dig target. Plans alternate between tunnel segments (random
 * downward/sideways, possibly branching off any tile dug so far) and rectangular
 * chambers. Every queued tile is 4-adjacent to an open or earlier-queued tile, so a
 * digger can always reach its face. Deterministic per rng stream.
 */
export class DigPlanner {
  private tile: number[] = [];
  private type: TileType[] = [];
  private kind: ChamberKind[] = [];
  private cursor = 0;
  private segments = 0;
  private chambers = 0;
  /** Open tiles to branch from (dug tiles and starter chamber edges). */
  private branches: number[] = [];

  constructor(
    private grid: NestGrid,
    private rng: Rng,
  ) {
    for (let i = 0; i < grid.size; i++) if (grid.isOpenIndex(i)) this.branches.push(i);
  }

  /** Tile currently being dug, or -1 when nothing is plannable. Refills the queue as needed. */
  target(): number {
    for (let tries = 0; tries < 4; tries++) {
      while (this.cursor < this.tile.length) {
        const t = this.tile[this.cursor]!;
        if (this.grid.tiles[t] === TileType.Soil) return t;
        this.cursor++; // already open or became rock: skip
      }
      this.tile.length = this.type.length = this.kind.length = this.cursor = 0;
      this.plan();
    }
    return -1;
  }

  /** Dig the current target: convert it and advance. */
  dig(): void {
    const t = this.tile[this.cursor];
    if (t === undefined) return;
    this.grid.set(t, this.type[this.cursor]!, this.kind[this.cursor]);
    this.branches.push(t);
    this.cursor++;
    this.grid.refresh();
  }

  private diggable(x: number, y: number): boolean {
    const g = this.grid;
    return (
      x >= 1 &&
      x < g.width - 1 &&
      y >= 2 &&
      y < g.height - 1 &&
      g.tiles[g.idx(x, y)] === TileType.Soil
    );
  }

  private plan(): void {
    const { grid, rng } = this;
    for (let attempt = 0; attempt < 12; attempt++) {
      const head = this.branches[rng.int(this.branches.length)]!;
      const hx = head % grid.width;
      const hy = (head - hx) / grid.width;
      const d = DIRS[rng.int(DIRS.length)]!;
      const ax = hx + d[0];
      const ay = hy + d[1];
      if (!this.diggable(ax, ay)) continue;
      const wantChamber = this.segments >= 3 && this.chambers * 4 <= this.segments;
      if (wantChamber) {
        const w = 4 + rng.int(2);
        const h = 3;
        // Rect extends away from the head, with the anchor tile mid-way along the near edge.
        const x0 = d[0] > 0 ? ax : d[0] < 0 ? ax - w + 1 : ax - (w >> 1);
        const y0 = d[1] > 0 ? ay : ay - 1;
        const kind = CHAMBER_CYCLE[this.chambers % CHAMBER_CYCLE.length]!;
        if (this.queueRect(x0, y0, w, h, ax, ay, kind)) {
          this.chambers++;
          this.segments = 0;
          return;
        }
      } else {
        const len = 5 + rng.int(6);
        let x = ax;
        let y = ay;
        let n = 0;
        while (n < len && this.diggable(x, y)) {
          this.push(grid.idx(x, y), TileType.Tunnel, ChamberKind.None);
          n++;
          // Mostly straight, occasionally stepping down to keep tunnels sloping.
          if (n % 4 === 0 && d[1] === 0 && rng.next() < 0.5) y++;
          else {
            x += d[0];
            y += d[1];
          }
        }
        if (n > 0) {
          this.segments++;
          return;
        }
      }
    }
  }

  /** Queue a rect in BFS order from the anchor; false if the anchor is not inside it. */
  private queueRect(
    x0: number,
    y0: number,
    w: number,
    h: number,
    ax: number,
    ay: number,
    kind: ChamberKind,
  ): boolean {
    if (ax < x0 || ax >= x0 + w || ay < y0 || ay >= y0 + h) return false;
    const seen = new Set<number>();
    const order: number[] = [];
    const g = this.grid;
    const start = g.idx(ax, ay);
    seen.add(start);
    order.push(start);
    for (let q = 0; q < order.length; q++) {
      const i = order[q]!;
      const x = i % g.width;
      const y = (i - x) / g.width;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < x0 || nx >= x0 + w || ny < y0 || ny >= y0 + h) continue;
        const ni = g.idx(nx, ny);
        if (seen.has(ni) || !this.diggable(nx, ny)) continue;
        seen.add(ni);
        order.push(ni);
      }
    }
    if (order.length < (w * h) / 2) return false;
    for (const i of order) this.push(i, TileType.Chamber, kind);
    return true;
  }

  private push(tile: number, type: TileType, kind: ChamberKind): void {
    this.tile.push(tile);
    this.type.push(type);
    this.kind.push(kind);
  }
}
