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
  };
}

export { MAX_ANTS };
