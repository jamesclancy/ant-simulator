import { darken, lighten, mix } from './pixels';

/**
 * The single source of colour for the game's pixel art and its CSS theme. Terrain colours are
 * fixed; the colony, player and scent colours depend on the chosen accessibility palette.
 * Colonies are also told apart by shape and markings (see `sprites/ants.ts`), never colour alone.
 */
export type PaletteMode = 'default' | 'deuteranopia' | 'protanopia' | 'tritanopia' | 'highContrast';

export const PALETTE_MODES: readonly PaletteMode[] = [
  'default',
  'deuteranopia',
  'protanopia',
  'tritanopia',
  'highContrast',
];

export const PALETTE_LABELS: Record<PaletteMode, string> = {
  default: 'Default',
  deuteranopia: 'Deuteranopia',
  protanopia: 'Protanopia',
  tritanopia: 'Tritanopia',
  highContrast: 'High contrast',
};

/** Ramp of one colony's (or the player's) ant colours. */
export interface AntColors {
  body: number;
  light: number;
  shade: number;
  /** Silhouette ring on the surface. */
  outline: number;
  /** Silhouette ring underground (must read against dark tunnels). */
  nestOutline: number;
  /** Stripes / spot that identify the colony independent of hue. */
  mark: number;
  /** Mandible tips, antennae. */
  accent: number;
}

export type Rgb = readonly [number, number, number];

export interface Palette {
  mode: PaletteMode;
  /** Index = colony id (0 black/player's, 1 red). */
  colonies: readonly [AntColors, AntColors];
  player: AntColors;
  scent: { food: Rgb; home: Rgb; alarm: Rgb; enemy: Rgb };
  /** CSS colours for HUD pips and UI accents. */
  css: { c0: string; c1: string; player: string; accent: string };
  /** Thicker, brighter silhouettes. */
  highContrast: boolean;
}

function ramp(
  body: number,
  outline: number,
  nestOutline: number,
  mark: number,
  accent: number,
): AntColors {
  return {
    body,
    light: lighten(body, 0.32),
    shade: darken(body, 0.35),
    outline,
    nestOutline,
    mark,
    accent,
  };
}

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
const rgbOf = (c: number): Rgb => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

const PLAYER = ramp(0xffd21a, 0x1c1300, 0xfff2a8, 0xff7a00, 0xfff7c2);

function make(
  mode: PaletteMode,
  c0: AntColors,
  c1: AntColors,
  scent: Palette['scent'],
  accent: number,
  highContrast = false,
): Palette {
  return {
    mode,
    colonies: [c0, c1],
    player: PLAYER,
    scent,
    css: { c0: hex(c0.body), c1: hex(c1.body), player: hex(PLAYER.body), accent: hex(accent) },
    highContrast,
  };
}

const PALETTES: Record<PaletteMode, Palette> = {
  default: make(
    'default',
    ramp(0x2b2b36, 0x0c0c12, 0xcdbf9f, 0x9aa0b4, 0xd8d8e0),
    ramp(0xd03a22, 0x2a0a06, 0xffb08a, 0xffe2b0, 0xfff0d0),
    {
      food: rgbOf(0xffbe28),
      home: rgbOf(0x46aaff),
      alarm: rgbOf(0xff4646),
      enemy: rgbOf(0xdc46ff),
    },
    0xffd84a,
  ),
  // Red/green confusions: the rival is a light sky blue against the navy-black home colony, so
  // hue and (above all) lightness separate them; alarm trails are white instead of red.
  deuteranopia: make(
    'deuteranopia',
    ramp(0x1c2250, 0x07091f, 0xa9c4ff, 0x6f8ae0, 0xc8d6ff),
    ramp(0x7fd0ff, 0x07263f, 0xd6f0ff, 0xffffff, 0xffffff),
    {
      food: rgbOf(0xf0e442),
      home: rgbOf(0x2f7de8),
      alarm: rgbOf(0xffffff),
      enemy: rgbOf(0xcc79a7),
    },
    0xf0e442,
  ),
  protanopia: make(
    'protanopia',
    ramp(0x1c2250, 0x07091f, 0xa9c4ff, 0x6f8ae0, 0xc8d6ff),
    ramp(0x8fd8ff, 0x07263f, 0xdff4ff, 0xffffff, 0xffffff),
    {
      food: rgbOf(0xf0e442),
      home: rgbOf(0x2f7de8),
      alarm: rgbOf(0xffffff),
      enemy: rgbOf(0xcc79a7),
    },
    0xf0e442,
  ),
  // Blue/yellow confusions: keep the dark home colony and a vivid magenta-red rival.
  tritanopia: make(
    'tritanopia',
    ramp(0x25252e, 0x0a0a10, 0xd0c8b4, 0xa0a4b8, 0xe0e0e8),
    ramp(0xe0306e, 0x30051a, 0xffa8c8, 0xffe8f0, 0xffffff),
    {
      food: rgbOf(0xff7a3d),
      home: rgbOf(0x33c8c8),
      alarm: rgbOf(0xffffff),
      enemy: rgbOf(0x7a3ac8),
    },
    0xff9a5a,
  ),
  highContrast: make(
    'highContrast',
    ramp(0x000000, 0xffffff, 0xffffff, 0xffffff, 0xffffff),
    ramp(0xffffff, 0x000000, 0xffffff, 0x000000, 0x000000),
    {
      food: rgbOf(0xffff00),
      home: rgbOf(0x00e5ff),
      alarm: rgbOf(0xffffff),
      enemy: rgbOf(0xff00ff),
    },
    0xffff00,
    true,
  ),
};

export function paletteFor(mode: PaletteMode): Palette {
  return PALETTES[mode] ?? PALETTES.default;
}

/** Terrain, food and creature colours that do not change with the accessibility palette. */
export const T = {
  grass: [0x3f6a2e, 0x4d7a35, 0x5a8c3f, 0x6a9d47, 0x7bae55],
  grassDark: 0x335a27,
  dirt: [0x4a3320, 0x6b4a2c, 0x8a6238, 0xa87c4a, 0xc29a62],
  soilTop: 0x93653a,
  soilDeep: 0x4a2f1a,
  tunnel: 0x24170c,
  tunnelRim: 0x3d2a18,
  rock: [0x4a4a52, 0x6b6b72, 0x8a8a90, 0xa8a8ac, 0xc8c8cc],
  sand: [0x8a6a30, 0xb08e48, 0xc9ab62, 0xe3cd90, 0xf2e3b0],
  water: [0x1e5fa8, 0x3b8ed8, 0x7cc0f0, 0xbfe2ff],
  sky: 0x6fb4d8,
  skyLight: 0x8ecbe8,
  crumb: [0x8a5a1c, 0xc98a2c, 0xe8b84a, 0xffe08a],
  sugar: [0xbcb8c8, 0xe4e2ec, 0xffffff, 0xff9ec0],
  corpse: [0x3a2a1c, 0x5c4630, 0x7a6244, 0xa8895a],
  spider: [0x140c18, 0x2a1a2e, 0x4b2f55, 0x7a4f88],
  spiderEye: 0xff4040,
  jaw: 0x2b1d10,
  brood: {
    egg: 0xf4f0e0,
    larva: 0xe8d9a8,
    larvaShade: 0xb89c5a,
    pupa: 0xa8752c,
    pupaShade: 0x73501c,
  },
  chamber: { queen: 0x4a2c28, food: 0x4a4018, nursery: 0x2e3a4a },
  white: 0xffffff,
  black: 0x000000,
} as const;

/** Soil colour for a nest row (lighter near the surface, darker deep down). */
export function soilRamp(depth: number): number {
  return mix(T.soilTop, T.soilDeep, Math.min(1, Math.max(0, depth)));
}
