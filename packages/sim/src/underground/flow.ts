import type { NestGrid } from './grid';

export const UNREACHABLE = 0xffff;

/**
 * Walking-distance field over a nest grid: BFS (4-neighbour) over open tiles from a set
 * of goal tiles. An ant steers to its lowest-distance neighbour, so any number of ants
 * share one field and per-ant navigation is four array reads. Fields are rebuilt lazily
 * when the grid or goal changes (a few thousand tiles, so well under a millisecond).
 */
export class FlowField {
  readonly dist: Uint16Array;
  private queue: Int32Array;
  dirty = true;

  constructor(private grid: NestGrid) {
    this.dist = new Uint16Array(grid.size);
    this.queue = new Int32Array(grid.size);
  }

  /** Rebuild from `goals` (flat tile indices; non-open goals are ignored). */
  rebuild(goals: Iterable<number>): void {
    const { grid, dist, queue } = this;
    const w = grid.width;
    const h = grid.height;
    dist.fill(UNREACHABLE);
    let head = 0;
    let tail = 0;
    for (const g of goals) {
      if (grid.isOpenIndex(g) && dist[g] === UNREACHABLE) {
        dist[g] = 0;
        queue[tail++] = g;
      }
    }
    while (head < tail) {
      const i = queue[head++]!;
      const d = dist[i]! + 1;
      const x = i % w;
      const y = (i - x) / w;
      if (x > 0 && dist[i - 1] === UNREACHABLE && grid.isOpenIndex(i - 1)) {
        dist[i - 1] = d;
        queue[tail++] = i - 1;
      }
      if (x < w - 1 && dist[i + 1] === UNREACHABLE && grid.isOpenIndex(i + 1)) {
        dist[i + 1] = d;
        queue[tail++] = i + 1;
      }
      if (y > 0 && dist[i - w] === UNREACHABLE && grid.isOpenIndex(i - w)) {
        dist[i - w] = d;
        queue[tail++] = i - w;
      }
      if (y < h - 1 && dist[i + w] === UNREACHABLE && grid.isOpenIndex(i + w)) {
        dist[i + w] = d;
        queue[tail++] = i + w;
      }
    }
    this.dirty = false;
  }
}
