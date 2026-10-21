/** What the tutorial watches: derived from snapshots and HUD state, no sim changes needed. */
export interface TutorialObservation {
  player: { x: number; y: number; carrying: number; trail: boolean; recruits: number } | null;
  /** Player colony's nest entrance and its stores/ratios. */
  nest: { x: number; y: number; radius: number };
  food: number;
  ratio: { forage: number; dig: number; nurse: number };
  casteRatio: { worker: number; soldier: number; breeder: number };
  layer: 0 | 1;
  scentOn: boolean;
  /** Red queen is dead (the game is won). */
  redQueenDead: boolean;
}

export type TutorialStepId =
  'move' | 'pickup' | 'deliver' | 'trail' | 'recruit' | 'nest' | 'ratios' | 'goal';

export interface TutorialText {
  title: string;
  /** Touch and mouse/keyboard wordings. */
  touch: string;
  desktop: string;
}

export const TUTORIAL_STEPS: readonly { id: TutorialStepId; text: TutorialText }[] = [
  {
    id: 'move',
    text: {
      title: 'Move your ant',
      touch: 'You are the yellow ant. Tap the ground, or drag the joystick, to walk.',
      desktop: 'You are the yellow ant. Click the ground, or use WASD / arrow keys, to walk.',
    },
  },
  {
    id: 'pickup',
    text: {
      title: 'Find food',
      touch: 'Walk up to a food pile and tap Pick up.',
      desktop: 'Walk up to a food pile and press E (or the Pick up button).',
    },
  },
  {
    id: 'deliver',
    text: {
      title: 'Bring it home',
      touch: 'Carry the food to your nest entrance (the dirt mound) and tap Drop.',
      desktop: 'Carry the food to your nest entrance (the dirt mound) and press E to drop it.',
    },
  },
  {
    id: 'trail',
    text: {
      title: 'Lay a scent trail',
      touch:
        'Turn on Trail and walk a bit, then switch on Scent vision to see it. Other ants follow it.',
      desktop:
        'Hold Shift (or press Trail) and walk a bit, then switch on Scent vision to see it. Other ants follow it.',
    },
  },
  {
    id: 'recruit',
    text: {
      title: 'Recruit ants',
      touch: 'Tap Recruit 5 to call nearby idle ants to follow you.',
      desktop: 'Press R (or Recruit 5) to call nearby idle ants to follow you.',
    },
  },
  {
    id: 'nest',
    text: {
      title: 'Visit the nest',
      touch: 'Tap Nest to look underground at your colony.',
      desktop: 'Press Tab (or the Nest button) to look underground at your colony.',
    },
  },
  {
    id: 'ratios',
    text: {
      title: 'Run the colony',
      touch: 'Open the Colony panel and drag a slider to change what your ants do or are born as.',
      desktop:
        'Open the Colony panel and drag a slider to change what your ants do or are born as.',
    },
  },
  {
    id: 'goal',
    text: {
      title: 'Your goal',
      touch: 'Grow your colony, find the red nest and kill the red queen. Good luck!',
      desktop: 'Grow your colony, find the red nest and kill the red queen. Good luck!',
    },
  },
];

const MOVE_DISTANCE = 20;
const RATIO_EPSILON = 0.03;

const sameRatio = (a: Record<string, number>, b: Record<string, number>): boolean =>
  Object.keys(a).every((k) => Math.abs(a[k]! - b[k]!) < RATIO_EPSILON);

/**
 * Step progression for the first-game tutorial. Feed it observations; each step
 * completes when the player actually does the thing. The last step is a goal
 * card that waits for `dismiss()` (or the red queen dying).
 */
export class Tutorial {
  index = 0;
  finished = false;
  onChange: () => void = () => {};
  private start: { x: number; y: number } | null = null;
  private everCarried = false;
  private sawTrail = false;
  private sawScent = false;
  private baseline: { ratio: object; caste: object } | null = null;

  get step(): (typeof TUTORIAL_STEPS)[number] | null {
    return this.finished ? null : (TUTORIAL_STEPS[this.index] ?? null);
  }

  observe(o: TutorialObservation): void {
    if (this.finished) return;
    const id = this.step!.id;
    const p = o.player;
    const done = ((): boolean => {
      switch (id) {
        case 'move':
          if (!p) return false;
          this.start ??= { x: p.x, y: p.y };
          return Math.hypot(p.x - this.start.x, p.y - this.start.y) > MOVE_DISTANCE;
        case 'pickup':
          return !!p && p.carrying > 0;
        case 'deliver': {
          if (!p) return false;
          if (p.carrying > 0) this.everCarried = true;
          const near = Math.hypot(p.x - o.nest.x, p.y - o.nest.y) <= o.nest.radius * 2;
          return this.everCarried && p.carrying === 0 && near;
        }
        case 'trail':
          this.sawTrail ||= !!p?.trail;
          this.sawScent ||= o.scentOn;
          return this.sawTrail && this.sawScent;
        case 'recruit':
          return !!p && p.recruits > 0;
        case 'nest':
          return o.layer === 1;
        case 'ratios': {
          this.baseline ??= { ratio: { ...o.ratio }, caste: { ...o.casteRatio } };
          return !(
            sameRatio(o.ratio, this.baseline.ratio as Record<string, number>) &&
            sameRatio(o.casteRatio, this.baseline.caste as Record<string, number>)
          );
        }
        case 'goal':
          return o.redQueenDead;
      }
    })();
    if (done) this.advance();
  }

  /** Move to the next step (or finish after the last). */
  advance(): void {
    if (this.finished) return;
    this.index++;
    if (this.index >= TUTORIAL_STEPS.length) this.finished = true;
    this.onChange();
  }

  /** Skip the whole tutorial. */
  skip(): void {
    if (this.finished) return;
    this.finished = true;
    this.onChange();
  }
}
