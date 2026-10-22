import type { DailyAttempt } from './daily';

const KEY = 'ant-simulator-daily-v1';
/** Days of history kept. */
const KEEP_DAYS = 60;

export type DailyHistory = Record<string, DailyAttempt[]>;

/** Local-only daily results (a server leaderboard is deferred; see docs/REPLAYS.md). */
export class DailyStore {
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null = safe()) {}

  all(): DailyHistory {
    try {
      const raw = this.storage?.getItem(KEY);
      return raw ? (JSON.parse(raw) as DailyHistory) : {};
    } catch {
      return {};
    }
  }

  attempts(date: string): DailyAttempt[] {
    return this.all()[date] ?? [];
  }

  /** Register a new try for `date` and return it (`n` = 1 for the counting attempt). */
  begin(date: string, now = Date.now()): DailyAttempt {
    const all = this.all();
    const list = (all[date] ??= []);
    const attempt: DailyAttempt = { n: list.length + 1, startedAt: now };
    list.push(attempt);
    this.write(all);
    return attempt;
  }

  /** Fill in the result of attempt `n`. */
  finish(
    date: string,
    n: number,
    result: Omit<DailyAttempt, 'n' | 'startedAt'>,
  ): DailyAttempt | null {
    const all = this.all();
    const a = all[date]?.find((x) => x.n === n);
    if (!a) return null;
    Object.assign(a, result);
    this.write(all);
    return a;
  }

  private write(all: DailyHistory): void {
    const dates = Object.keys(all).sort();
    for (const old of dates.slice(0, Math.max(0, dates.length - KEEP_DAYS))) delete all[old];
    try {
      this.storage?.setItem(KEY, JSON.stringify(all));
    } catch {
      // Private mode / quota: results just aren't kept.
    }
  }
}

function safe(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}
