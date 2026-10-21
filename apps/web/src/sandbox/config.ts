import type { SimConfigInput } from '@ant/shared';

/** Setup choices of a sandbox game (see `sandboxConfig`). */
export interface SandboxOptions {
  /** 1 = black colony only, 2 = black and red. */
  colonies: 1 | 2;
  /** Starting ants per colony. */
  ants: number;
  foodPiles: number;
  /** Spiders, antlion pits and rain. */
  hazards: boolean;
  /** The red colony's AI director runs. */
  ai: boolean;
  /** The game can be won or lost (a queen dying ends it). */
  winLose: boolean;
}

export const DEFAULT_SANDBOX: Readonly<SandboxOptions> = {
  colonies: 2,
  ants: 300,
  foodPiles: 6,
  hazards: false,
  ai: true,
  winLose: false,
};

/** Sim settings for a sandbox game: no win/lose or hazards unless the setup asks for them. */
export function sandboxConfig(o: SandboxOptions): SimConfigInput {
  return {
    sandbox: true,
    colonies: o.colonies,
    initialAnts: o.ants,
    foodSources: o.foodPiles,
    ai: o.ai,
    winLose: o.winLose,
    ...(o.hazards ? {} : { spiders: 0, antlions: 0, rain: { enabled: false } }),
  };
}
