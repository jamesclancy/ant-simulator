# Ant Colony Game — Build Plan

A SimAnt-inspired colony sim that runs in the browser and on iOS/Android from one codebase.

> Working title: **Ant Simulator**. SimAnt is a reference for game feel only — no names, art, sound, or level layouts from it.

---

## 1. Game concept

You are one ant (the "player ant") in a black ant colony fighting a red colony for control of a backyard. You can act directly (move, dig, carry food, fight) or lead: lay trails others follow and recruit nearby ants. Meanwhile you steer the colony as a whole: how many workers vs. soldiers vs. breeders, and how much effort goes into foraging, digging, and nursing.

### Core loop
1. Explore the surface → find food → lay a pheromone trail home.
2. Food feeds the queen → eggs → larvae → new ants (caste depends on your ratios).
3. Dig and grow the nest underground; protect the queen.
4. Clash with the red colony over territory and food; raid their nest.
5. Send out breeders to found new colonies in nearby patches (campaign progress).

### Game modes (by priority)
| Mode | Description | Phase |
|---|---|---|
| **Quick Game** | One yard patch, beat the red colony | MVP |
| **Sandbox** | Place food, rocks, ants, and predators; tweak sim parameters | v1 |
| **Campaign** | Grid of yard patches + house; spread out until you hold most of it | v2 |

### World elements
- **Surface layer**: top-down 2D yard (grass, rocks, pebbles, food, water puddles).
- **Underground layer**: side-view cross-section of each nest, with diggable soil and chambers (queen, brood, food storage).
- **Hazards**: spider (roaming predator), antlion pit, rain (floods tunnels, washes out trails), lawnmower and footsteps.
- **Enemy colony**: same sim rules as yours, run by AI that sets its own caste and behavior ratios.

---

## 2. Tech stack (recommended)

| Concern | Choice | Why |
|---|---|---|
| Language | **TypeScript** | One language for sim, UI, and tooling |
| Rendering | **PixiJS v8** (WebGL/WebGPU) | Fast 2D sprite batching; thousands of ants on phones |
| Sim runtime | **Web Worker** + `SharedArrayBuffer` / transferable typed arrays | Keeps the main thread free for 60fps input and rendering |
| UI / menus | **Preact** (or plain DOM) over the canvas | HUD, menus, and sliders are easier in DOM than in canvas |
| Build | **Vite** | Fast dev server, simple worker bundling |
| Mobile | **Capacitor** (iOS + Android) + **PWA** | Ships the same web build into native shells; app store presence |
| Persistence | IndexedDB (web), Capacitor Preferences/Filesystem (native) | Save games + settings |
| Audio | Howler.js | Handles mobile audio unlock quirks |
| Tests | Vitest (sim unit tests), Playwright (web smoke tests) | |
| CI | GitHub Actions: lint, test, build web, sim perf benchmark | |

**Alternative considered:** Godot 4 (exports to web + mobile from one project). It's a good fit if you want an editor-driven workflow. The downsides: heavier web builds (~30MB+ wasm), slower load on mobile web, and less control over a data-oriented sim. Stick with TS + Pixi unless you already know Godot well.

---

## 3. Architecture

```
┌───────────── Main thread ─────────────┐      ┌──────── Sim Worker ────────┐
│ Input (touch/mouse/keys) ──commands──▶│─────▶│ Fixed-tick simulation      │
│ Renderer (Pixi) ◀── snapshot ─────────│◀─────│  (e.g. 20 ticks/sec)       │
│   interpolates between snapshots      │      │ ECS-lite / struct-of-arrays│
│ UI (HUD, menus, colony sliders)       │      │ Seeded RNG → deterministic │
└───────────────────────────────────────┘      └────────────────────────────┘
```

### Key principles
- **The sim is pure and has no rendering dependencies.** It runs headless in a worker, in Node for tests, and in benchmarks.
- **Deterministic**: seeded PRNG plus a fixed timestep. That gives you reproducible bugs, replays, and cheap save files (seed + command log, or a full snapshot).
- **Data-oriented**: ants live in struct-of-arrays typed buffers (`posX: Float32Array`, `state: Uint8Array`, …) rather than per-ant objects. This is what lets 5k+ ants run on a phone.
- **Commands in, snapshots out**: the main thread never mutates sim state directly.

### Simulation systems
| System | Notes |
|---|---|
| **Pheromone fields** | Per-layer grids (`Float32Array`) per type: *food trail*, *home*, *alarm*, *enemy*. Each tick: deposit → diffuse → evaporate. |
| **Ant behavior** | Small state machine per ant: `Wander`, `FollowTrail`, `CarryFood`, `Dig`, `Nurse`, `Fight`, `Flee`, `Recruited`. Steering samples pheromone gradients in 3 sensor directions (classic ant-colony steering). |
| **Spatial hash** | Uniform grid for neighbor queries (combat, recruiting, food pickup). |
| **Colony economy** | Food store → queen egg rate → brood timers → caste assignment based on player ratios. |
| **Digging / terrain** | Underground tile grid (soil / tunnel / chamber / rock). Digging converts soil to tunnel; ants carry dirt out. |
| **Combat** | Proximity based, with HP and damage per caste; soldiers are stronger, and alarm pheromone pulls in help. |
| **Predators & hazards** | Spider (simple hunt AI), antlion pit (a trap zone), rain (washes out pheromone + floods low tunnels). |
| **Enemy AI** | Same colony rules; a utility-based director adjusts its ratios based on threat and food. |
| **Layer transitions** | Nest entrances link surface ↔ underground; ants move between layers through them. |

### Performance budget (target: mid-range 2021 phone)
- 3,000 ants per colony, 2 colonies, at 20 sim ticks/sec with under 8ms per tick in the worker.
- Pheromone grid at 256×256 per layer; diffusion with a separable box blur or a reduced-rate update.
- Render at 60fps: one sprite batch for ants, a texture for the pheromone overlay (debug/"scent vision"), and culling for off-screen ants.
- If needed later: move the hot loops (diffusion, steering) to **WASM (Rust or AssemblyScript)** without changing the data layout.

---

## 4. Controls & UX

| Action | Mobile | Desktop |
|---|---|---|
| Move player ant | Tap to move / virtual joystick | Click to move / WASD |
| Pan / zoom | Drag / pinch | Right-drag or edge scroll / wheel |
| Recruit nearby ants | Recruit button (5 / 10) | `R` |
| Lay trail | Toggle while moving | Hold `Shift` |
| Switch surface ↔ nest | Layer button / tap an entrance | `Tab` |
| Colony control panel | Bottom sheet with triangle sliders | Side panel |
| Swap to another ant (when yours dies) | Automatic, with a toast | Same |

- **Triangle sliders**, as in SimAnt, for caste ratio (worker/soldier/breeder) and behavior ratio (forage/dig/nurse).
- **Scent vision overlay** toggle to show pheromone trails as colored heatmaps. Good for play and for debugging.
- Safe-area insets, a portrait + landscape layout, and at least 44pt touch targets.

---

## 5. Project structure (proposed)

```
/
├── apps/
│   ├── web/                # Vite app: renderer, UI, input, PWA manifest
│   └── mobile/             # Capacitor project (ios/, android/) wrapping apps/web build
├── packages/
│   ├── sim/                # Pure TS simulation (no DOM). Worker entry + headless API
│   │   ├── src/
│   │   │   ├── world/      # grids, terrain, layers
│   │   │   ├── ants/       # SoA storage, behaviors, steering
│   │   │   ├── pheromones/
│   │   │   ├── colony/     # economy, castes, queen, brood
│   │   │   ├── ai/         # enemy colony director, predators
│   │   │   ├── rng.ts
│   │   │   └── index.ts    # createSim(config), step(), applyCommands(), snapshot()
│   │   └── test/
│   ├── shared/             # Command/snapshot types, constants, config schema
│   └── bench/              # Headless perf benchmarks (run in CI)
├── assets/                 # Sprites (atlas), audio, fonts
├── docs/
│   └── PLAN.md
└── package.json            # pnpm workspaces
```

---

## 6. Milestones

### Phase 0 — Foundations (≈1 week)
- [x] pnpm monorepo, TS strict, ESLint/Prettier, Vitest, GitHub Actions CI
- [x] Vite web app with a Pixi canvas, camera pan/zoom (mouse + touch)
- [x] Sim worker skeleton: fixed tick, seeded RNG, command/snapshot messaging
- [x] Renderer interpolates between snapshots

### Phase 1 — Ant swarm prototype (≈2 weeks)
- [x] SoA ant storage, wander + steering
- [x] Pheromone grids (deposit/diffuse/evaporate) + scent overlay
- [x] Food sources, foraging loop (find → carry → trail → home)
- [ ] Benchmark: 5k ants at a stable tick time on desktop and on a real phone — _desktop done (`pnpm bench`, run in CI); the real-phone run is pending (user), see RELEASE.md_
- **Exit criterion:** emergent foraging trails form on their own, and the game feels alive.

### Phase 2 — Playable colony (≈3 weeks)
- [x] Player ant: direct control, carry, lay trail, recruit
- [x] Underground layer: dig, chambers, queen, brood lifecycle
- [x] Colony economy + caste/behavior sliders
- [x] Basic HUD (food, population, health), pause/speed controls

### Phase 3 — Conflict = MVP "Quick Game" (≈3 weeks)
- [x] Red colony with AI director (see [COMBAT.md](COMBAT.md))
- [x] Combat, alarm pheromone, nest raids, queen death = loss/win
- [x] Spider predator (see [PREDATORS.md](PREDATORS.md))
- [x] Save/load (versioned snapshot; IndexedDB on web, Filesystem on native; see docs/SAVE.md)
- [x] Main menu, settings, tutorial prompts
- [ ] **Release: web PWA (itch.io / own domain)** — _installable offline PWA is built and e2e-tested; picking a host and publishing is pending (user)_

### Phase 4 — Mobile ship (≈2 weeks)
- [x] Capacitor iOS + Android builds, icons, splash screen _(projects and generated placeholder art are in the repo; iOS needs a full-Xcode build and a final-art swap, see RELEASE.md)_
- [x] Touch UX polish, haptics, performance tuning on low-end Android _(adaptive perf governor is done; on-device tuning is pending a real phone)_
- [x] Battery/thermal: lower the tick rate in the background and pause on app blur _(implemented as pause + autosave on blur; the tick rate is not lowered)_
- [ ] TestFlight / Play internal testing → store submission — _pending (user): developer accounts, signing, listings; checklist in RELEASE.md_

### Phase 5 — Content & depth (ongoing)
- [x] Sandbox mode ([docs/SANDBOX.md](SANDBOX.md))
- [x] Hazards: rain/flooding, antlion, lawnmower and yard footsteps (see [docs/YARD_HAZARDS.md](YARD_HAZARDS.md))
- [x] Campaign: yard grid, breeder flights to found new colonies, house interior ([docs/CAMPAIGN.md](CAMPAIGN.md))
- [x] Audio + music, art pass, accessibility (colorblind-safe red/black alternatives) ([AUDIO.md](AUDIO.md), [ART.md](ART.md))
- [ ] Optional: replays from the command log, daily-seed challenges

---

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Mobile perf with thousands of agents | Data-oriented sim in a worker, early on-device benchmarks, WASM fallback, adaptive ant cap |
| Emergent behavior is hard to tune | Sandbox mode + live parameter panel (dev only); deterministic seeds for repro |
| iOS Safari quirks (audio unlock, `SharedArrayBuffer` needs COOP/COEP headers) | Fall back to transferable `ArrayBuffer` snapshots; test Safari in CI with Playwright WebKit |
| Scope creep (campaign, house, etc.) | Ship Quick Game first; everything else is post-MVP |
| IP concerns | Original name, art, and audio; no SimAnt trademarks or assets |

---

## 8. Open questions
- Art direction: pixel art vs. clean vector? (Affects atlas size and zoom behavior.)
- Monetization: premium, free with an unlock, or free/open source?
- Do we need multiplayer (async colony battles) at some point? If so, determinism helps a lot.
- Minimum supported devices (iPhone 11 / Android with 4GB RAM?)
