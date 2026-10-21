import { describe, expect, it } from 'vitest';
import { Caste } from '@ant/shared';
import type { Command } from '@ant/shared';
import { SAVE_VERSION, SaveError, createSim, readSaveInfo, restoreSim } from '../src';
import type { Sim } from '../src';

/** Fights, a raid, recruits, digging and brood all in play by the time we save. */
function scenario(): { sim: Sim; commands: Record<number, Command[]> } {
  const sim = createSim({ seed: 21, worldSize: 1024, initialAnts: 150 });
  const mid = 512;
  const commands: Record<number, Command[]> = {
    10: [
      { type: 'playerRecruit', count: 10 },
      { type: 'playerToggleTrail', on: true },
    ],
    20: [{ type: 'playerMoveTo', x: 700, y: 640 }],
    50: [
      { type: 'spawnAnts', count: 30, x: mid, y: mid, colony: 0, caste: Caste.Soldier },
      { type: 'spawnAnts', count: 30, x: mid, y: mid + 10, colony: 1, caste: Caste.Soldier },
    ],
    100: [{ type: 'setBehaviorRatio', colony: 0, forage: 0.4, dig: 0.4, nurse: 0.2 }],
    200: [{ type: 'setRaid', colony: 0, on: true }],
    590: [{ type: 'playerRecruit', count: 10 }],
    650: [
      { type: 'playerRecruit', count: 5 },
      { type: 'playerMoveDir', dx: 1, dy: -0.5 },
    ],
    800: [{ type: 'playerRelease' }, { type: 'setBehavior', params: { speed: 30 } }],
  };
  return { sim, commands };
}

function run(sim: Sim, commands: Record<number, Command[]>, from: number, to: number): void {
  for (let t = from; t < to; t++) {
    const c = commands[t];
    if (c) sim.applyCommands(c);
    sim.step();
  }
}

describe('save / restore', () => {
  it('continues exactly after a round trip (fights, underground, brood, recruits)', () => {
    const { sim, commands } = scenario();
    run(sim, commands, 0, 600);
    const snap = sim.snapshot({ pheromones: true, nestGrid: true });
    expect(snap.colonies[0]!.losses + snap.colonies[1]!.losses).toBeGreaterThan(5);
    expect(snap.colonies[0]!.openTiles).toBeGreaterThan(60);
    expect(
      snap.colonies[0]!.eggs + snap.colonies[0]!.larvae + snap.colonies[0]!.pupae,
    ).toBeGreaterThan(0);
    expect(snap.player?.recruitedIndices.length).toBeGreaterThan(0);

    const bytes = sim.serialize();
    const copy = restoreSim(bytes);
    // Restored state is identical right away...
    expect(copy.getState()).toEqual(sim.getState());
    expect(copy.serialize()).toEqual(bytes);

    // ...and stays identical while both run on (with further commands).
    run(sim, commands, 600, 1100);
    run(copy, commands, 600, 1100);
    expect(copy.serialize()).toEqual(sim.serialize());
    expect(copy.snapshot({ pheromones: true, nestGrid: true })).toEqual(
      sim.snapshot({ pheromones: true, nestGrid: true }),
    );
  });

  it('round-trips a single-colony game and a finished game', () => {
    const one = createSim({ seed: 3, colonies: 1, initialAnts: 60, worldSize: 800 });
    run(one, {}, 0, 300);
    const copy = restoreSim(one.serialize());
    run(one, {}, 300, 500);
    run(copy, {}, 300, 500);
    expect(copy.serialize()).toEqual(one.serialize());

    const over = createSim({ seed: 4, initialAnts: 20, worldSize: 600 });
    over.colonies[1]!.killQueen();
    over.step();
    expect(over.winner).toBe(0);
    expect(restoreSim(over.serialize()).winner).toBe(0);
  });

  it('exposes header info without inflating', () => {
    const { sim, commands } = scenario();
    run(sim, commands, 0, 120);
    const info = readSaveInfo(sim.serialize());
    expect(info).toMatchObject({ version: SAVE_VERSION, tick: 120, seed: 21, winner: -1 });
    expect(info.populations).toEqual(sim.colonies.map((c) => c.population));
  });

  it('keeps saves small', () => {
    const { sim, commands } = scenario();
    run(sim, commands, 0, 600);
    expect(sim.serialize().length).toBeLessThan(2_000_000);
  });

  it('rejects foreign, truncated, damaged and newer saves', () => {
    const bytes = createSim({ seed: 1, initialAnts: 10, worldSize: 500 }).serialize();
    const code = (b: Uint8Array): string | undefined => {
      try {
        restoreSim(b);
      } catch (e) {
        return e instanceof SaveError ? e.code : `other:${String(e)}`;
      }
    };
    expect(code(new Uint8Array([1, 2, 3]))).toBe('truncated');
    expect(code(new Uint8Array(40))).toBe('badMagic');
    expect(code(bytes.subarray(0, 100))).toBe('truncated');
    expect(code(bytes.subarray(0, bytes.length - 500))).toBe('corrupt');
    const damaged = bytes.slice();
    for (let i = damaged.length - 200; i < damaged.length; i++) damaged[i] = 0xff;
    expect(code(damaged)).toBe('corrupt');
    const newer = bytes.slice();
    new DataView(newer.buffer).setUint16(4, SAVE_VERSION + 1, true);
    expect(code(newer)).toBe('newerVersion');
    expect(() => readSaveInfo(newer)).toThrow(SaveError);
    const older = bytes.slice();
    new DataView(older.buffer).setUint16(4, 0, true);
    expect(code(older)).toBe('unsupportedVersion');
  });
});
