import { describe, expect, it } from 'vitest';
import { classifyDevice, PROFILES } from '../src/platform/deviceTier';
import { BATTERY_SAVER_FPS, PerfGovernor } from '../src/platform/perfGovernor';
import { createSim } from '@ant/sim';
import { sanitizeSettings } from '../src/ui/settings';

describe('classifyDevice', () => {
  it('rates weak phones low, mid-range phones mid, desktops high', () => {
    expect(classifyDevice({ cores: 4, memoryGb: 2, touch: true })).toBe('low');
    expect(classifyDevice({ cores: 8, memoryGb: 3, touch: true })).toBe('low');
    expect(classifyDevice({ cores: 8, memoryGb: 4, touch: true })).toBe('mid');
    expect(classifyDevice({ cores: 8, memoryGb: 8, touch: true })).toBe('high');
    expect(classifyDevice({ cores: 6, touch: true })).toBe('high');
    expect(classifyDevice({ cores: 16, memoryGb: 8, touch: false })).toBe('high');
  });
});

describe('PerfGovernor', () => {
  /** Feed frames at a fixed rate for `seconds` of wall time. */
  const run = (g: PerfGovernor, fps: number, seconds: number, start = 1000): number => {
    let t = start;
    for (let i = 0; i < fps * seconds; i++) {
      g.frame(t);
      t += 1000 / fps;
    }
    return t;
  };

  it('holds its tier while the frame rate is healthy', () => {
    const g = new PerfGovernor(() => {}, 'high');
    run(g, 60, 10);
    expect(g.profile.tier).toBe('high');
  });

  it('steps down one tier at a time when it cannot hold 30 fps, then settles', () => {
    const seen: string[] = [];
    const g = new PerfGovernor((p) => seen.push(p.tier), 'high');
    const t = run(g, 15, 4);
    expect(seen).toEqual(['mid']);
    // Still slow, but inside the settle period: no second step yet.
    run(g, 15, 3, t);
    expect(seen).toEqual(['mid']);
    run(g, 15, 10, t + 3000);
    expect(seen).toEqual(['mid', 'low']);
    run(g, 5, 20, t + 20000);
    expect(g.profile.tier).toBe('low');
  });

  it('does not treat the battery-saver cap as struggling', () => {
    const g = new PerfGovernor(() => {}, 'high');
    g.batterySaver = true;
    run(g, BATTERY_SAVER_FPS, 10);
    expect(g.profile.tier).toBe('high');
    expect(g.fpsCap).toBe(BATTERY_SAVER_FPS);
  });

  it('smooths reported sim time', () => {
    const g = new PerfGovernor(() => {}, 'mid');
    g.reportSim(10);
    g.reportSim(0);
    expect(g.simMs).toBeCloseTo(8);
  });
});

describe('device caps', () => {
  it('lower tiers cap ants and update the scent overlay less often', () => {
    expect(PROFILES.low.maxAnts).toBeLessThan(PROFILES.mid.maxAnts);
    expect(PROFILES.mid.maxAnts).toBeLessThan(PROFILES.high.maxAnts);
    expect(PROFILES.low.scentIntervalMs).toBeGreaterThan(PROFILES.mid.scentIntervalMs);
  });

  it('SimConfig.maxAnts bounds the ant store', () => {
    const sim = createSim({ seed: 1, maxAnts: 300, initialAnts: 500 });
    expect(sim.ants.capacity).toBe(300);
    expect(sim.ants.count).toBeLessThanOrEqual(300);
    sim.step();
  });

  it('settings default haptics on and battery saver off, and reject junk', () => {
    const s = sanitizeSettings({ haptics: 'yes', batterySaver: true });
    expect(s.haptics).toBe(true);
    expect(s.batterySaver).toBe(true);
  });
});
