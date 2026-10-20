import { runSimWorker } from './worker';
import type { WorkerScope } from './worker';

declare const self: WorkerScope;

runSimWorker(self);
