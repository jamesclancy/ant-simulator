import type { SfxId } from './types';

/**
 * jsfxr-style procedural sound effects: a handful of numbers per sound, rendered to PCM once at
 * startup. No audio files ship with the game, so there is nothing to license.
 */
export interface SfxParams {
  wave: 'square' | 'saw' | 'sine' | 'tri' | 'noise';
  /** Start frequency in Hz (for noise: the sample-and-hold rate). */
  freq: number;
  /** Pitch slide in octaves per second (negative falls). */
  slide?: number;
  /** Square duty cycle 0..1 (default 0.5). */
  duty?: number;
  attack?: number;
  sustain: number;
  decay: number;
  /** [rate Hz, depth in semitones]. */
  vibrato?: [number, number];
  /** Jump by `semitones` after `time` seconds (chiptune arpeggio / coin sound). */
  jump?: [semitones: number, time: number];
  /** One-pole low-pass cutoff in Hz. */
  lowpass?: number;
  /** Final level 0..1 (default 0.6). */
  volume?: number;
  seed?: number;
}

export const SFX_PARAMS: Record<SfxId, SfxParams> = {
  click: {
    wave: 'square',
    freq: 1200,
    slide: -2,
    duty: 0.3,
    sustain: 0.01,
    decay: 0.04,
    volume: 0.35,
  },
  pickup: { wave: 'square', freq: 520, jump: [7, 0.05], duty: 0.4, sustain: 0.05, decay: 0.09 },
  drop: { wave: 'tri', freq: 330, slide: -1.5, sustain: 0.03, decay: 0.12 },
  deposit: { wave: 'square', freq: 440, jump: [12, 0.07], duty: 0.25, sustain: 0.1, decay: 0.16 },
  recruit: {
    wave: 'square',
    freq: 700,
    slide: 1.2,
    vibrato: [30, 0.6],
    duty: 0.5,
    sustain: 0.06,
    decay: 0.12,
    volume: 0.45,
  },
  trailOn: { wave: 'sine', freq: 400, slide: 1.4, sustain: 0.04, decay: 0.08 },
  trailOff: { wave: 'sine', freq: 600, slide: -1.4, sustain: 0.04, decay: 0.08 },
  dig: { wave: 'noise', freq: 2400, lowpass: 1800, sustain: 0.02, decay: 0.07, volume: 0.4 },
  fight: {
    wave: 'noise',
    freq: 9000,
    lowpass: 5000,
    attack: 0.001,
    sustain: 0.004,
    decay: 0.03,
    volume: 0.45,
  },
  death: {
    wave: 'saw',
    freq: 300,
    slide: -2.5,
    lowpass: 2500,
    sustain: 0.03,
    decay: 0.16,
    volume: 0.4,
  },
  hurt: {
    wave: 'square',
    freq: 260,
    slide: -1.2,
    vibrato: [40, 1],
    duty: 0.5,
    sustain: 0.1,
    decay: 0.2,
  },
  swap: {
    wave: 'square',
    freq: 330,
    jump: [5, 0.08],
    duty: 0.5,
    sustain: 0.12,
    decay: 0.14,
    volume: 0.5,
  },
  spiderHiss: {
    wave: 'noise',
    freq: 14000,
    lowpass: 7000,
    attack: 0.08,
    sustain: 0.3,
    decay: 0.35,
    volume: 0.5,
  },
  spiderDeath: {
    wave: 'saw',
    freq: 520,
    slide: -1.8,
    vibrato: [18, 1.5],
    lowpass: 3000,
    sustain: 0.12,
    decay: 0.4,
  },
  antlion: {
    wave: 'noise',
    freq: 3000,
    slide: -1,
    lowpass: 1400,
    attack: 0.05,
    sustain: 0.35,
    decay: 0.45,
    volume: 0.55,
  },
  rumble: {
    wave: 'noise',
    freq: 500,
    lowpass: 220,
    attack: 0.5,
    sustain: 0.6,
    decay: 1.2,
    volume: 0.7,
  },
  thunder: {
    wave: 'noise',
    freq: 700,
    slide: -0.3,
    lowpass: 320,
    attack: 0.03,
    sustain: 0.5,
    decay: 1.6,
    volume: 0.9,
  },
  // The mower's engine catching and revving up, played in the last seconds of its warning.
  engineRise: {
    wave: 'saw',
    freq: 55,
    slide: 0.8,
    vibrato: [22, 0.7],
    lowpass: 1500,
    attack: 2,
    sustain: 0.7,
    decay: 0.2,
    volume: 0.45,
  },
  queenLost: {
    wave: 'saw',
    freq: 392,
    slide: -0.6,
    vibrato: [6, 0.5],
    lowpass: 2200,
    attack: 0.02,
    sustain: 0.4,
    decay: 0.9,
    volume: 0.5,
  },
  queenKilled: {
    wave: 'square',
    freq: 392,
    jump: [12, 0.14],
    duty: 0.25,
    attack: 0.01,
    sustain: 0.28,
    decay: 0.45,
    volume: 0.5,
  },
  // Jingles are sequenced notes (see JINGLES); these are one-note placeholders never played directly.
  victory: { wave: 'square', freq: 523, sustain: 0.1, decay: 0.1 },
  defeat: { wave: 'saw', freq: 220, sustain: 0.1, decay: 0.1 },
};

/** Short note sequences rendered into one buffer: [midi, seconds]. */
export const JINGLES: Partial<
  Record<SfxId, { wave: SfxParams['wave']; duty?: number; notes: [number, number][] }>
> = {
  victory: {
    wave: 'square',
    duty: 0.25,
    notes: [
      [67, 0.12],
      [72, 0.12],
      [76, 0.12],
      [79, 0.2],
      [76, 0.1],
      [79, 0.5],
    ],
  },
  defeat: {
    wave: 'tri',
    notes: [
      [69, 0.2],
      [66, 0.2],
      [62, 0.2],
      [57, 0.6],
    ],
  },
};

export const SAMPLE_RATE = 22050;

const midiHz = (m: number): number => 440 * 2 ** ((m - 69) / 12);

/** Tiny deterministic PRNG so renders are identical on every device (and in tests). */
function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Render one effect to mono PCM in [-1, 1]. */
export function renderSfx(p: SfxParams, sampleRate = SAMPLE_RATE): Float32Array {
  const attack = p.attack ?? 0.002;
  const total = attack + p.sustain + p.decay;
  const n = Math.max(1, Math.ceil(total * sampleRate));
  const out = new Float32Array(n);
  const rand = lcg(p.seed ?? 12345);
  const duty = p.duty ?? 0.5;
  const volume = p.volume ?? 0.6;
  const lp = p.lowpass ? 1 - Math.exp((-2 * Math.PI * p.lowpass) / sampleRate) : 1;
  let phase = 0;
  let held = rand() * 2 - 1;
  let filtered = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    let env: number;
    if (t < attack) env = t / attack;
    else if (t < attack + p.sustain) env = 1;
    else env = Math.max(0, 1 - (t - attack - p.sustain) / p.decay);
    let f = p.freq * 2 ** ((p.slide ?? 0) * t);
    if (p.jump && t >= p.jump[1]) f *= 2 ** (p.jump[0] / 12);
    if (p.vibrato) f *= 2 ** ((Math.sin(2 * Math.PI * p.vibrato[0] * t) * p.vibrato[1]) / 12);
    phase += f / sampleRate;
    let wrapped = false;
    if (phase >= 1) {
      phase -= Math.floor(phase);
      wrapped = true;
    }
    let s: number;
    switch (p.wave) {
      case 'square':
        s = phase < duty ? 1 : -1;
        break;
      case 'saw':
        s = 1 - 2 * phase;
        break;
      case 'sine':
        s = Math.sin(2 * Math.PI * phase);
        break;
      case 'tri':
        s = 1 - 4 * Math.abs(phase - 0.5);
        break;
      default:
        if (wrapped) held = rand() * 2 - 1;
        s = held;
    }
    filtered += (s - filtered) * lp;
    out[i] = Math.max(-1, Math.min(1, filtered * env * volume));
  }
  return out;
}

/** Render a note sequence (monophonic, short release between notes). */
export function renderJingle(
  jingle: NonNullable<(typeof JINGLES)[SfxId]>,
  sampleRate = SAMPLE_RATE,
): Float32Array {
  const parts = jingle.notes.map(([midi, secs]) =>
    renderSfx(
      {
        wave: jingle.wave,
        ...(jingle.duty !== undefined ? { duty: jingle.duty } : {}),
        freq: midiHz(midi),
        attack: 0.004,
        sustain: secs * 0.7,
        decay: secs * 0.3,
        volume: 0.5,
      },
      sampleRate,
    ),
  );
  const out = new Float32Array(parts.reduce((a, b) => a + b.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Render the whole bank. */
export function renderAll(sampleRate = SAMPLE_RATE): Record<SfxId, Float32Array> {
  const out = {} as Record<SfxId, Float32Array>;
  for (const id of Object.keys(SFX_PARAMS) as SfxId[]) {
    const jingle = JINGLES[id];
    out[id] = jingle ? renderJingle(jingle, sampleRate) : renderSfx(SFX_PARAMS[id], sampleRate);
  }
  return out;
}

export { midiHz };
