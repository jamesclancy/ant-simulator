# Spider predator

`packages/sim/src/predators/spider.ts` (`SpiderManager`, `sim.spiders`); rendered by `apps/web/src/predators/spiderLayer.ts`.

- **Config**: `SimConfig.spiders` (default 1, 0 disables) and `SimConfig.spider` (`DEFAULT_SPIDER`).
  `difficulty` scales hp (easy 0.7x, hard 1.4x) and speed (0.9x / 1.1x). Lairs are seeded, 10-90% of
  the map and at least a quarter of the world from every nest. `spawnSpider` command adds one (debug).
- **States**: Lurk (at the lair, regenerates, walks back if away) -> Hunt (1.3x ant speed toward the
  best nearby cell: ant count / distance, via the combat spatial hash, within `leash` of the lair;
  bites the nearest ant in `biteRange`) -> Eat (30 ticks standing still) -> Hunt. Below 30% hp it
  Retreats home, ignoring ants, until healed to 90%. At 0 hp it dies, drops `foodDrop` food and
  respawns at the lair after `respawnTicks` (2 min).
- **Kills** set `hp = STARVED_HP`, so they use the normal reap/compaction path (player swap works) and
  leave no corpse food. Eating the player emits `playerEaten` (toast).
- **Ants fight back**: every ant within `contactRange` removes hp per tick (soldier 0.4, worker 0.12,
  player 0.5). The spider lays alarm in every colony's field while ants are near, pulling idle ants
  in. Non-soldiers within `fleeRadius` are pushed away unless the mob within `mobRadius` (worker 1,
  soldier 3) reaches `mobSize`, then they stand and fight. Soldiers never flee.
- **Save/load**: registered as the `spiders` module in `createSim` (`getState()` / `setState()` are plain JSON); the round-trip test in `save.test.ts` includes a spawned spider.
