# Sandbox mode

A SimAnt "Experimental"-style game mode: no pressure, full control. Start it from the main menu → **Sandbox**.

## Setup

| Option                | Meaning                                                                  |
| --------------------- | ------------------------------------------------------------------------ |
| Colonies              | Black only (nest in the middle) or black & red                           |
| Starting ants         | Per colony                                                               |
| Food piles            | Placed at start                                                          |
| Hazards               | Spiders, antlion pits and rain (off by default)                          |
| Red colony AI         | Runs the red director (`config.ai`); off = red keeps its starting ratios |
| Win / lose conditions | Off by default: a dead queen does not end the game (`config.winLose`)    |
| Seed                  | Blank = random                                                           |

These map onto `SimConfig` (`sandbox`, `ai`, `winLose`, `colonies`, ...) in `apps/web/src/sandbox/config.ts`.

## Toolbar

Collapsible panel on the right (collapsed by default on phones). **Pan** hands one-finger / left-button drags to the camera; picking a tool hands them to the brush instead. Pinch, the wheel and right/middle-button drag always move the camera. Tapping a tool again goes back to Pan.

- **Food**, **Rocks**, **Erase**, **Ants** (colony + caste pickers): tap or drag to paint.
- **Spider**, **Antlion**: tap to place.
- Start / stop rain, clear scent, clear rocks.
- **Parameters**: opens the live tuning panel (below).
- Time controls go up to 8x (sandbox only).

## Rocks (obstacles)

Impassable discs on the surface (`packages/sim/src/world/obstacles.ts`). They are rasterised into a coarse blocking grid (one byte lookup per ant move; zero cost when there are none). Surface ants look a few steps ahead and swerve (`avoid`), and a move into a rock slides along it or is dropped (`slide`). Deterministic: no rng. Rocks are refused near a nest entrance, crush food under them, and push ants out of them. Spiders and antlions ignore rocks.

## Sandbox-only commands

Ignored unless `config.sandbox`: `placeObstacle`, `clearObstacles`, `erase`, `setCombat`, `setColonyParams`, `setPheromoneParams`. (`stopRain` and the spawn / rain / pit commands work in any game.)

## Live parameters

Sliders for movement, senses, scent (deposit, evaporation, spread), combat (HP, damage, ranges) and brood / economy rates, with **Reset to defaults**. Every change is a command, so it stays deterministic and is saved: `setColonyParams` and `setPheromoneParams` overrides live in the sim's `tuning` module (a restored sim rebuilds its colonies from the base config, so it re-applies them); behaviour and combat ride along in the saved config.

## Saves

Sandbox saves work like any other and are labelled "Sandbox" in the save list (`SaveInfo.sandbox`). Continuing one restores the toolbar. The rocks are the `obstacles` module in the save state; no format version bump (older saves simply have no entry).
