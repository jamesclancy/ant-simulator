import { AntRole, AntState, NEST_TILE } from '@ant/shared';
import type { AntBehaviorConfig } from '@ant/shared';
import type { AntStore } from '../ants/store';
import { turnTowards, wrapAngle } from '../ants/steering';
import type { Colony } from '../colony/colony';
import type { Rng } from '../rng';
import { UNREACHABLE } from './flow';

/**
 * One tick for every underground ant (`layer === 1`). Positions are continuous, in nest-grid
 * world units (`NEST_TILE` per tile, y down). Navigation is a BFS flow field per goal
 * (entrance / food chamber / nursery / dig face, see `FlowField`): each tick an ant reads
 * the distance of its own tile and its four neighbours, heads for the centre of the lowest
 * one, and so follows shortest walkable paths with four array reads. Ants already inside a
 * goal region (distance 0) mill about within it. One rng draw per ant per tick.
 *
 * Jobs (`ants.role`), with whatever is being carried taking priority:
 * - carrying food (> 0): walk to a food chamber, add it to the colony store, then carry on.
 * - carrying dirt (< 0): walk to the entrance and exit; the colony counts the dirt.
 * - Forage: walk to the entrance and exit to the surface.
 * - Dig: walk to the dig face; up to `digMaxWorkers` ants there add one unit of work per
 *   tick, and the one that completes a tile picks up its dirt.
 * - Nurse: walk to a nursery/queen chamber and tend brood (counted in `colony.nursesTending`).
 */
export function updateUndergroundAnts(
  colony: Colony,
  ants: AntStore,
  rng: Rng,
  cfg: AntBehaviorConfig,
  tickRate: number,
): void {
  const { x, y, heading, carrying, state, role, layer } = ants;
  const grid = colony.grid;
  const w = grid.width;
  const tiles = grid.tiles;
  const step = (cfg.speed / tickRate) * colony.config.undergroundSpeedFactor;
  const turn = cfg.turnRate;
  const entranceIdx = grid.entranceIndex;
  const maxWorkers = colony.config.digMaxWorkers;
  const digging = colony.digTarget >= 0;
  const eDist = colony.toEntrance.dist;
  const fDist = colony.toFood.dist;
  const nDist = colony.toNursery.dist;
  const dDist = colony.toDig.dist;

  for (let i = 0; i < ants.count; i++) {
    if (layer[i] !== 1) continue;
    const px = x[i]!;
    const py = y[i]!;
    const tx = Math.floor(px / NEST_TILE);
    const ty = Math.floor(py / NEST_TILE);
    const ti = ty * w + tx;
    const carried = carrying[i]!;
    const r = role[i]!;

    // Pick the field for the current job.
    let dist: Uint16Array;
    let job = 0; // 0 = to entrance, 1 = food, 2 = dig, 3 = nurse
    if (carried > 0) {
      dist = fDist;
      job = 1;
      state[i] = AntState.CarryFood;
    } else if (carried < 0) {
      dist = eDist;
    } else if (r === AntRole.Dig && digging) {
      dist = dDist;
      job = 2;
      state[i] = AntState.Dig;
    } else if (r === AntRole.Forage) {
      dist = eDist;
      state[i] = AntState.Wander;
    } else {
      dist = nDist;
      job = 3;
      state[i] = r === AntRole.Nurse ? AntState.Nurse : AntState.Dig;
    }

    const d = dist[ti]!;
    if (d === 0) {
      // Arrived: act, then (unless gone) mill about inside the goal region.
      if (job === 0) {
        if (ti === entranceIdx) {
          colony.exit(ants, i, rng);
          continue;
        }
      } else if (job === 1) {
        colony.nest.depositFood(carried);
        carrying[i] = 0;
      } else if (job === 2) {
        if (colony.digWorkers < maxWorkers) {
          colony.digWorkers++;
          colony.digProgress++;
          colony.lastDigger = i;
        }
      } else {
        colony.nursesTending++;
      }
      mill(ants, i, dist, tiles, w, step * 0.4, rng);
      continue;
    }
    if (d === UNREACHABLE) {
      mill(ants, i, null, tiles, w, step * 0.4, rng);
      continue;
    }

    // Step towards the lowest-distance 4-neighbour (x-neighbours first, then y).
    let best = ti;
    let bestD = d;
    if (tx > 0 && dist[ti - 1]! < bestD) {
      best = ti - 1;
      bestD = dist[best]!;
    }
    if (tx < w - 1 && dist[ti + 1]! < bestD) {
      best = ti + 1;
      bestD = dist[best]!;
    }
    if (ty > 0 && dist[ti - w]! < bestD) {
      best = ti - w;
      bestD = dist[best]!;
    }
    if (ty < grid.height - 1 && dist[ti + w]! < bestD) best = ti + w;
    const bx = best % w;
    const by = (best - bx) / w;
    const gx = (bx + 0.5) * NEST_TILE - px;
    const gy = (by + 0.5) * NEST_TILE - py;
    const len = Math.hypot(gx, gy) || 1;
    // A little sideways wobble keeps the stream of ants from marching in a perfect line.
    const wob = (rng.next() - 0.5) * 0.5;
    let nx = px + (gx / len) * step - (gy / len) * step * wob;
    let ny = py + (gy / len) * step + (gx / len) * step * wob;
    if (!openAt(tiles, w, nx, ny)) {
      nx = px + (gx / len) * step;
      ny = py + (gy / len) * step;
    }
    x[i] = nx;
    y[i] = ny;
    heading[i] = turnTowards(heading[i]!, Math.atan2(gy, gx), turn * 2);
  }
}

function openAt(tiles: Uint8Array, w: number, px: number, py: number): boolean {
  if (px < 0 || py < 0) return false;
  const t = tiles[Math.floor(py / NEST_TILE) * w + Math.floor(px / NEST_TILE)];
  return t === 1 /* Tunnel */ || t === 2; /* Chamber */
}

/**
 * Random walk that stays on open tiles (and, when `zone` is given, on distance-0 tiles of
 * that field, i.e. inside the goal region).
 */
function mill(
  ants: AntStore,
  i: number,
  zone: Uint16Array | null,
  tiles: Uint8Array,
  w: number,
  speed: number,
  rng: Rng,
): void {
  const h = wrapAngle(ants.heading[i]! + (rng.next() - 0.5) * 1.2);
  const nx = ants.x[i]! + Math.cos(h) * speed;
  const ny = ants.y[i]! + Math.sin(h) * speed;
  if (openAt(tiles, w, nx, ny) && (!zone || zone[tileOf(nx, ny, w)] === 0)) {
    ants.x[i] = nx;
    ants.y[i] = ny;
    ants.heading[i] = h;
  } else {
    ants.heading[i] = wrapAngle(h + Math.PI);
  }
}

function tileOf(px: number, py: number, w: number): number {
  return Math.floor(py / NEST_TILE) * w + Math.floor(px / NEST_TILE);
}
