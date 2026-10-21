# Ant Simulator

A SimAnt-inspired ant colony game for web and (later) iOS/Android from one TypeScript codebase.
See [docs/PLAN.md](docs/PLAN.md) for the architecture and milestones.

## Layout

- `packages/shared` – command/snapshot types, sim config, constants
- `packages/sim` – pure, deterministic TS simulation (no DOM) plus the Web Worker entry
- `packages/bench` – headless sim benchmark
- `apps/web` – Vite + PixiJS v8 renderer, input, HUD
- `apps/mobile` – Capacitor iOS/Android shell wrapping the `apps/web` build

## Setup

Requires Node 20+ and [pnpm](https://pnpm.io) 10 (`corepack enable` picks up the pinned version).

```bash
pnpm install
```

## Commands

| Command          | What it does                                           |
| ---------------- | ------------------------------------------------------ |
| `pnpm dev`       | Start the web app with hot reload                      |
| `pnpm build`     | Typecheck and build the web app to `apps/web/dist`     |
| `pnpm test`      | Run Vitest unit tests (determinism, stepping)          |
| `pnpm lint`      | ESLint + Prettier check (`pnpm format` fixes)          |
| `pnpm typecheck` | `tsc` in every package                                 |
| `pnpm bench`     | Headless benchmark; optional args: `-- <ants> <ticks>` |

## Mobile (Capacitor)

`apps/mobile` wraps the `apps/web` build in native iOS and Android apps (app id
`com.jamesclancy.antsimulator`, set in `apps/mobile/capacitor.config.ts`). The sim runs in a Web
Worker loaded from the bundled files; nothing relies on `SharedArrayBuffer` or COOP/COEP.

Prerequisites:

- **iOS:** macOS with full Xcode (not just Command Line Tools); run `sudo xcode-select -s /Applications/Xcode.app`. Capacitor 8 uses Swift Package Manager, so CocoaPods is not required.
- **Android:** Android Studio (SDK + platform tools) and JDK 21; set `ANDROID_HOME`.

| Command               | What it does                                                     |
| --------------------- | ---------------------------------------------------------------- |
| `pnpm mobile:sync`    | Build the web app and copy it into both native projects          |
| `pnpm mobile:ios`     | Sync, then open the project in Xcode (run on a simulator/device) |
| `pnpm mobile:android` | Sync, then open the project in Android Studio                    |

Re-run `pnpm mobile:sync` after any web change. The sim pauses automatically when the app is
backgrounded.

## Deploying (Vercel)

`vercel.json` at the repo root configures the build (`pnpm build` → `apps/web/dist`) and sends
COOP/COEP headers so the page is cross-origin isolated (needed for `SharedArrayBuffer`).

- **Git integration:** import the repo at [vercel.com/new](https://vercel.com/new) and leave the
  Root Directory as the repo root. Pushes to `main` deploy to production; PRs get preview URLs.
- **CLI:** `npx vercel` for a preview deploy, `npx vercel --prod` for production.

## Controls

Mouse: wheel to zoom, drag to pan. Touch: drag to pan, pinch to zoom.
HUD: pause/resume and 0.5x–4x speed, black/red populations. Nest (or Tab, or tap an entrance)
switches to the underground view; once your ants have found the red nest you can view it too.
The Colony panel sets jobs, the caste mix of new ants, and whether soldiers raid the red nest.
Kill the red queen to win; lose yours and it's over.

The game opens on a main menu (New Game, Settings, How to Play); the first game runs a skippable
tutorial, and Esc / the Pause button opens the pause menu.

URL options: `?play` (skip the menu), `?difficulty=easy|normal|hard`, `?seed=N` (with `?play`), `?debug` (tuning panel, spawn-soldier
buttons, enemy nest always viewable).
