import { Application, Container, Graphics } from 'pixi.js';
import { SPEED_STEPS } from '@ant/shared';
import { AntLayer } from './antLayer';
import { Camera } from './camera';
import { ScentOverlay } from './scentOverlay';
import { SimClient } from './simClient';

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
  let stats = { tick: 0, count: 0 };

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
      ants = new AntLayer(app.renderer, world);
      camera.focus(config.worldSize / 2, config.worldSize / 2, 1.5);
    },
    onSnapshot(snapshot, speed) {
      ants?.push(snapshot, speed);
      if (snapshot.pheromones) scent?.update(snapshot.pheromones);
      stats = { tick: snapshot.tick, count: snapshot.antCount };
    },
  });
  sim.init();

  app.ticker.add(() => ants?.update());

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
  setInterval(() => {
    statsEl.textContent = `${stats.count} ants · tick ${stats.tick}`;
  }, 250);
}

void main();
