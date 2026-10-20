import { AntState, Caste, NEST_TILE } from '@ant/shared';
import type { AntBehaviorConfig, CombatConfig } from '@ant/shared';
import type { AntStore } from '../ants/store';
import { wrapAngle } from '../ants/steering';
import type { Colony } from '../colony/colony';
import type { PheromoneField } from '../pheromones';
import { HASH_CELL, SpatialHash } from './hash';

/**
 * Proximity combat, run at the start of every tick on the positions the previous tick left:
 *
 * 1. Rebuild the spatial hash.
 * 2. For each ant with an enemy ant in the 3x3 cells around it (cheap bucket check; most
 *    ants stop here), find the first enemy within its engage range (scan order is index
 *    order, so this is deterministic):
 *    - within `contactRange`: deal its caste's damage (accumulated, applied after the pass
 *      so the result does not depend on who acts first), stand still (`AntState.Fight`)
 *      and, on the surface, lay `alarm` in its own colony's field;
 *    - else walk towards it (`Fight`; underground only onto open tiles).
 *    Engage range: soldiers `soldierEngageRange`, idle workers `workerEngageRange`; ants
 *    carrying something, breeders, the player and its recruits only fight on contact.
 *    The player and recruits keep their state (the player controller still moves them).
 * 3. Apply damage. Ants at <= 0 HP are removed by the sim at the end of the tick.
 *
 * Ants that were fighting and have no enemy left in range drop back to `Wander`.
 */
export class Combat {
  readonly hash: SpatialHash;
  private readonly pending: Float32Array;
  private alarms: Float32Array[] | null = null;

  constructor(worldSize: number, colonies: number, capacity: number) {
    this.hash = new SpatialHash(worldSize, colonies, capacity);
    this.pending = new Float32Array(capacity);
  }

  resolve(
    ants: AntStore,
    colonies: readonly Colony[],
    fields: readonly PheromoneField[],
    cfg: CombatConfig,
    behavior: AntBehaviorConfig,
    tickRate: number,
    playerIndex: number,
  ): void {
    const nc = colonies.length;
    if (nc < 2) return;
    const hash = this.hash;
    hash.build(ants);
    const { start, items, mask } = hash;
    const { x, y, heading, carrying, state, layer, colony, caste, hp } = ants;
    const pending = this.pending;
    const contact2 = cfg.contactRange * cfg.contactRange;
    const step = behavior.speed / tickRate;
    const field0 = fields[0]!;
    const invCell = 1 / field0.cellSize;
    const res = field0.resolution;
    const alarmMax = field0.config.alarm.max;
    const alarms = (this.alarms ??= fields.map((f) => f.layer('alarm')));

    for (let i = 0; i < ants.count; i++) {
      const l = layer[i]!;
      const c = colony[i]!;
      const cols = hash.cols(l);
      const rows = hash.rows(l);
      const base = hash.base(l);
      const px = x[i]!;
      const py = y[i]!;
      const cx = SpatialHash.coord(px, cols);
      const cy = SpatialHash.coord(py, rows);
      const x0 = cx > 0 ? cx - 1 : 0;
      const x1 = cx < cols - 1 ? cx + 1 : cx;
      const y0 = cy > 0 ? cy - 1 : 0;
      const y1 = cy < rows - 1 ? cy + 1 : cy;

      // Cheap reject: no enemy ant in the neighbourhood at all.
      const others = ~(1 << c);
      let any = false;
      for (let gy = y0; gy <= y1 && !any; gy++) {
        const row = base + gy * cols;
        for (let gx = x0; gx <= x1; gx++) {
          if ((mask[row + gx]! & others) !== 0) {
            any = true;
            break;
          }
        }
      }
      const st = state[i]!;
      if (!any) {
        if (st === AntState.Fight) state[i] = AntState.Wander;
        continue;
      }

      const controlled = i === playerIndex || st === AntState.Recruited;
      const k = caste[i]!;
      let range = cfg.contactRange;
      if (!controlled && carrying[i] === 0) {
        if (k === Caste.Soldier) range = cfg.soldierEngageRange;
        else if (k === Caste.Worker) range = cfg.workerEngageRange;
      }
      if (range > HASH_CELL) range = HASH_CELL;
      let best = -1;
      let bestD2 = range * range;
      for (let gy = y0; gy <= y1 && bestD2 > contact2; gy++) {
        for (let gx = x0; gx <= x1 && bestD2 > contact2; gx++) {
          const b0 = (base + gy * cols + gx) * nc;
          for (let e = 0; e < nc; e++) {
            if (e === c) continue;
            for (let p = start[b0 + e]!, end = start[b0 + e + 1]!; p < end; p++) {
              const j = items[p]!;
              const dx = x[j]! - px;
              const dy = y[j]! - py;
              const d2 = dx * dx + dy * dy;
              if (d2 < bestD2 || (best < 0 && d2 <= bestD2)) {
                best = j;
                bestD2 = d2;
                if (d2 <= contact2) break;
              }
            }
          }
        }
      }
      if (best < 0) {
        if (st === AntState.Fight) state[i] = AntState.Wander;
        continue;
      }

      const dx = x[best]! - px;
      const dy = y[best]! - py;
      if (bestD2 <= contact2) {
        pending[best]! += i === playerIndex ? cfg.playerDamage : cfg.damage[k]!;
        if (controlled) continue;
        state[i] = AntState.Fight;
        heading[i] = Math.atan2(dy, dx);
        if (l === 0) {
          // A 5x5-cell splash, so the call carries beyond the fighters' own cell at once.
          const alarm = alarms[c]!;
          const gx = Math.floor(px * invCell);
          const gy = Math.floor(py * invCell);
          for (let ay = gy - 2; ay <= gy + 2; ay++) {
            if (ay < 0 || ay >= res) continue;
            for (let ax = gx - 2; ax <= gx + 2; ax++) {
              if (ax < 0 || ax >= res) continue;
              const ci = ay * res + ax;
              const v = alarm[ci]! + cfg.alarmDeposit;
              alarm[ci] = v > alarmMax ? alarmMax : v;
            }
          }
        }
        continue;
      }
      if (controlled) continue;
      // Close in, stopping just inside contact range.
      const d = Math.sqrt(bestD2);
      const v = Math.min(step, d - cfg.contactRange * 0.8);
      const h = Math.atan2(dy, dx);
      const nx = px + Math.cos(h) * v;
      const ny = py + Math.sin(h) * v;
      state[i] = AntState.Fight;
      heading[i] = wrapAngle(h);
      if (l !== 0) {
        const tiles = colonies[l - 1]!.grid;
        if (!tiles.isOpen(Math.floor(nx / NEST_TILE), Math.floor(ny / NEST_TILE))) continue;
      }
      x[i] = nx;
      y[i] = ny;
    }

    for (let i = 0; i < ants.count; i++) {
      const p = pending[i]!;
      if (p > 0) {
        hp[i] = hp[i]! - p;
        pending[i] = 0;
      }
    }
  }
}
