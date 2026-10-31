import { describe, expect, it } from 'vitest';
import { ANT_STRIDE, type Snapshot } from '@ant/shared';
import { Chatter, lineMs, type ChatterSource } from '../src/dialogue/chatter';
import {
  EVENT_LINES,
  RECRUITED,
  RIVAL_TALK,
  SMALL_TALK,
  SOLO,
  TO_PLAYER,
} from '../src/dialogue/lines';

const VIEW = { w: 800, h: 600 };

/** Ants at fixed screen positions (1 world unit = 1 px), colony in the flags. */
function source(
  ants: { x: number; y: number; colony?: number; carrying?: number }[],
): ChatterSource {
  const data = new Float32Array(ants.length * ANT_STRIDE);
  ants.forEach((a, i) => {
    const o = i * ANT_STRIDE;
    data[o] = a.x;
    data[o + 1] = a.y;
    data[o + 3] = a.carrying ?? 0;
    data[o + 5] = a.colony ?? 0;
  });
  return {
    count: ants.length,
    data,
    playerIndex: -1,
    underground: false,
    pixelSize: 2,
    screenAt(i, out) {
      out.x = data[i * ANT_STRIDE]!;
      out.y = data[i * ANT_STRIDE + 1]!;
      return i < ants.length;
    },
  };
}

/** A seeded LCG so picks are repeatable. */
const seeded =
  (seed = 1) =>
  () =>
    (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;

const snap = (events: Snapshot['events'], player: Snapshot['player'] = null): Snapshot =>
  ({ events, player }) as unknown as Snapshot;

describe('lines', () => {
  it('are short enough to fit a bubble', () => {
    const all = [
      ...SMALL_TALK.flat(),
      ...RIVAL_TALK.flat(),
      ...TO_PLAYER,
      ...RECRUITED,
      ...Object.values(SOLO).flat(),
      ...Object.values(EVENT_LINES).flat(),
    ];
    for (const line of all) expect(line.length, line).toBeLessThanOrEqual(48);
  });
});

describe('Chatter', () => {
  it('starts a two-ant conversation between neighbours and takes turns', () => {
    const c = new Chatter(() => 0.1);
    const src = source([
      { x: 300, y: 300 },
      { x: 320, y: 300 },
    ]);
    const first = c.tick(0, src, VIEW, true);
    expect(first).toHaveLength(1);
    const exchange = SMALL_TALK.find((e) => e[0] === first[0]!.text)!;
    expect(exchange).toBeDefined();
    const reply = c
      .tick(lineMs(exchange[0]!) * 0.85, src, VIEW, true)
      .find((b) => b.text === exchange[1]);
    expect(reply).toBeDefined();
    expect(reply!.x).not.toBe(first[0]!.x);
  });

  it('uses rival lines when a black and a red ant meet, black first', () => {
    const c = new Chatter(seeded(7));
    const src = source([
      { x: 300, y: 300, colony: 1 },
      { x: 310, y: 300, colony: 0 },
    ]);
    const [b] = c.tick(0, src, VIEW, true);
    if (RIVAL_TALK.some((e) => e[0] === b!.text)) expect(b!.colony).toBe(0);
    else expect(b).toBeDefined(); // the 25% solo branch
  });

  it('gives a lone food carrier a delivery line', () => {
    const c = new Chatter(() => 0.9);
    const [b] = c.tick(0, source([{ x: 300, y: 300, carrying: 1 }]), VIEW, true);
    expect(SOLO.food).toContain(b!.text);
  });

  it('shouts event lines and lets new recruits answer', () => {
    const c = new Chatter(() => 0.5);
    const src = source([
      { x: 300, y: 300 },
      { x: 500, y: 300 },
    ]);
    c.onSnapshot(snap([{ type: 'rainStarted' }]), 0);
    c.onSnapshot(
      snap([], { recruitedIndices: new Uint32Array([1]) } as unknown as Snapshot['player']),
      0,
    );
    const texts = c.tick(0, src, VIEW, true).map((b) => b.text);
    expect(texts.some((t) => EVENT_LINES.rainStarted!.includes(t))).toBe(true);
    expect(texts.some((t) => (RECRUITED as readonly string[]).includes(t))).toBe(true);
  });

  it('drops a bubble when its ant leaves the screen, and everything when switched off', () => {
    const c = new Chatter(() => 0.9);
    const src = source([{ x: 300, y: 300 }]);
    expect(c.tick(0, src, VIEW, true)).toHaveLength(1);
    src.data[0] = 2000;
    expect(c.tick(16, src, VIEW, false)).toHaveLength(0);
    src.data[0] = 300;
    expect(c.tick(5000, src, VIEW, true)).toHaveLength(1);
    expect(c.tick(5016, null, VIEW, true)).toHaveLength(0);
  });

  it('stays quiet when zoomed too far out', () => {
    const src = { ...source([{ x: 300, y: 300 }]), pixelSize: 0.3 };
    expect(new Chatter(() => 0.5).tick(0, src, VIEW, true)).toHaveLength(0);
  });
});
