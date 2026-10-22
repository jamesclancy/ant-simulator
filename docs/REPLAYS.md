# Replays and the daily challenge

The sim is deterministic, so a game is fully described by its inputs. A **replay** is the
starting state plus every command with the tick it was applied at.

## Recording

`packages/sim/src/replay/`:

- `ReplayRecorder` — the worker feeds it every batch of commands right before
  `sim.applyCommands` (with `sim.tick`) and calls `afterStep` after every tick. Speed and
  pause changes aren't recorded: playback is tick-based.
- Recorded for Quick Game and Sandbox (including a loaded save: the save bytes are embedded as
  the replay's `base`). **Not** recorded: campaigns, the menu backdrop (`init` with
  `record: false`).
- Every `CHECKSUM_INTERVAL` (200 ticks = 10 s) a hash of the full sim state (`hashState` over
  `Sim.getState()`) is stored, to detect desyncs.
- The config is captured when the game starts: sandbox tuning commands mutate `sim.config`
  afterwards, so the end-of-game config would replay a different game.

### File format (`format.ts`)

```
"ANTR" | u16 version | u16 0 | u32 base length B | base (a sim save, B bytes) | deflate(JSON body)
```

The JSON body holds `simVersion`, the resolved `config`, `meta` (mode, optional daily date),
`startTick`/`endTick`/`winner`, `commands: {tick, command}[]`, `checksumInterval`,
`checksums: [tick, hash][]` and the final populations (for the list).

**Size:** a 30-minute game (36,000 ticks) with heavy synthetic input — a joystick direction
change every half second with 3-decimal floats, 4,252 commands — encodes to **~40 KB**. Real
play with taps is smaller. Checksums add ~10 bytes per 10 s.

`SIM_VERSION` must be bumped whenever a change alters sim behaviour for the same seed and
commands. Replays from another version open with a warning and will most likely hit the
checksum desync error.

## Playback

`ReplayPlayer` re-runs a sim from the config (or `base`), applying each command right before the
step of its tick and verifying the recorded checksums (`ReplayDesyncError` on a mismatch).
Checkpoints (compressed sim saves) are taken every 600 ticks as playback passes them; a seek
restores the nearest earlier checkpoint and fast-forwards (in 25 ms slices, so the worker stays
responsive). Tampering with or dropping a command is detected at the next checksum.

The worker is the replay viewer: `initReplay` → `ready` (with a `replay` block), then ordinary
snapshots; `replaySeek`, `replayStatus` and `replayDesync` are the extra messages. Input
commands are ignored in a viewer.

UI (`apps/web/src/replay/viewer.ts`): play/pause, 1×–16×, scrubber, Follow ant (or drag the map
for a free camera), Exit. Esc also exits. A desync shows a banner and stops playback.

## Storage, export, import

- `GameArchive` stores the replay when a game ends (game over, quit, restart, starting another
  game). Games shorter than 10 s are skipped.
- `ReplayStore` (own IndexedDB database / `replays/` directory on native, beside the save
  slots): the newest 12 are kept; replays referenced by a daily attempt are never dropped.
- Main menu → **Replays**: Watch / Export / Delete, and **Import replay file…**.
- Export uses the Web Share API with a file where available (phones), else a `.antreplay`
  download. On Capacitor builds this relies on the WebView; a native Share/Filesystem export
  (`@capacitor/share`) is deferred.

## Daily challenge

`apps/web/src/daily/`. Main menu → **Daily Challenge**.

- `dailySetup(date)` derives everything from the UTC date (`YYYY-MM-DD`): seed, difficulty,
  spider and antlion counts, rain on. The ant cap is fixed (`DAILY_MAX_ANTS`), not the device's.
- The card shows the setup. **The first attempt of a date is the one that counts**; retries are
  allowed and flagged ("not counted"). Quitting or restarting mid-game finishes that attempt as
  "gave up".
- Ranking: a victory beats everything (faster wins); otherwise longer survival, then the bigger
  colony. "Victory in 14:32 · 340 ants", "Fell after 9:10 · 120 ants".
- Results are kept locally in `localStorage` (60 days). **Share result** uses the Web Share API
  or the clipboard: `Ant Simulator Daily 2026-10-22: Victory in 14:32 with 340 ants 🐜`.
- Each attempt links to its replay (Watch best replay, or via the game-over screen).
- **Deferred:** a server leaderboard (needs a backend and anti-cheat; replays with checksums
  would be the verification input).
