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
  sandbox: boolean;
  /** A sandbox paint tool is armed (taps and drags paint). */
  tool: boolean;
  /** Sandbox rocks on the map. */
  rocks: number;
  /** Selected game speed step. */
  speed: number;
  /** Campaign games: the detailed patch, patches owned, breeders ready, map open. */
  campaign: {
    active: number;
    owned: number;
    breeders: number;
    mapOpen: boolean;
    kind: 'yard' | 'room';
  } | null;
  /** Audio engine probe: context state ('none' until the first gesture), active voices, music. */
  audio: {
    context: string;
    voices: number;
    track: 'menu' | 'game' | null;
    sfxGain: number;
    musicGain: number;
    masterGain: number;
  };
}

declare global {
  interface Window {
    __antDebug?: { state(): AntDebugState; send(commands: Command[]): void };
  }
}
