import type { Difficulty, SimConfigInput } from '@ant/shared';
import { TICK_RATE_HZ } from '@ant/shared';

/** Ant cap for daily games: fixed (not the device's) so everyone plays the same game. */
export const DAILY_MAX_ANTS = 2500;

/** UTC calendar date `YYYY-MM-DD`. */
export function dateKey(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

export function isDateKey(text: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(`${text}T00:00:00Z`));
}

/** 32-bit FNV-1a, so a given date always maps to the same bits on every device. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  }
  return h >>> 0;
}

export interface DailySetup {
  date: string;
  seed: number;
  difficulty: Difficulty;
  spiders: number;
  antlions: number;
  rain: boolean;
}

/** Everything about a day's challenge, derived from its date alone. */
export function dailySetup(date: string): DailySetup {
  const h = hash(`ant-simulator-daily:${date}`);
  const difficulty = (['easy', 'normal', 'normal', 'hard'] as const)[h & 3]!;
  return {
    date,
    // Positive 31-bit, never 0 (the menu treats a blank seed as "random").
    seed: ((h >>> 1) % 0x7ffffffe) + 1,
    difficulty,
    spiders: 1 + ((h >>> 2) % 3),
    antlions: 2 + ((h >>> 4) % 3),
    rain: true,
  };
}

export function dailyConfig(setup: DailySetup): SimConfigInput {
  return {
    seed: setup.seed,
    difficulty: setup.difficulty,
    maxAnts: DAILY_MAX_ANTS,
    spiders: setup.spiders,
    antlions: setup.antlions,
    rain: { enabled: setup.rain },
  };
}

export type DailyOutcome = 'victory' | 'defeat' | 'quit';

/** One try at a day's challenge. The first try of a date is the one that counts. */
export interface DailyAttempt {
  /** 1 = the counting attempt; later ones are flagged retries. */
  n: number;
  startedAt: number;
  /** Absent while the game is still running (or the app was closed mid-game). */
  outcome?: DailyOutcome;
  /** Game length in ticks. */
  ticks?: number;
  /** Black colony size at the end. */
  population?: number;
  /** Id of the stored replay, if one was saved. */
  replayId?: string;
}

export function formatDuration(ticks: number): string {
  const total = Math.floor(ticks / TICK_RATE_HZ);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Orders attempts best-first: a victory beats everything, faster beats slower; otherwise
 * longer survival wins, then the bigger colony. Unfinished attempts rank last.
 */
export function compareAttempts(a: DailyAttempt, b: DailyAttempt): number {
  const tier = (x: DailyAttempt): number =>
    x.outcome === 'victory' ? 0 : x.outcome === undefined ? 3 : x.outcome === 'defeat' ? 1 : 2;
  const d = tier(a) - tier(b);
  if (d !== 0) return d;
  if (a.outcome === 'victory') return (a.ticks ?? Infinity) - (b.ticks ?? Infinity);
  return (b.ticks ?? 0) - (a.ticks ?? 0) || (b.population ?? 0) - (a.population ?? 0);
}

export function bestAttempt(attempts: readonly DailyAttempt[]): DailyAttempt | undefined {
  return [...attempts].filter((a) => a.outcome).sort(compareAttempts)[0];
}

/** "Victory in 14:32 · 340 ants", "Survived 9:10 · 120 ants". */
export function describeAttempt(a: DailyAttempt): string {
  const ants = a.population === undefined ? '' : ` · ${a.population} ants`;
  const time = formatDuration(a.ticks ?? 0);
  switch (a.outcome) {
    case 'victory':
      return `Victory in ${time}${ants}`;
    case 'defeat':
      return `Fell after ${time}${ants}`;
    case 'quit':
      return `Gave up after ${time}${ants}`;
    default:
      return 'Unfinished';
  }
}

export function shareText(date: string, a: DailyAttempt): string {
  const result =
    a.outcome === 'victory'
      ? `Victory in ${formatDuration(a.ticks ?? 0)}`
      : `Survived ${formatDuration(a.ticks ?? 0)}`;
  const size = a.population === undefined ? '' : ` with ${a.population} ants`;
  const retry = a.n > 1 ? ` (retry #${a.n - 1})` : '';
  return `Ant Simulator Daily ${date}: ${result}${size} 🐜${retry}`;
}
