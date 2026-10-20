import type { WorkerInMessage, WorkerOutMessage } from '@ant/shared';
import type { Command } from '@ant/shared';
import { createSim } from './sim';
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
 */
export function runSimWorker(scope: WorkerScope): void {
  let sim: Sim | null = null;
  let paused = false;
  let speed = 1;
  let pending: Command[] = [];
  let last = now();
  let acc = 0;

  const post = (): void => {
    if (!sim) return;
    const snapshot = sim.snapshot();
    scope.postMessage({ type: 'snapshot', snapshot, speed: paused ? 0 : speed }, [
      snapshot.ants.buffer,
    ]);
  };

  const loop = (): void => {
    const t = now();
    const dt = Math.min(t - last, 250); // avoid spiral of death after tab stalls
    last = t;
    if (sim && !paused) {
      acc += dt * speed;
      const tickMs = 1000 / sim.config.tickRate;
      let stepped = 0;
      while (acc >= tickMs && stepped < 8) {
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
    }
    setTimeout(loop, 5);
  };

  scope.onmessage = ({ data }) => {
    switch (data.type) {
      case 'init':
        sim = createSim(data.config);
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
    }
  };

  loop();
}
