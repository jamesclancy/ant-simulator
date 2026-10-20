# Underground nest & colony economy

Implements the PLAN.md "Digging / terrain", "Layer transitions" and "Colony economy" systems.

## Layers and coordinates

- `ants.layer`: 0 surface, 1 underground. Underground `x/y` are in **nest-grid units** (`NEST_TILE` = 12 per tile, y down), not surface units. The snapshot ant record is `[x, y, heading, carrying, layer]` (`ANT_STRIDE` = 5; `carrying` > 0 food, < 0 dirt).
- Each `Colony` (`packages/sim/src/colony`, keyed by `id`) owns a `NestGrid` (96x64 tiles: soil / tunnel / chamber / rock / air; row 0 is the surface line with one entrance tile), its flow fields, dig plan, brood and queen. A second colony is another instance with its own `Nest`.
- Surface ants only run foraging; underground ants are stepped by `updateUndergroundAnts` (`underground/ants.ts`). `updateAnts` skips `layer !== 0` and, for surface ants whose `role` isn't forage, calls `colony.walkToNest` (walk to the entrance and descend).

## Underground movement

BFS **flow fields** (`underground/flow.ts`): walking distance over open tiles to the entrance, food chambers, nursery/queen chambers, and the current dig face. An ant reads its own tile and four neighbours and walks to the lowest, then mills about once at distance 0. Fields rebuild lazily when the grid version changes (a few thousand tiles); per ant cost is a handful of array reads.

## Roles and the economy

- `ants.role` (`AntRole`: forage / dig / nurse) follows `behaviorRatio` (`setBehaviorRatio` command). Every 10 ticks idle (not carrying) ants move from over- to under-quota roles, in index order.
- Foragers come home with food, go underground, drop it in a food chamber (only then does it count in `nest.store`), and exit. Diggers work the dig face (up to `digMaxWorkers` contribute; `digCost` worker-ticks per tile); the finisher hauls the dirt out (dirt mound on the surface). `DigPlanner` queues tunnel segments and chambers deterministically.
- The queen lays eggs at `maxLayRate * min(1, store / layFoodTarget)` while there is nursery room (`broodPerTile` per queen/nursery tile). Brood: egg -> larva (eats from the store) -> pupa -> adult worker in a nursery chamber. Tending nurses multiply development speed up to `1 + nurseBoost`.
- Upkeep eats from the store each tick; with an empty store ants die (`starveRate`) and after `queenStarveTicks` the queen dies (`colony.lost`).
- `casteRatio` is stored but only workers spawn for now.

## Snapshot

`snapshot.colony` (counts, queen, roles, dirt) every tick; `snapshot.nestGrid` (packed cells `type | kind << 3`) only when the grid changed since the previous snapshot.

## Notes for other systems

- `removeAnt` (starvation) swap-removes: **ant indices are not stable** when ants die. Anything holding an index (e.g. a player ant) must re-find it or be exempted.
- Default ant count is now 500 and pile size 1500 (start small, grow).
