# Ant Simulator

A SimAnt-inspired ant colony game for web and (later) iOS/Android from one TypeScript codebase.
See [docs/PLAN.md](docs/PLAN.md) for the architecture and milestones.

## Layout

- `packages/shared` – command/snapshot types, sim config, constants
- `packages/sim` – pure, deterministic TS simulation (no DOM) plus the Web Worker entry
- `packages/bench` – headless sim benchmark
- `apps/web` – Vite + PixiJS v8 renderer, input, HUD

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

## Deploying (Vercel)

`vercel.json` at the repo root configures the build (`pnpm build` → `apps/web/dist`) and sends
COOP/COEP headers so the page is cross-origin isolated (needed for `SharedArrayBuffer`).

- **Git integration:** import the repo at [vercel.com/new](https://vercel.com/new) and leave the
  Root Directory as the repo root. Pushes to `main` deploy to production; PRs get preview URLs.
- **CLI:** `npx vercel` for a preview deploy, `npx vercel --prod` for production.

## Controls

Mouse: wheel to zoom, drag to pan. Touch: drag to pan, pinch to zoom.
HUD: pause/resume and 0.5x–4x speed.
