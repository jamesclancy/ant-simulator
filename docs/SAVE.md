# Save / load

## Format (`packages/sim/src/save/format.ts`)

`"ANTS"` magic, u16 format version, u32 info length, JSON `SaveInfo` (tick, seed, winner,
populations; readable without inflating), then a zlib-deflated payload: the sim's state tree
as JSON plus a binary section holding every typed array (referenced as
`{ "$t": "f32", "o": offset, "n": length }`). Floats are stored bit-exact, so a restored sim
continues byte-identically. Unknown/newer versions are rejected with a `SaveError`
(`newerVersion`, `unsupportedVersion`, `badMagic`, `truncated`, `corrupt`); older versions are
upgraded through `MIGRATIONS[n]` (n -> n+1), currently empty at version 1.

Typical size: 20 KB at tick 0, 200-400 KB mid-game (1000-1700 ants), ~20 ms to serialize.

## Adding a stateful module

1. Give the class `getState()` returning plain data (numbers, strings, booleans, arrays,
   objects, `Uint8Array | Uint16Array | Int32Array | Float32Array`; no classes, Maps,
   `undefined`) and `setState(state)` taking the same shape back. Copy typed arrays
   (`slice`) and, for pools, store only the live `count` entries.
2. Register it in the `modules` list in `createSim` (`packages/sim/src/sim.ts`) with a unique
   `key`. Saves from before the module existed have no entry for it and keep its fresh state.
3. Only bump `SAVE_VERSION` (and add a migration) when changing the shape of existing state.
4. Extend the round-trip test in `packages/sim/test/save.test.ts` so the new state is exercised.

Derived caches (spatial hashes, nest-grid lists) are rebuilt in `setState`, not stored.

## Web app (`apps/web/src/save`)

`SaveStore` (IndexedDB on the web, `@capacitor/filesystem` files on native; chosen by
`Capacitor.isNativePlatform()`), `SaveController` (worker <-> store), and `hasSave()` /
`loadLatest()` in `save/index.ts` for a Continue button. Slots: `auto` (every 60 s of game
time and when the app is backgrounded) plus `slot1..3`.
