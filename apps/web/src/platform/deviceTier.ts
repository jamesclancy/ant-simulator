/** Coarse device class; the perf governor picks a render/sim profile from it. */
export type DeviceTier = 'low' | 'mid' | 'high';

export interface DeviceInfo {
  cores: number;
  /** `navigator.deviceMemory` in GB (Chromium only; undefined on Safari/Firefox). */
  memoryGb?: number;
  /** Coarse pointer (phone/tablet). */
  touch: boolean;
}

/** Render and sim knobs for a tier. */
export interface PerfProfile {
  tier: DeviceTier;
  /** Max renderer resolution (device pixel ratio cap). */
  maxResolution: number;
  antialias: boolean;
  /** `SimConfig.maxAnts` for new games. */
  maxAnts: number;
  /** Minimum ms between scent-overlay repaints. */
  scentIntervalMs: number;
  /** Below this camera zoom, thin out ant sprites by `lodStride`. */
  lodZoom: number;
  lodStride: number;
}

export const PROFILES: Record<DeviceTier, PerfProfile> = {
  high: {
    tier: 'high',
    maxResolution: 2,
    antialias: true,
    maxAnts: 20000,
    scentIntervalMs: 0,
    lodZoom: 0,
    lodStride: 1,
  },
  mid: {
    tier: 'mid',
    maxResolution: 2,
    antialias: false,
    maxAnts: 8000,
    scentIntervalMs: 400,
    lodZoom: 0.5,
    lodStride: 2,
  },
  low: {
    tier: 'low',
    maxResolution: 1.25,
    antialias: false,
    maxAnts: 3000,
    scentIntervalMs: 800,
    lodZoom: 0.8,
    lodStride: 3,
  },
};

export const TIER_ORDER: readonly DeviceTier[] = ['high', 'mid', 'low'];

/** Static guess from hardware hints, before any frame has been measured. */
export function classifyDevice(info: DeviceInfo): DeviceTier {
  if (info.cores <= 4 || (info.memoryGb !== undefined && info.memoryGb <= 3)) return 'low';
  if (!info.touch) return 'high';
  // Core counts barely separate phones (mid-range Androids have 8 too), so prefer memory. Android
  // Chromium reports it; iOS WebKit doesn't, and iPhones with 6+ cores are all fast.
  const fast =
    info.memoryGb === undefined ? info.cores >= 6 : info.memoryGb >= 6 && info.cores >= 8;
  return fast ? 'high' : 'mid';
}

export function readDeviceInfo(): DeviceInfo {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    cores: nav.hardwareConcurrency || 4,
    touch: matchMedia('(pointer: coarse)').matches,
    ...(nav.deviceMemory === undefined ? {} : { memoryGb: nav.deviceMemory }),
  };
}
