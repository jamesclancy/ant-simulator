import { Application, Container, Graphics } from 'pixi.js';
import type { Snapshot } from '@ant/shared';
import { NEST_TILE, SPEED_STEPS } from '@ant/shared';
import { AntLayer } from './antLayer';
import { Camera } from './camera';
import { ScentOverlay } from './scentOverlay';
import { WorldLayer } from './worldLayer';
import { SimClient } from './simClient';
import { pauseWhenBackgrounded } from './lifecycle';
import { mountTuningPanel } from './tuningPanel';
import { PlayerInput } from './player/input';
import { PlayerMarker } from './player/marker';
import { NestView, NEST_BACKGROUND } from './nest/nestView';
import { ColonyPanel } from './nest/colonyPanel';
import { DirtMound } from './nest/dirtMound';

const SURFACE_BACKGROUND = 0x1b2a1b;

async function main(): Promise<void> {
  const host = document.getElementById('app')!;
  const app = new Application();
  await app.init({
    resizeTo: window,
    background: 0x1b2a1b,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
  });
  host.appendChild(app.canvas);

  const world = new Container();
  app.stage.addChild(world);
  const camera = new Camera(world, host);
  // Underground side view: its own container and camera, so each view keeps its position.
  const nestView = new NestView();
  app.stage.addChild(nestView.view);
  const nestCamera = new Camera(nestView.view, host);
  nestCamera.enabled = false;
  let nestAnts: AntLayer | null = null;
  let nestFramed = false;
  let dirtMound: DirtMound | null = null;
  let colonyPanel: ColonyPanel | null = null;
  let layer: 0 | 1 = 0;
  let ants: AntLayer | null = null;
  let scent: ScentOverlay | null = null;
  let scentOn = false;
  let worldLayer: WorldLayer | null = null;
  let marker: PlayerMarker | null = null;
  let playerNow: { x: number; y: number; heading: number; carrying: boolean } | null = null;
  let stats = { tick: 0, count: 0, food: 0 };
  let latest: Snapshot | null = null;

  const frameNest = (): void => {
    const g = nestView.gridSize!;
    const r = host.getBoundingClientRect();
    const zoom = Math.min(2.5, Math.max(0.5, r.width / (30 * NEST_TILE)));
    nestCamera.focus((g.entranceX + 0.5) * NEST_TILE, 11 * NEST_TILE, zoom);
  };

  const sim = new SimClient({
    onReady(config) {
      const bg = new Graphics();
      bg.rect(0, 0, config.worldSize, config.worldSize).fill(0x2f4a2a);
      for (let i = 0; i <= config.worldSize; i += 128) {
        bg.moveTo(i, 0).lineTo(i, config.worldSize).moveTo(0, i).lineTo(config.worldSize, i);
      }
      bg.stroke({ color: 0x3d5c36, width: 1 });
      world.addChildAt(bg, 0);
      scent = new ScentOverlay(world, config.worldSize);
      scent.setVisible(scentOn);
      worldLayer = new WorldLayer(world);
      dirtMound = new DirtMound(world);
      ants = new AntLayer(app.renderer, world, { layer: 0 });
      nestAnts = new AntLayer(app.renderer, nestView.antParent, {
        layer: 1,
        scale: 0.75,
        tint: 0xd9c7a5,
      });
      marker = new PlayerMarker(world);
      colonyPanel = new ColonyPanel(document.body, (cmds) => sim.sendCommands(cmds));
      camera.focus(config.worldSize / 2, config.worldSize / 2, 1.5);
      if (new URLSearchParams(location.search).has('debug')) {
        mountTuningPanel(sim, config.behavior);
      }
    },
    onSnapshot(snapshot, speed) {
      worldLayer?.update(snapshot);
      dirtMound?.update(snapshot);
      ants?.push(snapshot, speed);
      const pl = snapshot.player;
      playerNow = pl && { x: pl.x, y: pl.y, heading: pl.heading, carrying: pl.carrying > 0 };
      playerInput.onSnapshot(pl, snapshot.events);
      nestAnts?.push(snapshot, speed);
      nestView.update(snapshot.nestGrid, snapshot.colony);
      if (!nestFramed && nestView.gridSize) {
        nestFramed = true;
        frameNest();
      }
      latest = snapshot;
      if (snapshot.pheromones) scent?.update(snapshot.pheromones);
      stats = { tick: snapshot.tick, count: snapshot.antCount, food: snapshot.colonyFood };
    },
  });
  sim.init();

  const toWorld = (cx: number, cy: number): { x: number; y: number } => {
    const r = host.getBoundingClientRect();
    return world.toLocal({ x: cx - r.left, y: cy - r.top });
  };
  let placing = false;
  const playerInput = new PlayerInput({
    host,
    send: (commands) => sim.sendCommands(commands),
    toWorld,
    // Taps only steer the player on the surface view, and not while placing food.
    toolActive: () => placing || layer !== 0,
    onTarget: (x, y) => marker?.showTarget(x, y),
  });

  app.ticker.add(() => {
    if (layer !== 0) {
      nestAnts?.update();
      return;
    }
    ants?.update();
    const pos = ants?.playerPos.valid ? ants.playerPos : null;
    marker?.update(pos, playerNow?.heading ?? 0, playerNow?.carrying ?? false, camera.zoom);
    if (pos && playerInput.follow) camera.centerOn(pos.x, pos.y);
  });

  // Layer switch: HUD button, Tab, or tapping the nest entrance on the surface.
  const layerBtn = document.getElementById('layer')!;
  const setLayer = (next: 0 | 1): void => {
    layer = next;
    document.body.classList.toggle('in-nest', next === 1);
    world.visible = next === 0;
    nestView.view.visible = next === 1;
    camera.enabled = next === 0;
    nestCamera.enabled = next === 1;
    app.renderer.background.color = next === 0 ? SURFACE_BACKGROUND : NEST_BACKGROUND;
    layerBtn.textContent = next === 0 ? 'Nest' : 'Surface';
    layerBtn.setAttribute('aria-label', next === 0 ? 'Show nest' : 'Show surface');
    if (next === 1) {
      placing = false;
      foodTool.setAttribute('aria-pressed', 'false');
    }
    foodTool.hidden = next === 1;
    scentBtn.hidden = next === 1;
  };
  layerBtn.addEventListener('click', () => setLayer(layer === 0 ? 1 : 0));
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    setLayer(layer === 0 ? 1 : 0);
  });

  // HUD
  const pause = document.getElementById('pause')!;
  const scentBtn = document.getElementById('scent')!;
  scentBtn.addEventListener('click', () => {
    scentOn = !scentOn;
    scentBtn.setAttribute('aria-pressed', String(scentOn));
    scent?.setVisible(scentOn);
    sim.setScentVision(scentOn);
  });
  const speeds = document.getElementById('speeds')!;
  const statsEl = document.getElementById('stats')!;
  let paused = false;
  let speed = 1;
  pause.addEventListener('click', () => {
    paused = !paused;
    pause.textContent = paused ? 'Resume' : 'Pause';
    sim.setPaused(paused);
  });
  pauseWhenBackgrounded(
    (p) => sim.setPaused(p),
    () => paused,
  );
  const speedButtons = SPEED_STEPS.map((s) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `${s}x`;
    b.addEventListener('click', () => {
      speed = s;
      sim.setSpeed(s);
      refresh();
    });
    speeds.appendChild(b);
    return { s, b };
  });
  const refresh = (): void => {
    for (const { s, b } of speedButtons) b.setAttribute('aria-pressed', String(s === speed));
  };
  refresh();
  // Place-food tool: when on, a tap/click (not a drag) places a pile at that world point.
  const foodTool = document.getElementById('place-food')!;
  foodTool.addEventListener('click', () => {
    placing = !placing;
    foodTool.setAttribute('aria-pressed', String(placing));
  });
  let down: { x: number; y: number } | null = null;
  host.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY };
  });
  host.addEventListener('pointerup', (e) => {
    const d = down;
    down = null;
    if (!d || layer !== 0 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
    const p = toWorld(e.clientX, e.clientY);
    if (!placing) {
      const nest = latest?.nest;
      if (nest && Math.hypot(p.x - nest.x, p.y - nest.y) <= nest.radius * 1.6) setLayer(1);
      return;
    }
    sim.sendCommands([{ type: 'placeFood', x: p.x, y: p.y, amount: 200 }]);
  });

  setInterval(() => {
    statsEl.textContent = `${stats.count} ants · food ${Math.floor(stats.food)} · tick ${stats.tick}`;
    if (latest) colonyPanel?.update(latest);
  }, 250);
}

void main();
