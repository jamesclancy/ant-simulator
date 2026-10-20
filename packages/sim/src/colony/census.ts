import { AntState } from '@ant/shared';
import type { CombatConfig } from '@ant/shared';
import type { AntStore } from '../ants/store';
import type { Colony } from './colony';

/**
 * One pass over the ant store refreshing every colony's head counts: population, castes,
 * underground, fighting, intruders (enemy ants inside its nest), threat (enemy surface
 * ants near its entrance) and the sticky `scouted` flag. Run once per tick before the
 * colonies step; the economy, AI director and snapshots read these instead of rescanning.
 */
export function takeCensus(ants: AntStore, colonies: readonly Colony[], cfg: CombatConfig): void {
  const n = colonies.length;
  for (const c of colonies) {
    c.population = c.underground = c.fighting = c.intruders = c.threat = 0;
    c.castes[0] = c.castes[1] = c.castes[2] = 0;
  }
  const { x, y, layer, colony, caste, state } = ants;
  const threat2 = cfg.threatRadius * cfg.threatRadius;
  const scout2 = cfg.scoutRadius * cfg.scoutRadius;
  for (let i = 0; i < ants.count; i++) {
    const own = colonies[colony[i]!];
    if (!own) continue;
    own.population++;
    own.castes[caste[i]!]!++;
    if (state[i] === AntState.Fight) own.fighting++;
    const l = layer[i]!;
    if (l !== 0) {
      own.underground++;
      const host = colonies[l - 1];
      if (host && host !== own) host.intruders++;
      continue;
    }
    if (n < 2) continue;
    const px = x[i]!;
    const py = y[i]!;
    for (let e = 0; e < n; e++) {
      const other = colonies[e]!;
      if (other === own) continue;
      const dx = px - other.nest.x;
      const dy = py - other.nest.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < threat2) other.threat++;
      if (d2 < scout2) other.scouted = true;
    }
  }
}
