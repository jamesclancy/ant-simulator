import type { Command, SimConfig, Snapshot, WorkerInMessage, WorkerOutMessage } from '@ant/shared';

export interface SimClientEvents {
  onReady(config: SimConfig): void;
  onSnapshot(snapshot: Snapshot, speed: number): void;
}

/** Thin main-thread wrapper over the sim worker: commands in, snapshots out. */
export class SimClient {
  private worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });

  constructor(events: SimClientEvents) {
    this.worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
      const msg = e.data;
      if (msg.type === 'ready') events.onReady(msg.config);
      else events.onSnapshot(msg.snapshot, msg.speed);
    };
  }

  private send(msg: WorkerInMessage): void {
    this.worker.postMessage(msg);
  }

  init(config: Partial<SimConfig> = {}): void {
    this.send({ type: 'init', config });
  }
  sendCommands(commands: Command[]): void {
    this.send({ type: 'commands', commands });
  }
  setPaused(paused: boolean): void {
    this.send({ type: 'setPaused', paused });
  }
  setSpeed(speed: number): void {
    this.send({ type: 'setSpeed', speed });
  }
}
