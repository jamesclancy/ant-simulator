import type {
  Command,
  SaveInfo,
  SimConfig,
  SimConfigInput,
  Snapshot,
  WorkerInMessage,
  WorkerOutMessage,
} from '@ant/shared';

export interface SimClientEvents {
  onReady(config: SimConfig): void;
  onSnapshot(snapshot: Snapshot, speed: number): void;
}

/** A `save` / `load` the worker rejected; `code` is `SaveError.code` or 'failed'. */
export class SimRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Thin main-thread wrapper over the sim worker: commands in, snapshots out. */
export class SimClient {
  private worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
  private nextRequest = 1;
  private requests = new Map<
    number,
    { resolve(value: never): void; reject(reason: SimRequestError): void }
  >();

  constructor(events: SimClientEvents) {
    this.worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
      const msg = e.data;
      switch (msg.type) {
        case 'ready':
          events.onReady(msg.config);
          if (msg.requestId !== undefined) this.settle(msg.requestId, msg.config);
          break;
        case 'snapshot':
          events.onSnapshot(msg.snapshot, msg.speed);
          break;
        case 'saved':
          this.settle(msg.requestId, { bytes: msg.bytes, info: msg.info });
          break;
        case 'error':
          this.requests.get(msg.requestId)?.reject(new SimRequestError(msg.code, msg.message));
          this.requests.delete(msg.requestId);
          break;
      }
    };
  }

  private settle(id: number, value: unknown): void {
    this.requests.get(id)?.resolve(value as never);
    this.requests.delete(id);
  }

  private request<T>(make: (requestId: number) => WorkerInMessage, transfer: Transferable[] = []) {
    const id = this.nextRequest++;
    return new Promise<T>((resolve, reject) => {
      this.requests.set(id, { resolve, reject });
      this.worker.postMessage(make(id), transfer);
    });
  }

  /** Serialize the running game. */
  save(): Promise<{ bytes: Uint8Array; info: SaveInfo }> {
    return this.request((requestId) => ({ type: 'save', requestId }));
  }

  /** Replace the running game with a saved one; resolves once it is running. */
  load(bytes: Uint8Array): Promise<SimConfig> {
    return this.request((requestId) => ({ type: 'load', requestId, bytes }), [bytes.buffer]);
  }

  private send(msg: WorkerInMessage): void {
    this.worker.postMessage(msg);
  }

  init(config: SimConfigInput = {}): void {
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
  setScentVision(enabled: boolean): void {
    this.send({ type: 'setScentVision', enabled });
  }
}
