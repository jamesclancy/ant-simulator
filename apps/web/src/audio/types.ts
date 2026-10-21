/** One-shot sound effects. Each is synthesized at startup from `SFX_PARAMS` (see synth.ts). */
export const SFX_IDS = [
  'click',
  'pickup',
  'drop',
  'deposit',
  'recruit',
  'trailOn',
  'trailOff',
  'dig',
  'fight',
  'death',
  'hurt',
  'swap',
  'spiderHiss',
  'spiderDeath',
  'antlion',
  'rumble',
  'thunder',
  'queenLost',
  'queenKilled',
  'victory',
  'defeat',
] as const;
export type SfxId = (typeof SFX_IDS)[number];

/** Continuous beds whose level the director sets every snapshot. */
export type LoopId = 'rain' | 'skitter';
export type TrackId = 'menu' | 'game';

export interface PlayOptions {
  /** 0..1 linear, default 1. */
  gain?: number;
  /** -1 (left) .. 1 (right), default 0. */
  pan?: number;
  /** Playback-rate multiplier (pitch), default 1. */
  rate?: number;
}

export interface AudioVolumes {
  sfx: number;
  music: number;
  muted: boolean;
}

/**
 * What the director drives. The real implementation is Web Audio (webAudio.ts); tests use a
 * recording fake. All calls are safe before the first user gesture (they are dropped or remembered).
 */
export interface AudioBackend {
  play(id: SfxId, options?: PlayOptions): void;
  /** `level` 0..1; 0 stops the bed. */
  setLoop(id: LoopId, level: number): void;
  /** `track` null fades the music out. `intensity` 0..1 mixes in the fight layer. */
  setMusic(track: TrackId | null, intensity: number): void;
  setVolumes(volumes: AudioVolumes): void;
  /** True while the tab/app is in the background: all output stops. */
  setSuspended(suspended: boolean): void;
}
