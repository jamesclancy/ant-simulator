import { PHEROMONE_SNAPSHOT_INTERVAL } from '@ant/shared';
import type { WorkerInMessage, WorkerOutMessage } from '@ant/shared';
import type { Command } from '@ant/shared';
import { createSim, restoreSim } from './sim';
import { SaveError } from './save/format';
import type { Sim } from './sim';
import { Campaign, isCampaignSave, restoreCampaign } from './campaign';

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
  /** Set in campaign games: owns `sim` (the detailed patch) and replaces it on a patch switch. */
  let campaign: Campaign | null = null;
  /** Send the campaign overview with the next snapshot even if unchanged. */
  let sendCampaign = false;
  let paused = false;
  let speed = 1;
  let scentVision = false;
  let sendScentNow = false;
  let lastScentTick = -Infinity;
  let pending: Command[] = [];
  let last = now();
  let acc = 0;

  const post = (simMs?: number): void => {
    if (!sim) return;
    const wantScent =
      scentVision &&
      (sendScentNow || paused || sim.tick - lastScentTick >= PHEROMONE_SNAPSHOT_INTERVAL);
    sendScentNow = false;
    if (wantScent) lastScentTick = sim.tick;
    const snapshot = campaign
      ? campaign.snapshot({ pheromones: wantScent, nestGrid: sendCampaign, campaign: sendCampaign })
      : sim.snapshot({ pheromones: wantScent });
    sendCampaign = false;
    const transfer: Transferable[] = [snapshot.ants.buffer];
    if (snapshot.player) transfer.push(snapshot.player.recruitedIndices.buffer);
    if (snapshot.pheromones) transfer.push(snapshot.pheromones.data.buffer);
    for (const g of snapshot.nestGrids ?? []) transfer.push(g.cells.buffer);
    for (const g of snapshot.waterGrids ?? []) transfer.push(g.levels.buffer);
    scope.postMessage({ type: 'snapshot', snapshot, speed: paused ? 0 : speed, simMs }, transfer);
  };

  const over = (): boolean => (campaign ? campaign.over : (sim?.winner ?? -1) !== -1);

  /** A new game is running (new, loaded, or a campaign patch switch): reset the clock and tell the UI. */
  const started = (requestId?: number): void => {
    if (!sim) return;
    paused = false;
    acc = 0;
    last = now();
    pending = [];
    lastScentTick = -Infinity;
    sendCampaign = !!campaign;
    scope.postMessage({
      type: 'ready',
      config: sim.config,
      tuning: sim.tuning,
      ...(requestId !== undefined ? { requestId } : {}),
      ...(campaign ? { campaign: campaign.info() } : {}),
    });
    post();
  };

  const loop = (): void => {
    const t = now();
    const dt = Math.min(t - last, 250); // avoid spiral of death after tab stalls
    last = t;
    if (sim && !paused) {
      acc += dt * speed;
      const tickMs = 1000 / sim.config.tickRate;
      let stepped = 0;
      const stepStart = now();
      while (acc >= tickMs && stepped < 8 && !over()) {
        if (pending.length) {
          sim.applyCommands(pending);
          pending = [];
        }
        if (campaign) campaign.step();
        else sim.step();
        acc -= tickMs;
        stepped++;
      }
      if (stepped) post((now() - stepStart) / stepped);
      else if (acc > tickMs) acc = 0;
      if (over()) {
        paused = true;
        acc = 0;
      }
    }
    setTimeout(loop, 5);
  };

  scope.onmessage = ({ data }) => {
    switch (data.type) {
      case 'initCampaign':
        campaign = new Campaign(data.config);
        sim = campaign.sim;
        started();
        break;
      case 'campaign': {
        if (!campaign) break;
        const action = data.action;
        if (action.type === 'enterPatch') {
          if (pending.length && sim) sim.applyCommands(pending);
          const wasPaused = paused;
          if (campaign.enter(action.patch)) {
            sim = campaign.sim;
            started();
            // The map pauses the game; entering a patch keeps it as it was.
            paused = wasPaused;
          }
        } else if (action.type === 'matingFlight') {
          campaign.matingFlight();
          post();
        }
        break;
      }
      case 'init':
        campaign = null;
        sim = createSim(data.config);
        started();
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
          const bytes = (campaign ?? sim).serialize();
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
          if (isCampaignSave(data.bytes)) {
            const restored = restoreCampaign(data.bytes);
            campaign = restored;
            sim = restored.sim;
          } else {
            sim = restoreSim(data.bytes);
            campaign = null;
          }
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
        started(data.requestId);
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
