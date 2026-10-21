# Audio

Sound effects and music live in `apps/web/src/audio/`. There are **no audio files**: every sound is
synthesized in code, so there is nothing to license and the bundle impact is code only
(+18.6 KB minified, +6.6 KB gzip in the main chunk; no new dependencies — plain Web Audio, no Howler).

| File          | Role                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `types.ts`    | `SfxId` list and the `AudioBackend` interface the director drives.                                                                                     |
| `synth.ts`    | jsfxr-style parametric effects (`SFX_PARAMS`) + note-sequence jingles, rendered to PCM at first unlock (~0.4 s total).                                 |
| `score.ts`    | Music data: tiny text patterns (`a4 . c5 - -`) for the menu and game tracks.                                                                           |
| `webAudio.ts` | Web Audio backend: SFX bus + music bus → master (mute) → compressor. Loops (rain, skitter), voice cap (24), look-ahead chiptune sequencer, crossfades. |
| `director.ts` | Snapshots/events → sounds. Rate limiting, spatialization, music intensity. Backend-agnostic, unit-tested with a fake backend.                          |
| `index.ts`    | Page wiring: gesture unlock, UI clicks, visibility/app-state suspend, settings → volumes, HUD mute button.                                             |

## Behaviour

- **Unlock.** The `AudioContext` is created inside the first `pointerdown`/`touchend`/`keydown`
  (needed on iOS/Android web views) and a silent buffer is played. Calls before that are remembered
  (music, loops) or dropped (one-shots).
- **Background.** On `visibilitychange` (web) and Capacitor `appStateChange` (native) the context is
  suspended, which also freezes the music clock; it resumes on return.
- **Buses.** `soundVolume` → SFX bus, `musicVolume` → music bus (squared for a perceptual curve),
  `muted` → master. `muted` is a persisted setting (HUD "Sound on/off" button, Settings → Audio).
- **Spatialization.** World cues with a position are panned (±0.8) by their offset from the screen
  centre and attenuated with distance (inaudible beyond ~3 screen half-widths). While the nest view is
  open, surface sounds are quiet and centred; dig sounds are full.
- **Music.** `menu` and `game` tracks loop; leaving one crossfades (1.5 s). The game track has an
  intensity layer (fast arpeggio + driving drums) that rises with the number of fighting ants, raids,
  intruders and hunting spiders, and decays slowly. It is off while a menu/pause overlay is open.

## Where cues come from

Most cues are **derived from snapshot deltas**, so the sim needed no changes:

| Cue                               | Derived from                                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| pickup / drop / deposit (at nest) | `player.carrying` 0↔>0                                                                               |
| recruit chirp                     | `player.recruits` increased                                                                          |
| trail on/off                      | `player.trail` changed                                                                               |
| dig (nest view only)              | player colony `openTiles` increased                                                                  |
| fight clicks                      | sum of `colonies[].fighting`; volume ~ log(count); position = centroid of ≤512 sampled fighting ants |
| death                             | sum of `colonies[].losses` increased                                                                 |
| spider hiss                       | a spider entered `Hunt` (per-spider cooldown 5 s)                                                    |
| skitter bed                       | `antCount` and camera zoom (one loop, not per ant)                                                   |
| rain bed / thunder                | `weather.raining`/`intensity`; thunder at random 9–25 s while raining                                |
| victory / defeat jingle           | `winner`                                                                                             |
| UI click                          | delegated `click` on buttons, selects, checkboxes                                                    |

Discrete sim events (`SimEvent`) go through the **`EVENT_CUES` registry** in `director.ts`
(`playerSwapped`, `playerEaten`, `spiderKilled`, `antlionKilled`, `rainWarning`, `rainStarted`,
`queenKilled`). Events with `x`/`y` are spatialized.

### Mapping campaign events later

Add an entry to `EVENT_CUES` (or call `audio.director.mapEvent('matingFlight', { sfx: 'swap' })`):

```ts
{ sfx: 'queenKilled' | (ev, ctx) => SfxId | null, gain?: number, minIntervalMs?: number }
```

New sounds: add the id to `SFX_IDS` and parameters to `SFX_PARAMS` (or `JINGLES`).

## Rate limiting

Per-cue minimum intervals (`LIMITS_MS`) plus a global token bucket (burst 10, 24/s) mean even 10 000
fighting ants cost a few voices a second; the backend also caps concurrent voices at 24.

## Debugging

`window.__antDebug.state().audio` (dev/e2e builds) reports the context state, active voices, current
track and bus gains.
