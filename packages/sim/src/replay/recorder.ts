import type { Command, SimConfig } from '@ant/shared';
import type { Sim } from '../sim';
import { hashState } from './checksum';
import {
  REPLAY_VERSION,
  SIM_VERSION,
  encodeReplay,
  type ReplayData,
  type ReplayMeta,
  type TimedCommand,
} from './format';

/** Ticks between state checksums: 10 s of game time. */
export const CHECKSUM_INTERVAL = 200;

/**
 * Records a running sim's inputs. Call `applied` with every batch of commands right before
 * `sim.applyCommands`, and `afterStep` after every `sim.step`.
 */
export class ReplayRecorder {
  private readonly commands: TimedCommand[] = [];
  private readonly checksums: [number, number][] = [];
  private readonly base: Uint8Array | undefined;
  private readonly startTick: number;
  /** The config as the game began: live-tuning commands mutate `sim.config` afterwards. */
  private readonly config: SimConfig;

  constructor(
    sim: Sim,
    private readonly meta: ReplayMeta,
    private readonly checksumInterval = CHECKSUM_INTERVAL,
  ) {
    this.startTick = sim.tick;
    this.config = structuredClone(sim.config);
    // A game that didn't start at tick 0 (a loaded save) can only be replayed from that state.
    if (sim.tick > 0) this.base = sim.serialize();
  }

  applied(tick: number, commands: readonly Command[]): void {
    for (const command of commands) this.commands.push({ tick, command: { ...command } });
  }

  afterStep(sim: Sim): void {
    if (sim.tick % this.checksumInterval === 0) {
      this.checksums.push([sim.tick, hashState(sim.getState())]);
    }
  }

  get commandCount(): number {
    return this.commands.length;
  }

  build(sim: Sim): ReplayData {
    return {
      version: REPLAY_VERSION,
      simVersion: SIM_VERSION,
      config: structuredClone(this.config),
      meta: this.meta,
      startTick: this.startTick,
      endTick: sim.tick,
      winner: sim.winner,
      commands: this.commands.map((c) => ({ ...c })),
      checksumInterval: this.checksumInterval,
      checksums: this.checksums.map((c) => [...c] as [number, number]),
      populations: sim.colonies.map((c) => c.population),
      ...(this.base ? { base: this.base } : {}),
    };
  }

  /** The replay file for the game so far. */
  encode(sim: Sim): Uint8Array {
    return encodeReplay(this.build(sim));
  }
}
