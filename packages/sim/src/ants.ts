import { MAX_ANTS } from '@ant/shared';

/** Struct-of-arrays ant storage. Add new per-ant fields as parallel typed arrays. */
export interface AntStore {
  count: number;
  capacity: number;
  x: Float32Array;
  y: Float32Array;
  heading: Float32Array;
}

export function createAntStore(capacity: number): AntStore {
  return {
    count: 0,
    capacity,
    x: new Float32Array(capacity),
    y: new Float32Array(capacity),
    heading: new Float32Array(capacity),
  };
}

export { MAX_ANTS };
