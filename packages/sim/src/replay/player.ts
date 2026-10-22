import { createSim, restoreSim, type Sim } from '../sim';
import { hashState } from './checksum';
import type { ReplayData } from './format';

/** The re-run reached a checksum that differs from the recording's. */
export class ReplayDesyncError extends Error {
  constructor(
    readonly tick: number,
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`replay desynchronised at tick ${tick}`);
    this.name = 'ReplayDesyncError';
  }
}

/** Ticks between playback checkpoints (the nearest earlier one is restored on a seek). */
export const CHECKPOINT_INTERVAL = 600;

/**
 * Re-runs a recorded game: steps a sim, applying each command right before the step of the
 * tick it was recorded at, and verifies the recorded checksums. Checkpoints (compressed sim
 * saves) are taken as playback passes them, so seeking backwards or forwards restores the
 * nearest one and fast-forwards from there. Headless: the worker and the tests share it.
 */
export class ReplayPlayer {
  sim: Sim;
  private cursor = 0;
  private readonly checkpoints = new Map<number, Uint8Array>();
  private readonly checksums = new Map<number, number>();

  constructor(
    readonly data: ReplayData,
    private readonly checkpointInterval = CHECKPOINT_INTERVAL,
  ) {
    this.sim = data.base ? restoreSim(data.base) : createSim(data.config);
    for (const [tick, hash] of data.checksums) this.checksums.set(tick, hash);
    this.checkpoints.set(this.sim.tick, this.sim.serialize());
    this.cursor = this.firstCommandAtOrAfter(this.sim.tick);
  }

  get tick(): number {
    return this.sim.tick;
  }

  get endTick(): number {
    return this.data.endTick;
  }

  get done(): boolean {
    return this.sim.tick >= this.data.endTick;
  }

  private firstCommandAtOrAfter(tick: number): number {
    const cmds = this.data.commands;
    let lo = 0;
    let hi = cmds.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cmds[mid]!.tick < tick) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private applyDue(): void {
    const cmds = this.data.commands;
    const due: (typeof cmds)[number]['command'][] = [];
    while (this.cursor < cmds.length && cmds[this.cursor]!.tick <= this.sim.tick) {
      due.push(cmds[this.cursor++]!.command);
    }
    if (due.length) this.sim.applyCommands(due);
  }

  /**
   * Advance one tick. Returns false (doing nothing) once the recording's end is reached.
   * Throws `ReplayDesyncError` when a recorded checksum doesn't match.
   */
  step(): boolean {
    if (this.done) return false;
    this.applyDue();
    this.sim.step();
    const tick = this.sim.tick;
    const expected = this.checksums.get(tick);
    // The checkpoint's own serialize/getState runs once per pass; the hash only when needed.
    const needCheckpoint = tick % this.checkpointInterval === 0 && !this.checkpoints.has(tick);
    if (expected !== undefined || needCheckpoint) {
      const state = this.sim.getState();
      if (expected !== undefined) {
        const actual = hashState(state);
        if (actual !== expected) throw new ReplayDesyncError(tick, expected, actual);
      }
      if (needCheckpoint) this.checkpoints.set(tick, this.sim.serialize());
    }
    if (this.done) this.applyDue();
    return true;
  }

  /**
   * Move towards `target` (clamped to the recording), stepping until it is reached or
   * `deadline` (a `performance.now()` value) passes. Returns true once there. A target
   * behind the current tick first restores the nearest checkpoint at or before it.
   */
  advanceTo(target: number, deadline = Infinity): boolean {
    const goal = Math.max(this.data.startTick, Math.min(target, this.data.endTick));
    if (goal < this.sim.tick) this.restoreBefore(goal);
    while (this.sim.tick < goal) {
      if (!this.step()) break;
      if ((this.sim.tick & 15) === 0 && performance.now() > deadline) break;
    }
    return this.sim.tick >= goal;
  }

  private restoreBefore(goal: number): void {
    let best = -1;
    for (const tick of this.checkpoints.keys()) if (tick <= goal && tick > best) best = tick;
    this.sim = restoreSim(this.checkpoints.get(best)!);
    this.cursor = this.firstCommandAtOrAfter(this.sim.tick);
  }
}
