import type { TrackId } from './types';

/** A note on the step grid: MIDI number, start step, length in steps. */
export interface NoteEvent {
  step: number;
  midi: number;
  len: number;
}

const NAMES: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** "a4" -> 69, "f#3" -> 54. */
export function noteMidi(name: string): number {
  const m = /^([a-g])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  const accidental = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + NAMES[m[1]!]! + accidental;
}

/**
 * Parse a pattern: space-separated tokens, one per step. `.` rest, `-` holds the previous note,
 * anything else is a note name.
 */
export function parsePattern(pattern: string): NoteEvent[] {
  const events: NoteEvent[] = [];
  pattern
    .trim()
    .split(/\s+/)
    .forEach((tok, step) => {
      if (tok === '.') return;
      if (tok === '-') {
        const last = events[events.length - 1];
        if (last) last.len++;
        return;
      }
      events.push({ step, midi: noteMidi(tok), len: 1 });
    });
  return events;
}

export interface TrackScore {
  /** Seconds per 16th-note step. */
  stepSeconds: number;
  /** Total steps in the loop. */
  steps: number;
  /** Always-on melody (pulse). */
  lead: NoteEvent[];
  bass: NoteEvent[];
  /** Fight layer: fast arpeggio. */
  arp: NoteEvent[];
  /** Drum hits by step: k kick, s snare, h hat. Base layer plays `calm`, fight layer `drive`. */
  calm: Record<number, string>;
  drive: Record<number, string>;
  leadWave: 'pulse25' | 'pulse50' | 'triangle';
  bassWave: 'triangle' | 'square';
}

const bars = (patterns: string[]): NoteEvent[] =>
  patterns.flatMap((p, bar) => parsePattern(p).map((e) => ({ ...e, step: e.step + bar * 16 })));

/** 16-step drum bar from strings of k/s/h/. repeated for `count` bars. */
function drums(pattern: string, count: number): Record<number, string> {
  const hits: Record<number, string> = {};
  const toks = pattern.trim().split(/\s+/);
  for (let bar = 0; bar < count; bar++) {
    toks.forEach((t, i) => {
      if (t !== '.') hits[bar * 16 + i] = t;
    });
  }
  return hits;
}

// A minor, 8 bars: Am F C G | Am F C G, with a busier second half.
const GAME_CHORDS = [
  ['a3', 'c4', 'e4'],
  ['f3', 'a3', 'c4'],
  ['c4', 'e4', 'g4'],
  ['g3', 'b3', 'd4'],
];
const arpBar = (chord: string[]): string => {
  const [r, t, f] = chord as [string, string, string];
  const hi = r.replace(/\d/, (d) => String(Number(d) + 1));
  return [r, t, f, hi, f, t, f, hi, r, t, f, hi, f, t, f, t].join(' ');
};

const game: TrackScore = {
  stepSeconds: 60 / 116 / 4,
  steps: 128,
  leadWave: 'pulse25',
  bassWave: 'triangle',
  lead: bars([
    'a4 . c5 . e5 . c5 . a4 . c5 . e5 - - .',
    'f4 . a4 . c5 . a4 . f4 . a4 . c5 - - .',
    'g4 . c5 . e5 . c5 . g4 . c5 . e5 - g5 .',
    'g4 . b4 . d5 . b4 . g4 . b4 . d5 - - .',
    'e5 . e5 d5 c5 . a4 . e5 . . . c5 - - .',
    'c5 . c5 b4 a4 . f4 . c5 . . . a4 - - .',
    'g4 . c5 . e5 . g5 . e5 . c5 . g4 - - .',
    'd5 . d5 c5 b4 . g4 . b4 . d5 . g5 - - .',
  ]),
  bass: bars([
    'a2 . a2 . a3 . a2 . a2 . a2 . a3 . a2 .',
    'f2 . f2 . f3 . f2 . f2 . f2 . f3 . f2 .',
    'c3 . c3 . c4 . c3 . c3 . c3 . c4 . c3 .',
    'g2 . g2 . g3 . g2 . g2 . g2 . g3 . g2 .',
    'a2 . a2 . a3 . a2 . a2 . a2 . a3 . a2 .',
    'f2 . f2 . f3 . f2 . f2 . f2 . f3 . f2 .',
    'c3 . c3 . c4 . c3 . c3 . c3 . c4 . c3 .',
    'g2 . g2 . g3 . g2 . g2 . g2 . g3 . g2 .',
  ]),
  arp: bars([...GAME_CHORDS, ...GAME_CHORDS].map(arpBar)),
  calm: drums('k . . . . . h . k . . . . . h .', 8),
  drive: drums('k . h . s . h k . . h . s . h h', 8),
};

// C major pentatonic, 8 bars: C Am F G x2, slow and sparse.
const menu: TrackScore = {
  stepSeconds: 60 / 84 / 4,
  steps: 128,
  leadWave: 'triangle',
  bassWave: 'triangle',
  lead: bars([
    'e5 . . . g5 . . . e5 . d5 . c5 . . .',
    'c5 . . . e5 . . . a4 . c5 . e5 - - .',
    'a4 . . . c5 . . . f4 . a4 . c5 - - .',
    'd5 . . . b4 . . . g4 . b4 . d5 - - .',
    'e5 . g5 . a5 . g5 . e5 . d5 . c5 . . .',
    'c5 . e5 . g5 . e5 . a4 . c5 . e5 - - .',
    'a4 . c5 . f5 . e5 . c5 . a4 . f4 - - .',
    'g4 . b4 . d5 . b4 . g4 - - - - - - .',
  ]),
  bass: bars([
    'c3 - - - - - - - g2 - - - - - - -',
    'a2 - - - - - - - e3 - - - - - - -',
    'f2 - - - - - - - c3 - - - - - - -',
    'g2 - - - - - - - d3 - - - - - - -',
    'c3 - - - - - - - g2 - - - - - - -',
    'a2 - - - - - - - e3 - - - - - - -',
    'f2 - - - - - - - c3 - - - - - - -',
    'g2 - - - - - - - d3 - - - - - - -',
  ]),
  arp: [],
  calm: drums('. . . . . . . . . . . . . . h .', 8),
  drive: {},
};

export const SCORES: Record<TrackId, TrackScore> = { game, menu };
