import { describe, expect, it } from 'vitest';
import { createSim } from '@ant/sim';
import { DEFAULT_SANDBOX, sandboxConfig } from '../src/sandbox/config';

describe('sandboxConfig', () => {
  it('turns off hazards and win/lose by default', () => {
    const c = sandboxConfig(DEFAULT_SANDBOX);
    expect(c).toMatchObject({
      sandbox: true,
      colonies: 2,
      initialAnts: 300,
      winLose: false,
      ai: true,
      spiders: 0,
      antlions: 0,
      rain: { enabled: false },
    });
    const sim = createSim({ ...c, worldSize: 1024 });
    expect(sim.spiders.count).toBe(0);
    expect(sim.antlions.count).toBe(0);
    expect(sim.config.rain.enabled).toBe(false);
    expect(sim.config.sandbox).toBe(true);
  });

  it('leaves hazard defaults alone when hazards are on', () => {
    const c = sandboxConfig({ ...DEFAULT_SANDBOX, hazards: true, colonies: 1, winLose: true });
    expect(c.spiders).toBeUndefined();
    expect(c.rain).toBeUndefined();
    expect(c).toMatchObject({ colonies: 1, winLose: true });
  });
});
