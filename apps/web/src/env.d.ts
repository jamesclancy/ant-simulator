import type { Command } from '@ant/shared';

/** Snapshot of game state exposed to the e2e suite via `window.__antDebug` (dev/e2e builds). */
export interface AntDebugState {
  mode: 'menu' | 'playing';
  paused: boolean;
  layer: 0 | 1;
  tick: number;
  winner: number;
  population: number[];
  player: { x: number; y: number } | null;
  seed: number;
  tutorialActive: boolean;
}

declare global {
  interface Window {
    __antDebug?: { state(): AntDebugState; send(commands: Command[]): void };
  }
}
