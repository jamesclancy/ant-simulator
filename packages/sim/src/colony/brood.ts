export const BroodStage = { Egg: 0, Larva: 1, Pupa: 2 } as const;
export type BroodStage = (typeof BroodStage)[keyof typeof BroodStage];

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

  clear(): void {
    this.count = this.eggs = this.larvae = this.pupae = 0;
  }
}
