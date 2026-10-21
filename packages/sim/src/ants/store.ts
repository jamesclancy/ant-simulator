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
  /** 0 = surface, `1 + c` = underground in colony c's nest (nest grid space). */
  layer: Uint8Array;
  /** `AntRole` value: the job the colony wants this (worker) ant doing. */
  role: Uint8Array;
  /** Owning colony id. */
  colony: Uint8Array;
  /** `Caste` value. */
  caste: Uint8Array;
  /** Hit points; the ant is removed at the end of the tick once this is <= 0. */
  hp: Float32Array;
}

/** `hp` marker for ants that starved: removed without leaving a corpse. */
export const STARVED_HP = -1e9;

const FIELDS = [
  'x',
  'y',
  'heading',
  'carrying',
  'state',
  'strength',
  'layer',
  'role',
  'colony',
  'caste',
  'hp',
] as const;

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
    colony: new Uint8Array(capacity),
    caste: new Uint8Array(capacity),
    hp: new Float32Array(capacity),
  };
}

/** Remove ant `i` by moving the last ant into its slot (so indices of other ants may change). */
export function removeAnt(ants: AntStore, i: number): void {
  const last = --ants.count;
  if (i === last) return;
  for (const f of FIELDS) ants[f][i] = ants[f][last]!;
}

/**
 * Remove every ant with `hp <= 0`, keeping the survivors in their original order (so the
 * renderer's per-index interpolation and any held index stays meaningful once remapped).
 * Fills `remap[old] = new index` (or -1 for removed ants) for `old < previous count` and
 * returns the number removed. Allocation-free; `remap` must hold `ants.count` entries.
 */
export function compactAnts(ants: AntStore, remap: Int32Array): number {
  const n = ants.count;
  const { x, y, heading, carrying, state, strength, layer, role, colony, caste, hp } = ants;
  let w = 0;
  for (let r = 0; r < n; r++) {
    if (hp[r]! <= 0) {
      remap[r] = -1;
      continue;
    }
    if (w !== r) {
      // Explicit copies: this runs every tick during battles, keep it monomorphic.
      x[w] = x[r]!;
      y[w] = y[r]!;
      heading[w] = heading[r]!;
      carrying[w] = carrying[r]!;
      state[w] = state[r]!;
      strength[w] = strength[r]!;
      layer[w] = layer[r]!;
      role[w] = role[r]!;
      colony[w] = colony[r]!;
      caste[w] = caste[r]!;
      hp[w] = hp[r]!;
    }
    remap[r] = w++;
  }
  ants.count = w;
  return n - w;
}

/** Plain-data copy of the live ants (`count` entries per array). */
export interface AntsState {
  count: number;
  arrays: Record<(typeof FIELDS)[number], ArrayBufferView>;
}

export function getAntsState(ants: AntStore): AntsState {
  const arrays = {} as AntsState['arrays'];
  for (const f of FIELDS) arrays[f] = ants[f].slice(0, ants.count);
  return { count: ants.count, arrays };
}

export function setAntsState(ants: AntStore, s: AntsState): void {
  if (s.count > ants.capacity) throw new Error('save holds more ants than the store can');
  for (const f of FIELDS) (ants[f] as Float32Array).set(s.arrays[f] as Float32Array);
  ants.count = s.count;
}

export { MAX_ANTS };
