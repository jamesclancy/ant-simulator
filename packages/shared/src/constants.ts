/** Fixed simulation rate. The renderer interpolates between ticks. */
export const TICK_RATE_HZ = 20;
export const TICK_MS = 1000 / TICK_RATE_HZ;

/** Floats per ant in a snapshot's `ants` buffer: x, y, heading (radians). */
export const ANT_STRIDE = 3;

export const DEFAULT_SEED = 1337;
export const DEFAULT_WORLD_SIZE = 2048;
export const DEFAULT_ANT_COUNT = 2000;
export const MAX_ANTS = 20000;

export const SPEED_STEPS = [0.5, 1, 2, 4] as const;
