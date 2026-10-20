import { describe, expect, it } from 'vitest';
import { createRng } from '../src';

describe('rng helpers', () => {
  it('range stays within [min, max)', () => {
    const rng = createRng(3);
    for (let i = 0; i < 1000; i++) {
      const v = rng.range(-5, 10);
      expect(v).toBeGreaterThanOrEqual(-5);
      expect(v).toBeLessThan(10);
    }
  });

  it('int yields integers in [0, n) and covers every bucket', () => {
    const rng = createRng(9);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const v = rng.int(6);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
      seen.add(v);
    }
    expect(seen.size).toBe(6);
  });

  it('getState/setState replays the same sequence', () => {
    const rng = createRng(11);
    rng.next();
    const state = rng.getState();
    const first = [rng.next(), rng.next(), rng.next()];
    rng.setState(state);
    expect([rng.next(), rng.next(), rng.next()]).toEqual(first);
  });

  it('treats seeds as uint32', () => {
    expect(createRng(-1).next()).toBe(createRng(0xffffffff).next());
  });
});
