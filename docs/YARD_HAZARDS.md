# Yard hazards: lawnmower and footsteps

Both live in `packages/sim/src/hazards/` and run on every surface (Quick Game, Sandbox, campaign
yard patches). Underground is always safe: both only touch `layer === 0` ants, so keeping ants
home when warned is the counter.

## Lawnmower (`lawnmower.ts`)

A seeded timer (5-9 min at normal; `easy` x1.5 gaps and 0.7x passes, `hard` x0.7 gaps and 1.3x
passes; `frequency` divides the gap) starts a mowing:

1. `mowerWarning` and the lanes appear on `Snapshot.mower` (`phase: 'warning'`, 10 s). The renderer
   marks them with amber dashed stripes; the engine-rev sound starts in the last 3 s.
2. `mowerStarted`: 1-3 straight passes of a 140 unit swath along one axis, in adjacent lanes,
   alternating direction, 7 units per tick (~15 s per pass).
3. Each tick it kills the surface ants in the strip it just crossed (any colony, the player's ant
   too: `playerEaten` with cause `mower`; no corpse), zeroes every surface pheromone layer there,
   removes food piles of 80 or less (bigger ones lose 30%) and flattens dirt mounds (`colony.dirt`).
4. `mowerEnded` reports the total kills.

State is the `mower` save module. Sandbox: `startMower` command / Send mower button.

## Yard footsteps (`yardSteps.ts`, `footsteps.ts`)

A walking human crosses the yard on a seeded timer (3-6 min at normal): `humansWarning`, then a
straight line of 7-12 large feet (radius 56, alternating left/right of the line). Each foot is the
house `Footsteps` logic generalised (`addFoot` for scripted feet with their own radius and timing):
its shadow appears one stride (14 ticks) after the previous one, grows for 36 ticks, then stamps,
crushing surface ants under it (`playerEaten` cause `stomped` for the player). Feet are on
`Snapshot.footsteps` with the walking `angle`. State is the `yardSteps` save module.

The campaign house keeps its random, crowd-driven feet (`campaign/footsteps.ts` re-exports the
shared class); yard walks are off there.

## Client

`apps/web/src/hazards/mowerLayer.ts` and `yardFootLayer.ts` draw them with the sprites in
`art/sprites/yard.ts`. Screen shake (`Camera.shake`) is skipped with reduce motion; a stamp or the
mower on the player's ant triggers a heavy haptic. Sounds: `engineRise` and the looping `mower` bed
(louder the closer the mower is to the view), plus the existing rumble / thunder cues for feet.
