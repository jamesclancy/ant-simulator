import { PROFILES, TIER_ORDER, classifyDevice, readDeviceInfo } from './deviceTier';
import type { DeviceTier, PerfProfile } from './deviceTier';

/** Frame-time budget the governor defends: below this fps for a whole window it steps down a tier. */
const TARGET_FPS = 30;
const WINDOW_MS = 3000;
const MIN_SAMPLES = 30;
/** Battery saver caps rendering here regardless of tier. */
export const BATTERY_SAVER_FPS = 30;

/**
 * Picks a perf profile from hardware hints, then watches measured frame times and steps down a
 * tier (never back up, to avoid flapping) when the device can't hold `TARGET_FPS`.
 * Also tracks the sim's per-tick cost reported by the worker, for the FPS readout.
 */
export class PerfGovernor {
  profile: PerfProfile;
  /** Smoothed sim milliseconds per tick (0 until the worker reports). */
  simMs = 0;
  /** Smoothed fps over the last window, for the readout. */
  fps = 0;
  batterySaver = false;
  /** Pin the tier (used by `?tier=` for testing): never adapt. */
  locked = false;
  private frames = 0;
  private windowStart = 0;
  private settleUntil = 0;

  constructor(
    private onChange: (profile: PerfProfile) => void,
    tier: DeviceTier = classifyDevice(readDeviceInfo()),
  ) {
    this.profile = PROFILES[tier];
  }

  /** `SimConfig.maxAnts` to use for the next new game. */
  get maxAnts(): number {
    return this.profile.maxAnts;
  }

  /** Render fps cap from the tier and battery saver, whichever is lower (0 = uncapped). */
  get fpsCap(): number {
    const caps = [this.profile.maxFps, this.batterySaver ? BATTERY_SAVER_FPS : 0].filter(
      (c) => c > 0,
    );
    return caps.length ? Math.min(...caps) : 0;
  }

  reportSim(msPerTick: number): void {
    this.simMs = this.simMs === 0 ? msPerTick : this.simMs * 0.8 + msPerTick * 0.2;
  }

  /** Call once per rendered frame with the wall-clock time. Returns true if the profile changed. */
  frame(now: number, paused = false): boolean {
    if (this.locked || this.windowStart === 0 || paused) {
      this.windowStart = now;
      this.frames = 0;
      return false;
    }
    this.frames++;
    const elapsed = now - this.windowStart;
    if (elapsed < WINDOW_MS) return false;
    this.fps = (this.frames * 1000) / elapsed;
    const enough = this.frames >= MIN_SAMPLES;
    this.windowStart = now;
    this.frames = 0;
    // A saver-capped renderer legitimately runs at the cap; don't mistake that for struggling.
    const floor = this.batterySaver ? BATTERY_SAVER_FPS * 0.85 : TARGET_FPS * 0.9;
    if (!enough || now < this.settleUntil || this.fps >= floor) return false;
    return this.stepDown(now);
  }

  stepDown(now = performance.now()): boolean {
    const i = TIER_ORDER.indexOf(this.profile.tier);
    const next = TIER_ORDER[i + 1];
    if (!next) return false;
    this.profile = PROFILES[next];
    // Let resolution/LOD changes take effect before judging again.
    this.settleUntil = now + WINDOW_MS * 2;
    this.onChange(this.profile);
    return true;
  }
}
