export const BroodStage = { Egg: 0, Larva: 1, Pupa: 2 } as const;
export type BroodStage = (typeof BroodStage)[keyof typeof BroodStage];

export interface BroodState {
  count: number;
  stage: Uint8Array;
  progress: Float32Array;
  eggs: number;
  larvae: number;
  pupae: number;
}

/** Struct-of-arrays brood: one slot per egg/larva/pupa; `progress` counts nursed ticks in the stage. */
export class Brood {
  count = 0;
  readonly stage: Uint8Array;
  readonly progress: Float32Array;
  eggs = 0;
  larvae = 0;
  pupae = 0;

  constructor(readonly capacity = 4096) {
    this.stage = new Uint8Array(capacity);
    this.progress = new Float32Array(capacity);
  }

  add(): boolean {
    if (this.count >= this.capacity) return false;
    this.stage[this.count] = BroodStage.Egg;
    this.progress[this.count] = 0;
    this.count++;
    this.eggs++;
    return true;
  }

  remove(i: number): void {
    const last = --this.count;
    this.stage[i] = this.stage[last]!;
    this.progress[i] = this.progress[last]!;
  }

  getState(): BroodState {
    return {
      count: this.count,
      stage: this.stage.slice(0, this.count),
      progress: this.progress.slice(0, this.count),
      eggs: this.eggs,
      larvae: this.larvae,
      pupae: this.pupae,
    };
  }

  setState(s: BroodState): void {
    this.stage.set(s.stage);
    this.progress.set(s.progress);
    this.count = s.count;
    this.eggs = s.eggs;
    this.larvae = s.larvae;
    this.pupae = s.pupae;
  }

  clear(): void {
    this.count = this.eggs = this.larvae = this.pupae = 0;
  }
}
