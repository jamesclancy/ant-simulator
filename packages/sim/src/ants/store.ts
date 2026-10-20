import { MAX_ANTS } from '@ant/shared';

/** Struct-of-arrays ant storage. Add new per-ant fields as parallel typed arrays. */
export interface AntStore {
  count: number;
  capacity: number;
  x: Float32Array;
  y: Float32Array;
  heading: Float32Array;
  /** Food amount being carried (0 = nothing). */
  carrying: Float32Array;
  /** `AntState` value. */
  state: Uint8Array;
  /**
   * Trail strength in 0..1: reset to 1 on touching the nest (outbound) or food (carrying),
   * then multiplied by `depositDecay` every tick. Scales pheromone deposits.
   */
  strength: Float32Array;
  /** 0 = surface, 1 = underground (nest grid space). */
  layer: Uint8Array;
  /** `AntRole` value: the job the colony wants this ant doing. */
  role: Uint8Array;
}

export function createAntStore(capacity: number): AntStore {
  return {
    count: 0,
    capacity,
    x: new Float32Array(capacity),
    y: new Float32Array(capacity),
    heading: new Float32Array(capacity),
    carrying: new Float32Array(capacity),
    state: new Uint8Array(capacity),
    strength: new Float32Array(capacity),
    layer: new Uint8Array(capacity),
    role: new Uint8Array(capacity),
  };
}

/** Remove ant `i` by moving the last ant into its slot (so indices of other ants may change). */
export function removeAnt(ants: AntStore, i: number): void {
  const last = --ants.count;
  if (i === last) return;
  ants.x[i] = ants.x[last]!;
  ants.y[i] = ants.y[last]!;
  ants.heading[i] = ants.heading[last]!;
  ants.carrying[i] = ants.carrying[last]!;
  ants.state[i] = ants.state[last]!;
  ants.strength[i] = ants.strength[last]!;
  ants.layer[i] = ants.layer[last]!;
  ants.role[i] = ants.role[last]!;
}

export { MAX_ANTS };
