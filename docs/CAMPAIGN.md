# Campaign mode

SimAnt's Full Game, in our terms: spread the black colony across the yard with mating flights,
get into the house and infest it until the humans move out. Main menu → **Campaign**.

## Map

- **Yard:** 8 × 6 patches (ids `row * 8 + col`), each with a seeded richness (food cap and
  regrowth, 4–6 food piles) and maybe a spider or an antlion pit.
- **House:** six rooms (ids 48–53) in a 3 × 2 block above the yard's top row, columns C–E. The
  row next to the yard (Kitchen, Hall, Living room) borders it. Kitchen and Pantry hold rich
  food, the other rooms are bare tile. No rain indoors, but humans walk about.
- Black starts alone in Yard B5 with 120 ants; red holds G2 and G5 with 100 each.

## One detailed patch, 53 summaries

Only the **active** patch is a full `Sim` (`packages/sim/src/sim.ts`). Every other patch is a
`PatchState`: natural food plus, per side, a `ColonySummary { pop, breeders, food }` or null.

- **Abstract model** (`campaign/model.ts`, `abstractTick`): every 100 sim ticks (5 s of game time)
  each summarised patch regrows food, its colonies forage (shared by head count), pay upkeep,
  starve, and breed (logistic towards 700 ants in the yard, 350 in a room; at most 6 births per
  tick, like one queen in the detailed sim). Part of the births become breeders: for black the
  player's caste-ratio breeder share (campaign default 12%), for red a difficulty share. Rival
  colonies in one patch fight (Lanchester-style attrition); a colony under 3 ants is wiped out.
  Ants in rooms get stamped on (worse with more black ants indoors). No randomness: it is
  deterministic and update-order independent. It costs about 0.006 ms for all 54 patches
  (`pnpm bench`).
- **Expand** (`Campaign.buildSim`): the patch's sim is built from its seed (layout, food pile
  positions, spider/antlion) and summary: one or two colonies, their ants (workers/soldiers by the
  caste ratio plus the breeders), nest food, and the patch's natural food split over its piles.
- **Collapse** (`syncActive`): population (plus half the brood), breeders, nest food and the food
  on the ground go back into the summary; a dead queen removes the colony. This also runs every
  abstract tick so the map stays live. Enter-then-leave leaves the summary unchanged (tested).
- Switching takes well under a millisecond in the sim (`pnpm bench`: 600 vs 600 ants), so the
  transition is a scene rebuild on the web side.

## Mating flights

- Breeders gather in each colony (the detailed patch: its breeder-caste ants). With 8 or more in
  total the HUD shows **Fly (n)**; the map has the same button. At the start of every season
  (24 abstract ticks = 2 minutes) red colonies with 4+ breeders fly on their own, and so does black
  if it has 8+ waiting.
- A flight empties every colony of that side. Each colony's breeders scatter to up to 3 patches
  within 2 cells (Chebyshev), weighted towards near, empty ones. In each target they found a
  colony with chance `1 - (1 - q)^n` (q = 12% × difficulty, ×0.35 if the other side is there,
  ×0.6 indoors) or join their own side's colony. The detailed patch is never a target (its
  colonies are owned by the sim). A new colony has `10 + 2n` ants and 40 food.

## House, victory, defeat

- **Humans** (`campaign/footsteps.ts`): in a room patch, feet appear as a growing shadow and stamp
  after 2 s, killing every surface ant underneath (underground ants are safe). They come more often
  the more black ants are in the house and aim at black ants 60% of the time.
- **Infestation meter:** with at least the target number of black ants in the house (220 / 350 /
  500 by difficulty) it fills (faster with more, ~2 min from empty); below it it drains.
  **Victory** when it is full: the humans move out.
- **Defeat** when no black colony is left anywhere.

## Saves

The campaign registers a `campaign` `SimModule` on the detailed sim through the new
`createSim(config, extras)` hook, so one ordinary save (`sim.serialize()`, same slots, same
format version) holds the summaries, campaign RNG, feet and the active patch in full. The save
header gets `info.campaign` (patches owned, difficulty); the worker uses it to pick
`restoreCampaign` over `restoreSim`. The round-trip test saves after a flight and a patch switch
and checks the restored campaign stays tick-identical.

## Events (for audio and UI)

`matingFlight`, `colonyFounded`, `colonyDestroyed`, `patchEntered`, `season`, `footstepWarning`,
`footstep`, `campaignOver` (see `SimEvent` in `packages/shared/src/types.ts`). The audio director
maps them in `EVENT_CUES`.

## Deferred

- A patch's dug nest layout and brood are not kept when you leave it (the nest is regenerated from
  its seed; brood becomes half as many adults).
- Flights cannot land in the patch you are playing.
- Weather on the map is only the active patch's rain; summarised patches have no weather.
- The yellow ant cannot walk between patches (SimAnt's edge-walking); switching is via the map.
- Red has no detailed-patch breeders (they are counted abstractly); the AI director does not plan
  expansion beyond the seasonal flights.
- The lawnmower and the humans' yard visits; pesticide.
- Placeholder art for the map, floor and feet (the art pass restyles `apps/web/src/campaign/`).
- Balance needs playtesting (passive play on easy can win in ~15 min).
