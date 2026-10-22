import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Command, SimConfigInput, WorkerInMessage, WorkerOutMessage } from '@ant/shared';
import { createSim } from '../src/sim';
import {
  ReplayDesyncError,
  ReplayError,
  ReplayPlayer,
  ReplayRecorder,
  SIM_VERSION,
  decodeReplay,
  encodeReplay,
  hashState,
  replayInfo,
} from '../src/replay';
import { runSimWorker } from '../src/worker';
import type { WorkerScope } from '../src/worker';

type Schedule = Record<number, Command[]>;

/** Run a sim like the worker does: commands applied right before the step of their tick. */
function record(config: SimConfigInput, schedule: Schedule, ticks: number, interval = 50) {
  const sim = createSim(config);
  const recorder = new ReplayRecorder(
    sim,
    { mode: config.sandbox ? 'sandbox' : 'quick' },
    interval,
  );
  for (let i = 0; i < ticks && sim.winner === -1; i++) {
    const cmds = schedule[sim.tick];
    if (cmds) {
      recorder.applied(sim.tick, cmds);
      sim.applyCommands(cmds);
    }
    sim.step();
    recorder.afterStep(sim);
  }
  // Edits made while paused at the end are applied at the final tick.
  const tail = schedule[sim.tick];
  if (tail) {
    recorder.applied(sim.tick, tail);
    sim.applyCommands(tail);
  }
  return { sim, bytes: recorder.encode(sim) };
}

function replayToEnd(bytes: Uint8Array) {
  const player = new ReplayPlayer(decodeReplay(bytes), 200);
  while (player.step());
  return player;
}

const small: SimConfigInput = { seed: 11, initialAnts: 40, maxAnts: 3000 };

const scenarios: { name: string; config: SimConfigInput; schedule: Schedule; ticks: number }[] = [
  {
    name: 'a quick game with player commands',
    config: small,
    ticks: 900,
    schedule: {
      5: [{ type: 'playerMoveTo', x: 900, y: 900 }],
      40: [{ type: 'playerToggleTrail', on: true }],
      120: [{ type: 'playerMoveDir', dx: 1, dy: 0.5 }],
      121: [{ type: 'playerRecruit', count: 10 }],
      300: [
        { type: 'playerPickupDrop' },
        { type: 'setBehaviorRatio', forage: 0.2, dig: 0.6, nurse: 0.2 },
        { type: 'setCasteRatio', worker: 0.5, soldier: 0.5, breeder: 0 },
      ],
      500: [{ type: 'playerRelease' }, { type: 'setRaid', colony: 0, on: true }],
    },
  },
  {
    name: 'sandbox tools',
    config: { ...small, sandbox: true, winLose: false },
    ticks: 700,
    schedule: {
      10: [
        { type: 'placeObstacle', x: 700, y: 700, radius: 40 },
        { type: 'placeFood', x: 800, y: 600, amount: 300 },
        { type: 'spawnAnts', count: 30, x: 500, y: 500, colony: 1 },
      ],
      200: [
        { type: 'setCombat', params: { playerDamage: 5 } },
        { type: 'setColonyParams', colony: 0, params: { eggCost: 1 } },
        { type: 'setPheromoneParams', pheromone: 'food', params: { evaporation: 0.01 } },
        { type: 'depositPheromone', pheromone: 'food', x: 600, y: 600, amount: 1 },
      ],
      400: [{ type: 'erase', x: 500, y: 500, radius: 120 }, { type: 'clearPheromones' }],
      600: [{ type: 'clearObstacles' }, { type: 'clearAnts' }],
    },
  },
  {
    name: 'hazards',
    config: { ...small, spiders: 2, antlions: 3 },
    ticks: 900,
    schedule: {
      30: [{ type: 'startRain', ticks: 400 }],
      100: [{ type: 'spawnSpider', x: 1000, y: 1000 }],
      150: [{ type: 'addAntlion', x: 900, y: 1100 }],
      200: [{ type: 'spawnAnts', count: 20, x: 940, y: 1100, colony: 0 }],
      600: [{ type: 'stopRain' }],
    },
  },
];

describe('replay', () => {
  for (const s of scenarios) {
    it(`replays ${s.name} to an identical final state`, () => {
      const { sim, bytes } = record(s.config, s.schedule, s.ticks);
      const player = replayToEnd(bytes);
      expect(player.tick).toBe(sim.tick);
      expect(hashState(player.sim.getState())).toBe(hashState(sim.getState()));
      expect(player.sim.snapshot({ pheromones: true }).ants).toEqual(
        sim.snapshot({ pheromones: true }).ants,
      );
    });
  }

  it('survives an encode/decode round trip and describes itself', () => {
    const { sim, bytes } = record(small, { 5: [{ type: 'playerMoveTo', x: 1, y: 2 }] }, 120);
    const data = decodeReplay(bytes);
    expect(data.simVersion).toBe(SIM_VERSION);
    expect(data.endTick).toBe(sim.tick);
    expect(data.commands).toEqual([{ tick: 5, command: { type: 'playerMoveTo', x: 1, y: 2 } }]);
    expect(data.checksums.map((c) => c[0])).toEqual([50, 100]);
    expect(decodeReplay(encodeReplay(data))).toEqual(data);
    expect(replayInfo(data)).toMatchObject({ seed: 11, sandbox: false, endTick: 120 });
  });

  it('replays a game that started from a loaded save', () => {
    const first = createSim(small);
    for (let i = 0; i < 150; i++) first.step();
    const sim = createSim(small);
    sim.setState(first.getState());
    const recorder = new ReplayRecorder(sim, { mode: 'quick' }, 50);
    recorder.applied(sim.tick, [{ type: 'playerMoveTo', x: 300, y: 300 }]);
    sim.applyCommands([{ type: 'playerMoveTo', x: 300, y: 300 }]);
    for (let i = 0; i < 250; i++) {
      sim.step();
      recorder.afterStep(sim);
    }
    const data = decodeReplay(recorder.encode(sim));
    expect(data.startTick).toBe(150);
    expect(data.base).toBeDefined();
    const player = replayToEnd(recorder.encode(sim));
    expect(hashState(player.sim.getState())).toBe(hashState(sim.getState()));
  });

  it('detects a tampered command as a desync', () => {
    const { bytes } = record(
      small,
      { 20: [{ type: 'spawnAnts', count: 10, x: 400, y: 400 }] },
      400,
    );
    const data = decodeReplay(bytes);
    const cmd = data.commands[0]!.command;
    if (cmd.type !== 'spawnAnts') throw new Error('unexpected command');
    cmd.count = 11;
    const player = new ReplayPlayer(data);
    let error: unknown;
    try {
      while (player.step());
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ReplayDesyncError);
    // The first checksum after the tampered command (tick 50) is where it shows.
    expect((error as ReplayDesyncError).tick).toBe(50);
  });

  it('detects a dropped command', () => {
    const { bytes } = record(
      small,
      { 20: [{ type: 'spawnAnts', count: 10, x: 400, y: 400 }] },
      200,
    );
    const data = decodeReplay(bytes);
    data.commands.length = 0;
    const player = new ReplayPlayer(data);
    expect(() => {
      while (player.step());
    }).toThrow(ReplayDesyncError);
  });

  it('seeks backwards and forwards through checkpoints without changing the outcome', () => {
    const s = scenarios[0]!;
    const { sim, bytes } = record(s.config, s.schedule, s.ticks);
    const expected = hashState(sim.getState());
    const player = new ReplayPlayer(decodeReplay(bytes), 200);
    expect(player.advanceTo(700)).toBe(true);
    expect(player.tick).toBe(700);
    expect(player.advanceTo(130)).toBe(true);
    expect(player.tick).toBe(130);
    expect(player.advanceTo(450)).toBe(true);
    // A tiny time budget makes progress in slices and still gets there.
    let slices = 0;
    while (!player.advanceTo(10_000, performance.now() - 1)) slices++;
    expect(slices).toBeGreaterThan(0);
    expect(player.done).toBe(true);
    expect(hashState(player.sim.getState())).toBe(expected);
  });

  it('rejects foreign and damaged files', () => {
    expect(() => decodeReplay(new Uint8Array(4))).toThrow(ReplayError);
    expect(() => decodeReplay(new TextEncoder().encode('ANTS000000000000'))).toThrow(/not an Ant/);
    const { bytes } = record(small, {}, 30);
    expect(() => decodeReplay(bytes.subarray(0, 20))).toThrow(ReplayError);
    const bad = bytes.slice();
    bad[bad.length - 5] = (bad[bad.length - 5] ?? 0) ^ 0xff;
    expect(() => decodeReplay(bad)).toThrow(ReplayError);
  });
});

describe('replay through the worker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    const posted: WorkerOutMessage[] = [];
    const scope: WorkerScope = {
      postMessage: (message: WorkerOutMessage) => {
        posted.push(message);
      },
      onmessage: null,
    };
    runSimWorker(scope);
    const send = (data: WorkerInMessage) => scope.onmessage?.({ data });
    const last = <T extends WorkerOutMessage['type']>(type: T) =>
      posted.filter((m): m is Extract<WorkerOutMessage, { type: T }> => m.type === type).at(-1);
    return { posted, send, last };
  }

  it('records a played game and plays it back, with seek and desync reporting', () => {
    const rec = setup();
    rec.send({ type: 'init', config: small, daily: '2026-10-22' });
    rec.send({ type: 'commands', commands: [{ type: 'playerMoveTo', x: 500, y: 500 }] });
    vi.advanceTimersByTime(30 * 50);
    rec.send({ type: 'setPaused', paused: true });
    rec.send({ type: 'commands', commands: [{ type: 'spawnAnts', count: 5, x: 300, y: 300 }] });
    const live = rec.last('snapshot')!.snapshot;
    rec.send({ type: 'getReplay', requestId: 1 });
    const file = rec.last('replay')!;
    expect(file.requestId).toBe(1);
    expect(decodeReplay(file.bytes).meta.daily).toBe('2026-10-22');

    const view = setup();
    view.send({ type: 'initReplay', requestId: 2, bytes: file.bytes });
    const ready = view.last('ready')!;
    expect(ready.requestId).toBe(2);
    expect(ready.replay).toMatchObject({
      startTick: 0,
      endTick: live.tick,
      versionMismatch: false,
    });
    view.send({ type: 'commands', commands: [{ type: 'clearAnts' }] }); // ignored
    view.send({ type: 'setSpeed', speed: 16 });
    vi.advanceTimersByTime(60 * 50);
    const done = view.last('snapshot')!.snapshot;
    expect(done.tick).toBe(live.tick);
    expect(done.antCount).toBe(live.antCount);
    view.send({ type: 'replaySeek', tick: 10 });
    vi.advanceTimersByTime(50);
    expect(view.last('replayStatus')).toMatchObject({ tick: 10, seeking: false });
    expect(view.last('snapshot')!.snapshot.tick).toBe(10);
    view.send({ type: 'save', requestId: 3 });
    expect(view.last('error')).toMatchObject({ requestId: 3, operation: 'save' });
  });

  it('reports a damaged replay and a desync', () => {
    const view = setup();
    view.send({ type: 'initReplay', requestId: 1, bytes: new Uint8Array(20) });
    expect(view.last('error')).toMatchObject({ requestId: 1, operation: 'replay' });

    const { bytes } = record(
      small,
      { 20: [{ type: 'spawnAnts', count: 10, x: 400, y: 400 }] },
      200,
    );
    const data = decodeReplay(bytes);
    data.commands.length = 0;
    view.send({ type: 'initReplay', requestId: 2, bytes: encodeReplay(data) });
    view.send({ type: 'setSpeed', speed: 16 });
    vi.advanceTimersByTime(200 * 50);
    expect(view.last('replayDesync')).toMatchObject({ tick: 50 });
  });
});
