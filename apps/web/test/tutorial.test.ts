import { describe, expect, it } from 'vitest';
import { TUTORIAL_STEPS, Tutorial, type TutorialObservation } from '../src/ui/tutorial';

const nest = { x: 100, y: 100, radius: 10 };
const obs = (over: Partial<TutorialObservation> = {}): TutorialObservation => ({
  player: { x: 100, y: 100, carrying: 0, trail: false, recruits: 0 },
  nest,
  food: 0,
  ratio: { forage: 0.6, dig: 0.2, nurse: 0.2 },
  casteRatio: { worker: 0.8, soldier: 0.2, breeder: 0 },
  layer: 0,
  scentOn: false,
  redQueenDead: false,
  ...over,
});
const player = (p: Partial<NonNullable<TutorialObservation['player']>>) => ({
  x: 100,
  y: 100,
  carrying: 0,
  trail: false,
  recruits: 0,
  ...p,
});
const id = (t: Tutorial): string | undefined => t.step?.id;

describe('Tutorial', () => {
  it('walks every step in order as the player acts', () => {
    const t = new Tutorial();
    expect(id(t)).toBe('move');
    t.observe(obs());
    expect(id(t)).toBe('move');
    t.observe(obs({ player: player({ x: 150 }) }));
    expect(id(t)).toBe('pickup');
    t.observe(obs({ player: player({ x: 150, carrying: 1 }) }));
    expect(id(t)).toBe('deliver');
    // Dropped far from the nest does not count.
    t.observe(obs({ player: player({ x: 300, carrying: 0 }) }));
    expect(id(t)).toBe('deliver');
    t.observe(obs({ player: player({ x: 300, carrying: 1 }) }));
    t.observe(obs({ player: player({ x: 105, carrying: 0 }) }));
    expect(id(t)).toBe('trail');
    t.observe(obs({ player: player({ trail: true }) }));
    expect(id(t)).toBe('trail');
    t.observe(obs({ scentOn: true }));
    expect(id(t)).toBe('recruit');
    t.observe(obs({ player: player({ recruits: 5 }) }));
    expect(id(t)).toBe('nest');
    t.observe(obs({ layer: 1 }));
    expect(id(t)).toBe('ratios');
    t.observe(obs({ layer: 1 }));
    expect(id(t)).toBe('ratios');
    t.observe(obs({ ratio: { forage: 0.3, dig: 0.4, nurse: 0.3 } }));
    expect(id(t)).toBe('goal');
    t.observe(obs({ redQueenDead: true }));
    expect(t.finished).toBe(true);
    expect(t.step).toBeNull();
  });

  it('does not skip steps when later conditions are already true', () => {
    const t = new Tutorial();
    t.observe(obs({ player: player({ recruits: 3, carrying: 1 }), layer: 1 }));
    expect(id(t)).toBe('move');
  });

  it('skip finishes immediately and notifies', () => {
    const t = new Tutorial();
    let changes = 0;
    t.onChange = () => changes++;
    t.skip();
    expect(t.finished).toBe(true);
    expect(changes).toBe(1);
    t.observe(obs({ player: player({ x: 999 }) }));
    expect(changes).toBe(1);
  });

  it('goal step can be dismissed with advance', () => {
    const t = new Tutorial();
    for (let i = 0; i < TUTORIAL_STEPS.length - 1; i++) t.advance();
    expect(id(t)).toBe('goal');
    t.advance();
    expect(t.finished).toBe(true);
  });

  it('has touch and desktop wording for every step', () => {
    for (const s of TUTORIAL_STEPS) {
      expect(s.text.touch.length).toBeGreaterThan(0);
      expect(s.text.desktop.length).toBeGreaterThan(0);
    }
  });
});
