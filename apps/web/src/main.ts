import { Application, Container, Graphics } from 'pixi.js';
import { SPEED_STEPS } from '@ant/shared';
import { AntLayer } from './antLayer';
import { Camera } from './camera';
import { ScentOverlay } from './scentOverlay';
import { WorldLayer } from './worldLayer';
import { SimClient } from './simClient';
import { pauseWhenBackgrounded } from './lifecycle';
import { mountTuningPanel } from './tuningPanel';
import { PlayerInput } from './player/input';
import { PlayerMarker } from './player/marker';

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
  let ants: AntLayer | null = null;
  let scent: ScentOverlay | null = null;
  let scentOn = false;
  let worldLayer: WorldLayer | null = null;
  let marker: PlayerMarker | null = null;
  let playerNow: { x: number; y: number; heading: number; carrying: boolean } | null = null;
  let stats = { tick: 0, count: 0, food: 0 };

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
      ants = new AntLayer(app.renderer, world);
      marker = new PlayerMarker(world);
      camera.focus(config.worldSize / 2, config.worldSize / 2, 1.5);
      if (new URLSearchParams(location.search).has('debug')) {
        mountTuningPanel(sim, config.behavior);
      }
    },
    onSnapshot(snapshot, speed) {
      worldLayer?.update(snapshot);
      ants?.push(snapshot, speed);
      const pl = snapshot.player;
      playerNow = pl && { x: pl.x, y: pl.y, heading: pl.heading, carrying: pl.carrying > 0 };
      playerInput.onSnapshot(pl, snapshot.events);
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
    toolActive: () => placing,
    onTarget: (x, y) => marker?.showTarget(x, y),
  });

  app.ticker.add(() => {
    ants?.update();
    const pos = ants?.playerPos.valid ? ants.playerPos : null;
    marker?.update(pos, playerNow?.heading ?? 0, playerNow?.carrying ?? false, camera.zoom);
    if (pos && playerInput.follow) camera.centerOn(pos.x, pos.y);
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
    if (!placing || !d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
    const p = toWorld(e.clientX, e.clientY);
    sim.sendCommands([{ type: 'placeFood', x: p.x, y: p.y, amount: 200 }]);
  });

  setInterval(() => {
    statsEl.textContent = `${stats.count} ants · food ${Math.floor(stats.food)} · tick ${stats.tick}`;
  }, 250);
}

void main();
