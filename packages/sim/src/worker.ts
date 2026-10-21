import { PHEROMONE_SNAPSHOT_INTERVAL } from '@ant/shared';
import type { WorkerInMessage, WorkerOutMessage } from '@ant/shared';
import type { Command } from '@ant/shared';
import { createSim, restoreSim } from './sim';
import { SaveError } from './save/format';
import type { Sim } from './sim';

/** Minimal slice of the worker global scope, so this package needs no DOM/WebWorker lib. */
export interface WorkerScope {
  postMessage(message: WorkerOutMessage, transfer: Transferable[]): void;
  postMessage(message: WorkerOutMessage): void;
  onmessage: ((event: { data: WorkerInMessage }) => void) | null;
}

const now = (): number => performance.now();

/**
 * Runs the fixed-tick loop and posts transferable snapshots after every tick.
 * Wall-clock time is accumulated and consumed in whole ticks; speed scales the clock.
 * Once the game is over (`sim.winner !== -1`) the sim stops stepping until the next `init`.
 */
export function runSimWorker(scope: WorkerScope): void {
  let sim: Sim | null = null;
  let paused = false;
  let speed = 1;
  let scentVision = false;
  let sendScentNow = false;
  let lastScentTick = -Infinity;
  let pending: Command[] = [];
  let last = now();
  let acc = 0;

  const post = (): void => {
    if (!sim) return;
    const wantScent =
      scentVision &&
      (sendScentNow || paused || sim.tick - lastScentTick >= PHEROMONE_SNAPSHOT_INTERVAL);
    sendScentNow = false;
    if (wantScent) lastScentTick = sim.tick;
    const snapshot = sim.snapshot({ pheromones: wantScent });
    const transfer: Transferable[] = [snapshot.ants.buffer];
    if (snapshot.player) transfer.push(snapshot.player.recruitedIndices.buffer);
    if (snapshot.pheromones) transfer.push(snapshot.pheromones.data.buffer);
    for (const g of snapshot.nestGrids ?? []) transfer.push(g.cells.buffer);
    for (const g of snapshot.waterGrids ?? []) transfer.push(g.levels.buffer);
    scope.postMessage({ type: 'snapshot', snapshot, speed: paused ? 0 : speed }, transfer);
  };

  const loop = (): void => {
    const t = now();
    const dt = Math.min(t - last, 250); // avoid spiral of death after tab stalls
    last = t;
    if (sim && !paused) {
      acc += dt * speed;
      const tickMs = 1000 / sim.config.tickRate;
      let stepped = 0;
      while (acc >= tickMs && stepped < 8 && sim.winner === -1) {
        if (pending.length) {
          sim.applyCommands(pending);
          pending = [];
        }
        sim.step();
        acc -= tickMs;
        stepped++;
      }
      if (stepped) post();
      else if (acc > tickMs) acc = 0;
      if (sim.winner !== -1) {
        paused = true;
        acc = 0;
      }
    }
    setTimeout(loop, 5);
  };

  scope.onmessage = ({ data }) => {
    switch (data.type) {
      case 'init':
        sim = createSim(data.config);
        paused = false;
        acc = 0;
        last = now();
        pending = [];
        lastScentTick = -Infinity;
        scope.postMessage({ type: 'ready', config: sim.config });
        post();
        break;
      case 'commands':
        pending.push(...data.commands);
        // Apply immediately while paused so edits are visible.
        if (sim && paused) {
          sim.applyCommands(pending);
          pending = [];
          post();
        }
        break;
      case 'setPaused':
        paused = data.paused;
        if (paused) post();
        last = now();
        break;
      case 'setSpeed':
        speed = data.speed;
        break;
      case 'save':
        if (!sim) {
          scope.postMessage({
            type: 'error',
            requestId: data.requestId,
            operation: 'save',
            code: 'failed',
            message: 'no game is running',
          });
          break;
        }
        try {
          const bytes = sim.serialize();
          scope.postMessage(
            { type: 'saved', requestId: data.requestId, bytes, info: sim.saveInfo() },
            [bytes.buffer],
          );
        } catch (e) {
          scope.postMessage({
            type: 'error',
            requestId: data.requestId,
            operation: 'save',
            code: 'failed',
            message: e instanceof Error ? e.message : String(e),
          });
        }
        break;
      case 'load':
        try {
          sim = restoreSim(data.bytes);
        } catch (e) {
          // The running game (if any) is untouched.
          scope.postMessage({
            type: 'error',
            requestId: data.requestId,
            operation: 'load',
            code: e instanceof SaveError ? e.code : 'failed',
            message: e instanceof Error ? e.message : String(e),
          });
          break;
        }
        paused = false;
        acc = 0;
        last = now();
        pending = [];
        lastScentTick = -Infinity;
        scope.postMessage({ type: 'ready', config: sim.config, requestId: data.requestId });
        post();
        break;
      case 'setScentVision':
        scentVision = data.enabled;
        sendScentNow = data.enabled;
        if (paused) post();
        break;
    }
  };

  loop();
}
