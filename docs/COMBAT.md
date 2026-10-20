# Rival colony, combat and win/lose

Implements PLAN.md section 3 "Combat" and "Enemy AI", and the Phase 3 conflict items.

## Colonies

- Ant store fields `colony` (0 black/player, 1 red/AI), `caste` (`Caste`: worker / soldier /
  breeder) and `hp`. Each colony is a `Colony` with its own `Nest`, underground grid, brood,
  queen (with HP) and economy. `SimConfig.colonies` is 2 by default (1 = the old single-colony
  sandbox, nest at the centre; existing tests use it). `initialAnts` is per colony.
- Map (`createWorld`): nests 30% of the world size either side of the centre along a seeded,
  roughly diagonal axis; food is point-symmetric about the centre (mirrored pairs, plus a
  contested middle pile when the count is odd), so neither side is favoured.
- Layers: `ants.layer` is 0 on the surface and `1 + c` inside colony c's nest
  (`undergroundLayer(c)`), so raiders can be inside the enemy's grid.
- A per-tick census (`takeCensus`, one pass) fills every colony's population, castes,
  underground, fighting, intruders (enemy ants in its nest), threat (enemy surface ants near
  the entrance) and sticky `scouted` (an enemy ant got near). Economy, AI and snapshots read
  these instead of rescanning.
- Castes: pupae emerge as the caste furthest below `casteRatio` (`setCasteRatio`). Workers take
  forage/dig/nurse roles as before (rebalancing only counts the colony's workers). Soldiers
  patrol or raid. Breeders stay in the nursery and are only counted for now.

## Pheromones: one field per colony

Each colony owns a `PheromoneField` with `food`, `home`, `alarm`, `enemy`. Ants index
`fields[colony[i]]`, so trails are isolated by construction and the hot loop only does one
extra array lookup (layer arrays are resolved once and cached). The alternative, channels in a
shared field, would make every deposit and sense compute an offset and couple the colonies'
update rates for no gain.

- `alarm`: laid (5x5-cell splash) by fighting ants in their own field. Idle workers and
  soldiers steer up it with sensors at twice the trail distance; that is the recruitment.
- `enemy`: every surface ant leaves `presenceDeposit` in the _other_ colonies' `enemy` layer,
  so colony c's `enemy` layer is "where the enemy has been". Patrolling soldiers follow it.
- Raiders follow the enemy colony's `home` layer (strongest at the enemy nest), beelining once
  the nest is scouted, and go down the enemy entrance.

Cost: 8 layers instead of 2. Two mitigations keep it cheap: (1) `blurAndEvaporate` only
processes the band of rows that has scent (empty layers are skipped outright), and (2) the slow
layers (`food`, `home`, `enemy`) update every other tick with two ticks' worth of diffusion and
decay, phases staggered (`halfRate`). `alarm` stays per tick.

## Combat

`Combat.resolve` runs first each tick:

1. `SpatialHash` (32-unit cells over the surface plus one region per nest) rebuilt with a
   counting sort into `(cell, colony)` buckets; a per-cell colony bitmask makes "any enemy in
   my 3x3 cells?" nine byte reads, so ants away from the front cost almost nothing.
2. Ants with an enemy in range: within `contactRange` they deal their caste's damage and stand
   (`Fight`), laying alarm; otherwise soldiers (32) and idle workers (14) close in. Damage is
   accumulated and applied after the pass, so the result doesn't depend on index order. The
   player and recruits deal damage on contact but keep following the player.
3. Movement systems skip `Fight` ants.

At the end of the tick the sim removes ants at <= 0 HP with an order-preserving compaction
(`compactAnts`), which fills a remap table; the player controller follows its ant and recruits
through it. A dead player ant is replaced by the nearest black surface ant (`playerSwapped`).
Combat deaths drop `corpseFood` (+ anything carried) on the ground, merged into nearby piles
(`FoodField.addNear`); underground deaths feed the nest owner's store. Starvation now marks
victims (`STARVED_HP`) and goes through the same removal, without a corpse.

## Raids, queen death, game over

- `Colony.raid` (`setRaid`; the colony panel toggle for black, the AI for red): surface
  soldiers head for the enemy nest and enter it; inside, raiders follow the `toQueen` flow field
  and damage the queen in her chamber. Defenders: soldiers walk home and guard the queen chamber
  while there are intruders; any ant fights intruders that come within range.
- Queen at 0 HP (or starved) -> `queenKilled` event, colony `lost`. When at most one colony
  still has a queen -> `gameOver` event, `snapshot.winner` set, and the worker stops stepping.
  The web app shows a Victory/Defeat modal; "Play again" re-inits the worker with a new seed.

## AI director (`ai/director.ts`)

Every `interval` ticks, utility scores from the census: threat (enemy ants near the nest,
intruders, recent losses; smoothed), hunger (store vs. a comfortable level) and opportunity
(our worker + weighted soldier strength over the enemy's). Soldier share rises with threat and
opportunity and falls with hunger; foraging follows hunger, nursing the brood, digging the lack
of nursery room. A raid starts once past the grace period with enough soldiers and strength and
no threat at home, and continues while soldiers last. Pure arithmetic: deterministic.

`SimConfig.difficulty` (`easy` / `normal` / `hard`) picks a profile: decision interval, red lay
rate multiplier, start food bonus, soldier bias/cap, raid thresholds and grace period.

## Snapshot

Ant record `[x, y, heading, carrying, layer, flags]` (`ANT_STRIDE` 6), `flags` = colony | caste
<< 2 | fighting << 4 (`packAntFlags`). `snapshot.colonies[]` (with nest, food, castes, queen HP,
losses, intruders, raid, scouted), `nestGrids[]` (changed grids only, tagged by colony),
`winner`. Pheromones are the player colony's field only (what its ants can smell).
