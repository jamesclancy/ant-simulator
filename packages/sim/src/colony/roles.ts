import { AntRole } from '@ant/shared';
import type { BehaviorRatio } from '@ant/shared';
import type { AntStore } from '../ants/store';

const ROLES = [AntRole.Forage, AntRole.Dig, AntRole.Nurse] as const;

/** Normalise a ratio so its parts are >= 0 and sum to 1 (all-zero falls back to all-forage). */
export function normaliseRatio(r: BehaviorRatio): BehaviorRatio {
  const f = Math.max(0, r.forage) || 0;
  const d = Math.max(0, r.dig) || 0;
  const n = Math.max(0, r.nurse) || 0;
  const sum = f + d + n;
  return sum > 0
    ? { forage: f / sum, dig: d / sum, nurse: n / sum }
    : { forage: 1, dig: 0, nurse: 0 };
}

/** Role with the largest shortfall against `target`, or -1 if none is short. */
export function mostNeededRole(have: ArrayLike<number>, target: ArrayLike<number>): number {
  let best = -1;
  let bestGap = 0;
  for (const r of ROLES) {
    const gap = target[r]! - have[r]!;
    if (gap > bestGap) {
      bestGap = gap;
      best = r;
    }
  }
  return best;
}

/** Ideal head-count per role for `total` ants (largest-remainder rounding, sums to total). */
export function roleTargets(total: number, ratio: BehaviorRatio, out: number[]): number[] {
  const raw = [ratio.forage * total, ratio.dig * total, ratio.nurse * total];
  let used = 0;
  for (let r = 0; r < 3; r++) {
    out[r] = Math.floor(raw[r]!);
    used += out[r]!;
  }
  for (let left = total - used; left > 0; left--) {
    let best = 0;
    let bestFrac = -1;
    for (let r = 0; r < 3; r++) {
      const frac = raw[r]! - out[r]!;
      if (frac > bestFrac) {
        bestFrac = frac;
        best = r;
      }
    }
    out[best]!++;
  }
  return out;
}

/**
 * Move idle ants (not carrying anything) from over-quota roles to under-quota ones, in
 * index order so the result is deterministic. Ants mid-task keep their role. Fills `have`
 * with the resulting per-role counts.
 */
export function rebalanceRoles(
  ants: AntStore,
  ratio: BehaviorRatio,
  have: number[],
  target: number[],
): void {
  have[0] = have[1] = have[2] = 0;
  for (let i = 0; i < ants.count; i++) have[ants.role[i]!]!++;
  roleTargets(ants.count, ratio, target);
  for (let i = 0; i < ants.count; i++) {
    const r = ants.role[i]!;
    if (have[r]! <= target[r]! || ants.carrying[i] !== 0) continue;
    const to = mostNeededRole(have, target);
    if (to < 0) break;
    ants.role[i] = to;
    have[r]!--;
    have[to]!++;
  }
}
