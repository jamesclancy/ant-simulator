import { describe, expect, it } from 'vitest';
import {
  DAILY_MAX_ANTS,
  bestAttempt,
  compareAttempts,
  dailyConfig,
  dailySetup,
  dateKey,
  describeAttempt,
  formatDuration,
  isDateKey,
  shareText,
  type DailyAttempt,
} from '../src/daily/daily';
import { DailyStore } from '../src/daily/history';

const mem = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
};

describe('daily setup', () => {
  it('derives the same setup for a date every time', () => {
    expect(dailySetup('2026-10-22')).toEqual(dailySetup('2026-10-22'));
    // Pinned: changing the derivation changes everyone's seed for a given day.
    expect(dailySetup('2026-10-22')).toMatchInlineSnapshot(`
      {
        "antlions": 3,
        "date": "2026-10-22",
        "difficulty": "normal",
        "rain": true,
        "seed": 142350780,
        "spiders": 3,
      }
    `);
  });

  it('differs between dates and always yields a valid seed', () => {
    const seeds = new Set<number>();
    for (let d = 1; d <= 28; d++) {
      const s = dailySetup(`2026-02-${String(d).padStart(2, '0')}`);
      expect(s.seed).toBeGreaterThan(0);
      expect(s.seed).toBeLessThanOrEqual(0x7fffffff);
      expect(s.spiders).toBeGreaterThanOrEqual(1);
      expect(s.antlions).toBeGreaterThanOrEqual(2);
      seeds.add(s.seed);
    }
    expect(seeds.size).toBe(28);
  });

  it('uses the UTC date and a fixed ant cap', () => {
    expect(dateKey(new Date('2026-10-22T23:59:59Z'))).toBe('2026-10-22');
    expect(dateKey(new Date('2026-10-23T00:00:00Z'))).toBe('2026-10-23');
    expect(isDateKey('2026-10-22')).toBe(true);
    expect(isDateKey('2026-13-40')).toBe(false);
    const config = dailyConfig(dailySetup('2026-10-22'));
    expect(config.maxAnts).toBe(DAILY_MAX_ANTS);
    expect(config.rain).toEqual({ enabled: true });
  });
});

describe('daily results', () => {
  const win = (ticks: number, population = 100): DailyAttempt => ({
    n: 1,
    startedAt: 0,
    outcome: 'victory',
    ticks,
    population,
  });

  it('ranks victories by time, then survival, then colony size', () => {
    const fast = win(20_000);
    const slow = win(30_000);
    const longLoss: DailyAttempt = { n: 2, startedAt: 0, outcome: 'defeat', ticks: 60_000 };
    const shortLoss: DailyAttempt = { n: 3, startedAt: 0, outcome: 'defeat', ticks: 10_000 };
    const bigger: DailyAttempt = { ...shortLoss, n: 4, population: 50 };
    const running: DailyAttempt = { n: 5, startedAt: 0 };
    expect([running, shortLoss, slow, longLoss, fast, bigger].sort(compareAttempts)).toEqual([
      fast,
      slow,
      longLoss,
      bigger,
      shortLoss,
      running,
    ]);
    expect(bestAttempt([running, longLoss, slow])).toBe(slow);
    expect(bestAttempt([running])).toBeUndefined();
  });

  it('formats results and share text', () => {
    expect(formatDuration(20 * (14 * 60 + 32))).toBe('14:32');
    const a = win(20 * (14 * 60 + 32), 340);
    expect(describeAttempt(a)).toBe('Victory in 14:32 · 340 ants');
    expect(shareText('2026-10-22', a)).toBe(
      'Ant Simulator Daily 2026-10-22: Victory in 14:32 with 340 ants 🐜',
    );
    expect(shareText('2026-10-22', { ...a, n: 2, outcome: 'defeat' })).toContain('(retry #1)');
    expect(shareText('2026-10-22', { ...a, outcome: 'defeat' })).toContain('Survived 14:32');
  });
});

describe('daily history', () => {
  it('counts the first attempt of a date, flags the rest, and persists', () => {
    const storage = mem();
    const store = new DailyStore(storage);
    expect(store.begin('2026-10-22', 1).n).toBe(1);
    expect(store.begin('2026-10-22', 2).n).toBe(2);
    expect(store.begin('2026-10-23', 3).n).toBe(1);
    store.finish('2026-10-22', 1, { outcome: 'victory', ticks: 100, population: 7 });
    const again = new DailyStore(storage);
    expect(again.attempts('2026-10-22')).toEqual([
      { n: 1, startedAt: 1, outcome: 'victory', ticks: 100, population: 7 },
      { n: 2, startedAt: 2 },
    ]);
    expect(again.finish('2000-01-01', 1, { outcome: 'quit' })).toBeNull();
  });

  it('survives unavailable or corrupt storage', () => {
    expect(new DailyStore(null).begin('2026-10-22').n).toBe(1);
    const bad = { getItem: () => '{nope', setItem: () => undefined };
    expect(new DailyStore(bad).attempts('2026-10-22')).toEqual([]);
  });
});
