import { Application, Container } from 'pixi.js';
import type { Difficulty, SimConfig, Snapshot } from '@ant/shared';
import {
  ANT_FLAGS_OFFSET,
  ANT_STRIDE,
  Caste,
  NEST_TILE,
  PLAYER_COLONY,
  RED_COLONY,
  SANDBOX_SPEED_STEPS,
  flagFighting,
} from '@ant/shared';
import { AntLayer } from './antLayer';
import { Art } from './art';
import { bindPaletteCss } from './art/applyPalette';
import { GroundLayer } from './art/ground';
import { SURFACE_PX } from './art/sprites/world';
import { Camera } from './camera';
import { ScentOverlay } from './scentOverlay';
import { WorldLayer } from './worldLayer';
import { SimClient } from './simClient';
import { pauseWhenBackgrounded } from './lifecycle';
import { bindSaves, hasSave, loadLatest, type SaveSlot } from './save';
import { mountSaveMenu } from './save/saveMenu';
import { mountTuningPanel } from './tuningPanel';
import { PlayerInput } from './player/input';
import { PlayerMarker } from './player/marker';
import { NestView, NEST_BACKGROUND } from './nest/nestView';
import { ColonyPanel } from './nest/colonyPanel';
import { DirtMound } from './nest/dirtMound';
import { SpiderLayer } from './predators/spiderLayer';
import { AntlionLayer } from './hazards/antlionLayer';
import { WeatherLayer } from './hazards/weatherLayer';
import { App } from '@capacitor/app';
import { haptics } from './platform/haptics';
import { BATTERY_SAVER_FPS, PerfGovernor } from './platform/perfGovernor';
import { initNativeShell } from './platform/nativeShell';
import { PROFILES, type DeviceTier, type PerfProfile } from './platform/deviceTier';
import { Menu, type NewCampaignOptions, type NewGameOptions } from './ui/menu';
import type { SandboxOptions } from './sandbox/config';
import { SandboxUi } from './sandbox/sandboxUi';
import { sandboxConfig } from './sandbox/config';
import { ObstacleLayer } from './sandbox/obstacleLayer';
import { SettingsStore } from './ui/settings';
import { bindDocumentSettings, createFpsMeter } from './ui/applySettings';
import { TutorialPanel } from './ui/tutorialPanel';
import { registerServiceWorker } from './pwa';
// Last, so the retro theme overrides every panel's own stylesheet.
import './ui/theme.css';
import { bindMuteButton, createAudio, type DirectorContext } from './audio';
import { CampaignUi, latestCampaignSlot } from './campaign';

const SURFACE_BACKGROUND = 0x4d7a35;
/** Game ticks (20 per second) between autosaves: 60 s of game time. */
const AUTOSAVE_TICKS = 60 * 20;
const COLONY_NAMES = ['black', 'red'];

const params = new URLSearchParams(location.search);
const debug = params.has('debug');
const difficulty: Difficulty = (['easy', 'normal', 'hard'] as const).includes(
  params.get('difficulty') as Difficulty,
)
  ? (params.get('difficulty') as Difficulty)
  : 'normal';
const randomSeed = (): number => (Math.random() * 0x7fffffff) | 0;

/** Display objects that belong to one sim session (rebuilt on every new game). */
interface Scene {
  ground: GroundLayer;
  scent: ScentOverlay;
  worldLayer: WorldLayer;
  rocks: ObstacleLayer;
  mounds: DirtMound[];
  ants: AntLayer;
  spiders: SpiderLayer;
  antlions: AntlionLayer;
  marker: PlayerMarker;
  nests: { view: NestView; ants: AntLayer; framed: boolean }[];
  focused: boolean;
  over: boolean;
  queenCause: Map<number, string>;
}

async function main(): Promise<void> {
  const host = document.getElementById('app')!;
  // Android long-press would otherwise raise the context menu / text-selection handles.
  window.addEventListener('contextmenu', (e) => e.preventDefault());
  initNativeShell();
  // ?tier=low|mid|high forces a device tier (testing); otherwise it is detected from the hardware.
  const forcedTier = params.get('tier');
  const dpr = window.devicePixelRatio || 1;
  let profile: PerfProfile = (['low', 'mid', 'high'] as const).includes(forcedTier as DeviceTier)
    ? PROFILES[forcedTier as DeviceTier]
    : new PerfGovernor(() => {}).profile;
  const app = new Application();
  await app.init({
    resizeTo: window,
    background: SURFACE_BACKGROUND,
    antialias: profile.antialias,
    autoDensity: true,
    resolution: Math.min(dpr, profile.maxResolution),
  });
  const governor = new PerfGovernor((p) => {
    profile = p;
    applyProfile();
  }, profile.tier);
  governor.locked = forcedTier !== null && forcedTier in PROFILES;
  host.appendChild(app.canvas);

  const world = new Container();
  app.stage.addChild(world);
  const camera = new Camera(world, host);
  // Underground side views (one per colony) share a container and camera, so the view
  // keeps its position when switching between them.
  const nestRoot = new Container();
  nestRoot.visible = false;
  app.stage.addChild(nestRoot);
  const nestCamera = new Camera(nestRoot, host);
  nestCamera.enabled = false;
  const settings = new SettingsStore();
  await settings.load();
  bindDocumentSettings(settings);
  const art = new Art(settings.value.palette);
  bindPaletteCss(art);
  const weather = new WeatherLayer(app.stage, app.screen, art);
  camera.pixelRatio = app.renderer.resolution;
  nestCamera.pixelRatio = app.renderer.resolution;
  const fps = createFpsMeter();
  haptics.enabled = settings.value.haptics;
  const audio = createAudio(settings);
  bindMuteButton(document.getElementById('mute')!, settings);
  /** `menu`: ambient backdrop behind the main menu; `playing`: a real game (maybe paused). */
  let mode: 'menu' | 'playing' = 'menu';
  let backdropFrozen = false;
  let rockCount = 0;
  let pendingTutorial = false;
  let lastConfig: {
    seed: number;
    difficulty: Difficulty;
    sandbox?: SandboxOptions;
    campaign?: boolean;
  } = {
    seed: 0,
    difficulty,
  };
  const touch = matchMedia('(pointer: coarse)').matches;
  document.body.classList.add('in-menu');
  let game: Scene | null = null;
  let colonyPanel: ColonyPanel | null = null;
  let tuningMounted = false;
  let layer: 0 | 1 = 0;
  /** Which colony's nest the underground view shows. */
  let viewNest = PLAYER_COLONY;
  let scentOn = false;
  let backdropTime = 0;
  let playerNow: { x: number; y: number; heading: number; carrying: boolean } | null = null;
  let latest: Snapshot | null = null;
  const applyProfile = (): void => {
    app.renderer.resolution = Math.min(dpr, profile.maxResolution);
    if (game) game.scent.minIntervalMs = profile.scentIntervalMs;
  };
  // Player ant under attack: at most one warning buzz every 2 s.
  let lastHurt = -Infinity;
  const buzzIfAttacked = (s: Snapshot): void => {
    const pl = s.player;
    if (!pl || !s.antCount || pl.index >= s.antCount) return;
    if (!flagFighting(s.ants[pl.index * ANT_STRIDE + ANT_FLAGS_OFFSET]!)) return;
    const t = performance.now();
    if (t - lastHurt < 2000) return;
    lastHurt = t;
    haptics.warning();
  };

  const frameNest = (view: NestView): void => {
    const g = view.gridSize!;
    const r = host.getBoundingClientRect();
    const zoom = Math.min(2.5, Math.max(0.5, r.width / (30 * NEST_TILE)));
    nestCamera.focus((g.entranceX + 0.5) * NEST_TILE, 11 * NEST_TILE, zoom);
  };

  const buildScene = (config: SimConfig): Scene => {
    for (const child of world.removeChildren()) child.destroy({ children: true });
    for (const child of nestRoot.removeChildren()) child.destroy({ children: true });
    const ground = new GroundLayer(art, config.worldSize, config.seed, []);
    world.addChild(ground.view);
    const scent = new ScentOverlay(world, config.worldSize, art);
    scent.setVisible(scentOn);
    scent.minIntervalMs = profile.scentIntervalMs;
    const worldLayer = new WorldLayer(world, art);
    const rocks = new ObstacleLayer(world, art);
    const mounds: DirtMound[] = [];
    for (let c = 0; c < config.colonies; c++) mounds.push(new DirtMound(world, c, art));
    const ants = new AntLayer(art, world, { layer: 0 });
    const spiders = new SpiderLayer(world, art);
    // Pits are ground texture: just above the grass, below everything that walks on it.
    const antlions = new AntlionLayer(world, art);
    world.addChildAt(antlions.view, 1);
    antlions.setReduceMotion(settings.value.reduceMotion);
    const nests = [];
    for (let c = 0; c < config.colonies; c++) {
      const view = new NestView(c, art);
      nestRoot.addChild(view.view);
      const nestAnts = new AntLayer(art, view.antParent, {
        layer: 1 + c,
        scale: 1,
        set: 'nest',
      });
      nests.push({ view, ants: nestAnts, framed: false });
    }
    const marker = new PlayerMarker(world, art);
    return {
      ground,
      scent,
      worldLayer,
      rocks,
      mounds,
      ants,
      spiders,
      antlions,
      marker,
      nests,
      focused: false,
      over: false,
      queenCause: new Map(),
    };
  };

  let renderedFrames = 0;
  // ?debug: perf probe for device-throttling runs (see docs/PERF.md).
  if (debug) {
    Object.assign(window, {
      __antPerf: () => ({
        fps: governor.fps,
        simMs: governor.simMs,
        tier: profile.tier,
        ants: latest?.antCount ?? 0,
        zoom: camera.zoom,
        frames: renderedFrames,
      }),
      __antAtlas: () => art.atlas.canvas.toDataURL(),
      __antSpawn: (n: number) => {
        for (const c of latest?.colonies ?? []) {
          sim.sendCommands([
            { type: 'spawnAnts', count: n, x: c.nest.x, y: c.nest.y, colony: c.id },
          ]);
        }
      },
      __antZoom: (z: number) =>
        camera.focus(latest?.colonies[0]?.nest.x ?? 0, latest?.colonies[0]?.nest.y ?? 0, z),
    });
  }
  const sim = new SimClient({
    onReady(config, tuning, campaignInfo) {
      game = buildScene(config);
      campaign.attach(world, config, campaignInfo);
      rockCount = 0;
      sandbox.attachScene();
      sandbox.setGame(config, tuning);
      syncSandboxHud(config);
      // A new or loaded game: the autosave clock restarts at its first snapshot.
      latest = null;
      lastAutosaveTick = -1;
      hideGameOver();
      backdropFrozen = false;
      if (pendingTutorial) {
        pendingTutorial = false;
        tutorial.start();
      }
      viewNest = PLAYER_COLONY;
      setLayer(0);
      if (!colonyPanel) {
        colonyPanel = new ColonyPanel(document.body, (cmds) => sim.sendCommands(cmds));
      }
      colonyPanel.reset();
      camera.focus(config.worldSize / 2, config.worldSize / 2, 1);
      if (debug && !tuningMounted) {
        tuningMounted = true;
        mountWarControls(mountTuningPanel(sim, config.behavior));
      }
    },
    onSnapshot(snapshot, speed, simMs) {
      const g = game;
      if (!g) return;
      if (simMs !== undefined) governor.reportSim(simMs);
      if (mode === 'playing') buzzIfAttacked(snapshot);
      g.worldLayer.update(snapshot);
      campaign.onSnapshot(snapshot);
      if (snapshot.obstacles) {
        g.rocks.update(snapshot.obstacles);
        rockCount = snapshot.obstacles.length;
      }
      sandbox.onSnapshot(snapshot);
      for (const m of g.mounds) m.update(snapshot);
      g.ants.push(snapshot, speed);
      g.spiders.update(snapshot);
      g.antlions.update(snapshot);
      weather.update(snapshot);
      const pl = snapshot.player;
      playerNow = pl && { x: pl.x, y: pl.y, heading: pl.heading, carrying: pl.carrying > 0 };
      playerInput.onSnapshot(pl, snapshot.events);
      if (mode === 'menu' && settings.value.reduceMotion && g.focused && !backdropFrozen) {
        // Static backdrop: stop the ambient sim once it has drawn a frame.
        backdropFrozen = true;
        sim.setPaused(true);
      }
      if (mode === 'playing' && tutorial.active) observeTutorial(snapshot);
      g.nests.forEach((n, c) => {
        const colony = snapshot.colonies[c];
        if (!colony) return;
        n.ants.push(snapshot, speed);
        n.view.setWater(snapshot.waterGrids?.find((w) => w.colony === c));
        n.view.update(
          snapshot.nestGrids?.find((grid) => grid.colony === c),
          colony,
        );
        if (!n.framed && n.view.gridSize && c === viewNest) {
          n.framed = true;
          frameNest(n.view);
        }
      });
      if (!g.focused) {
        g.focused = true;
        const home = snapshot.colonies[PLAYER_COLONY]!.nest;
        camera.focus(home.x, home.y, 1);
      }
      latest = snapshot;
      audio.director.onSnapshot(snapshot, audioContext());
      if (snapshot.pheromones) g.scent.update(snapshot.pheromones);
      for (const ev of snapshot.events) {
        if (ev.type === 'playerEaten') {
          playerInput.toast(
            ev.cause === 'antlion'
              ? 'An antlion got your ant!'
              : ev.cause === 'drowned'
                ? 'Your ant drowned in the flood!'
                : 'A spider ate your ant!',
          );
          haptics.warning();
        }
        if (ev.type === 'rainWarning') playerInput.toast('Dark clouds gather — rain is coming!');
        if (ev.type === 'rainStarted')
          playerInput.toast('Rain! Trails wash out and shallow tunnels flood');
        if (ev.type === 'rainEnded')
          playerInput.toast('The rain has stopped — the water drains away');
        if (ev.type === 'antlionKilled')
          playerInput.toast('The antlion is dead — its pit is harmless!');
        if (ev.type === 'spiderKilled') playerInput.toast('The spider is dead — it left a feast!');
        if (ev.type === 'queenKilled') {
          g.queenCause.set(ev.colony, ev.cause);
          if (ev.colony === PLAYER_COLONY && mode === 'playing') haptics.heavy();
          if (ev.colony !== PLAYER_COLONY && snapshot.winner === -1) {
            playerInput.toast(`The ${COLONY_NAMES[ev.colony] ?? 'enemy'} queen is dead!`);
          }
        }
      }
      if (snapshot.winner !== -1 && !g.over) {
        g.over = true;
        tutorial.stop(true);
        showGameOver(snapshot, g);
      }
      warnIntruders(snapshot);
    },
  });
  const audioContext = (): DirectorContext => {
    const r = host.getBoundingClientRect();
    const c = toWorld(r.left + r.width / 2, r.top + r.height / 2);
    return {
      mode,
      layer,
      paused: paused || menu.isOpen,
      zoom: camera.zoom,
      view: { x: c.x, y: c.y, halfWidth: r.width / 2 / camera.zoom },
    };
  };
  const toWorld = (cx: number, cy: number): { x: number; y: number } => {
    const r = host.getBoundingClientRect();
    return world.toLocal({ x: cx - r.left, y: cy - r.top });
  };
  let placing = false;
  const sandbox = new SandboxUi({
    host,
    world,
    camera,
    send: (commands) => sim.sendCommands(commands),
    toWorld,
    layer: () => layer,
    toast: (text) => playerInput.toast(text),
  });
  const playerInput = new PlayerInput({
    host,
    send: (commands) => sim.sendCommands(commands),
    toWorld,
    // Taps only steer the player on the surface view, and not while placing food or painting.
    toolActive: () => placing || sandbox.toolMode || layer !== 0,
    onTarget: (x, y) => game?.marker.showTarget(x, y),
    keysEnabled: () => mode === 'playing' && !menu.isOpen,
    // Debug only: long-press the ground to drop a food pile (the sandbox tool arrives later).
    ...(debug
      ? {
          onLongPress: (cx: number, cy: number) => {
            if (layer !== 0 || mode !== 'playing' || menu.isOpen) return;
            const p = toWorld(cx, cy);
            sim.sendCommands([{ type: 'placeFood', x: p.x, y: p.y, amount: 200 }]);
            haptics.light();
            playerInput.toast('Food placed');
          },
        }
      : {}),
  });

  app.ticker.add(() => {
    renderedFrames++;
    fps.tick(app.ticker.FPS, governor.simMs);
    governor.frame(performance.now(), document.hidden || mode === 'menu');
    weather.setReduceMotion(settings.value.reduceMotion);
    weather.tick(app.ticker.deltaMS);
    const g = game;
    if (!g) return;
    const reduce = settings.value.reduceMotion;
    const now = performance.now();
    g.ground.setWetness(weather.intensity);
    g.ants.setAnimation(now, !reduce);
    g.marker.setReduceMotion(reduce);
    g.spiders.setReduceMotion(reduce);
    for (const n of g.nests) {
      n.ants.setAnimation(now, !reduce);
      n.view.setReduceMotion(reduce);
      n.view.tick(now);
    }
    camera.snapToPixels();
    nestCamera.snapToPixels();
    if (mode === 'menu') {
      // Slow drift around the home nest behind the menu.
      const nest = latest?.colonies[PLAYER_COLONY]?.nest;
      if (nest && !settings.value.reduceMotion) {
        backdropTime += app.ticker.deltaMS / 1000;
        const a = backdropTime * 0.06;
        camera.centerOn(nest.x + Math.cos(a) * 140, nest.y + Math.sin(a * 1.3) * 90);
      }
    }
    if (layer !== 0) {
      g.nests[viewNest]?.ants.update();
      return;
    }
    g.ants.setStride(camera.zoom < profile.lodZoom ? profile.lodStride : 1);
    g.ants.update();
    g.spiders.tick(app.ticker.deltaMS);
    g.antlions.tick(app.ticker.deltaMS);
    const pos = g.ants.playerPos.valid ? g.ants.playerPos : null;
    g.marker.update(pos, playerNow?.heading ?? 0, playerNow?.carrying ?? false, camera.zoom);
    if (pos && playerInput.follow && mode === 'playing') camera.centerOn(pos.x, pos.y);
  });

  // Layer switch: HUD button, Tab, or tapping a nest entrance on the surface.
  const layerBtn = document.getElementById('layer')!;
  const nestSwitch = document.getElementById('nest-switch')!;
  /** The red nest can be viewed once black ants have found it (always with ?debug). */
  const enemyNestKnown = (): boolean => debug || (latest?.colonies[RED_COLONY]?.scouted ?? false);
  const showNest = (c: number): void => {
    viewNest = c;
    game?.nests.forEach((n, k) => {
      n.view.view.visible = k === c;
      if (k === c && n.view.gridSize) frameNest(n.view);
    });
    nestSwitch.textContent = c === PLAYER_COLONY ? 'Red nest' : 'Our nest';
  };
  const setLayer = (next: 0 | 1): void => {
    layer = next;
    document.body.classList.toggle('in-nest', next === 1);
    world.visible = next === 0;
    nestRoot.visible = next === 1;
    if (next === 1) showNest(viewNest);
    camera.enabled = next === 0;
    nestCamera.enabled = next === 1;
    weather.setVisible(next === 0);
    app.renderer.background.color = next === 0 ? SURFACE_BACKGROUND : NEST_BACKGROUND;
    layerBtn.textContent = next === 0 ? 'Nest' : 'Surface';
    layerBtn.setAttribute('aria-label', next === 0 ? 'Show nest' : 'Show surface');
    if (next === 1) {
      placing = false;
      foodTool.setAttribute('aria-pressed', 'false');
    }
    foodTool.hidden = next === 1 || sandbox.isActive;
    scentBtn.hidden = next === 1;
    nestSwitch.hidden = next === 0 || !enemyNestKnown();
  };
  layerBtn.addEventListener('click', () => setLayer(layer === 0 ? 1 : 0));
  nestSwitch.addEventListener('click', () =>
    showNest(viewNest === PLAYER_COLONY ? RED_COLONY : PLAYER_COLONY),
  );
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (mode !== 'playing' || menu.isOpen) return;
    e.preventDefault();
    setLayer(layer === 0 ? 1 : 0);
  });

  // HUD
  const pause = document.getElementById('pause')!;
  const scentBtn = document.getElementById('scent')!;
  const setScent = (on: boolean): void => {
    scentOn = on;
    scentBtn.setAttribute('aria-pressed', String(on));
    game?.scent.setVisible(on);
    sim.setScentVision(on);
  };
  scentBtn.addEventListener('click', () => setScent(!scentOn));
  const speeds = document.getElementById('speeds')!;
  const statsEl = document.getElementById('stats')!;
  const popBlack = document.getElementById('pop-black')!;
  const popRed = document.getElementById('pop-red')!;
  let paused = false;
  let speed = 1;
  const setPausedUi = (p: boolean): void => {
    paused = p;
  };
  pause.addEventListener('click', () => openPause());
  // Saves: autosave slot every AUTOSAVE_TICKS of game time and when the app is backgrounded.
  const saves = bindSaves(sim);
  const saveMenu = mountSaveMenu({
    controller: saves,
    button: document.getElementById('saves')!,
    notify: (msg) => playerInput.toast(msg),
    onLoaded: () => {
      setPausedUi(false);
    },
  });
  let lastAutosaveTick = -1;
  let autosaving = false;
  const autosave = (): void => {
    const s = latest;
    // A finished game isn't worth keeping over a playable one.
    if (!s || mode !== 'playing' || s.winner !== -1 || autosaving) return;
    autosaving = true;
    lastAutosaveTick = s.tick;
    saves
      .save('auto')
      .then(() => saveMenu.refresh())
      .catch(() => {})
      .finally(() => {
        autosaving = false;
      });
  };
  pauseWhenBackgrounded(
    (p) => sim.setPaused(p),
    () => paused,
    autosave,
  );
  const speedButtons = SANDBOX_SPEED_STEPS.map((s) => {
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
  /** Sandbox-only HUD changes: the 8x speed step, and the toolbar replaces Place food. */
  function syncSandboxHud(config: SimConfig): void {
    for (const { s, b } of speedButtons) b.hidden = s > 4 && !config.sandbox;
    if (!config.sandbox && speed > 4) {
      speed = 4;
      sim.setSpeed(speed);
      refresh();
    }
    foodTool.hidden = layer === 1 || config.sandbox;
    if (config.sandbox) {
      placing = false;
      foodTool.setAttribute('aria-pressed', 'false');
    }
  }
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
    if (!d || layer !== 0 || sandbox.toolMode) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
    const p = toWorld(e.clientX, e.clientY);
    if (!placing) {
      // Tapping an entrance opens that nest (the red one only once it has been found).
      for (const c of latest?.colonies ?? []) {
        const n = c.nest;
        if (Math.hypot(p.x - n.x, p.y - n.y) > n.radius * 1.6) continue;
        if (c.id !== PLAYER_COLONY && !enemyNestKnown()) continue;
        viewNest = c.id;
        setLayer(1);
        return;
      }
      return;
    }
    sim.sendCommands([{ type: 'placeFood', x: p.x, y: p.y, amount: 200 }]);
  });

  // Nest raid warning, at most every 10 s.
  let lastWarn = -Infinity;
  const warnIntruders = (s: Snapshot): void => {
    const intruders = s.colonies[PLAYER_COLONY]?.intruders ?? 0;
    if (intruders === 0 || performance.now() - lastWarn < 10_000) return;
    lastWarn = performance.now();
    playerInput.toast(`Red ants are raiding your nest! (${intruders})`);
  };

  // Game over modal; "Play again" starts a fresh game with a new seed.
  const modal = document.getElementById('gameover')!;
  const title = document.getElementById('gameover-title')!;
  const text = document.getElementById('gameover-text')!;
  const again = document.getElementById('play-again')!;
  const showGameOver = (s: Snapshot, g: Scene): void => {
    const won = s.winner === PLAYER_COLONY;
    const minutes = Math.round(s.tick / 20 / 60);
    const lostColony = won ? RED_COLONY : PLAYER_COLONY;
    const cause = g.queenCause.get(lostColony);
    const how =
      cause === 'starvation' ? 'starved' : cause === 'combat' ? 'was killed by raiders' : 'died';
    title.textContent = won ? 'Victory!' : s.winner === -2 ? 'Nobody wins' : 'Defeat';
    text.textContent =
      (won ? `The red queen ${how}. The yard is yours.` : `Your queen ${how}.`) +
      `\n${minutes} min · black lost ${s.colonies[0]?.losses ?? 0} · red lost ${s.colonies[1]?.losses ?? 0}`;
    modal.className = won ? 'win' : 'lose';
    modal.hidden = false;
    setPausedUi(true);
    again.focus();
  };
  const campaign = new CampaignUi({
    send: (action) => sim.campaignAction(action),
    toast: (msg) => playerInput.toast(msg),
    setPaused: (p) => {
      setPausedUi(p);
      sim.setPaused(p);
    },
    onOver: (won, heading, body) => {
      if (!game || game.over) return;
      game.over = true;
      tutorial.stop(true);
      title.textContent = heading;
      text.textContent = body;
      modal.className = won ? 'win' : 'lose';
      modal.hidden = false;
      setPausedUi(true);
      again.focus();
    },
  });
  function hideGameOver(): void {
    modal.hidden = true;
  }
  again.addEventListener('click', () =>
    lastConfig.campaign
      ? startCampaign({ difficulty: lastConfig.difficulty, seed: undefined })
      : startGame({
          difficulty: lastConfig.difficulty,
          seed: undefined,
          tutorial: false,
          ...(lastConfig.sandbox ? { sandbox: lastConfig.sandbox } : {}),
        }),
  );

  /** ?debug: buttons to provoke fights and raids without waiting. */
  function mountWarControls(panel: HTMLElement): void {
    const row = document.createElement('div');
    row.className = 'tuning-war';
    const add = (label: string, run: (s: Snapshot) => void): void => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', () => latest && run(latest));
      row.appendChild(b);
    };
    const near = (s: Snapshot, c: number) => {
      const n = s.colonies[c]!.nest;
      const cx = s.colonies.reduce((a, k) => a + k.nest.x, 0) / s.colonies.length;
      const cy = s.colonies.reduce((a, k) => a + k.nest.y, 0) / s.colonies.length;
      // 120 units from the nest, on the side facing the middle of the map.
      const d = Math.hypot(cx - n.x, cy - n.y) || 1;
      return { x: n.x + ((cx - n.x) / d) * 120, y: n.y + ((cy - n.y) / d) * 120 };
    };
    const soldiers = (colony: number, at: { x: number; y: number }) =>
      sim.sendCommands([
        { type: 'spawnAnts', count: 50, x: at.x, y: at.y, colony, caste: Caste.Soldier },
      ]);
    add('+50 black soldiers at red nest', (s) => soldiers(PLAYER_COLONY, near(s, RED_COLONY)));
    add('+50 red soldiers at our nest', (s) => soldiers(RED_COLONY, near(s, PLAYER_COLONY)));
    add('+50 soldiers each, mid-map', (s) => {
      const cx = (s.colonies[0]!.nest.x + s.colonies[1]!.nest.x) / 2;
      const cy = (s.colonies[0]!.nest.y + s.colonies[1]!.nest.y) / 2;
      soldiers(PLAYER_COLONY, { x: cx - 20, y: cy });
      soldiers(RED_COLONY, { x: cx + 20, y: cy });
    });
    add('Spawn spider near our nest', (s) => {
      const p = near(s, PLAYER_COLONY);
      sim.sendCommands([{ type: 'spawnSpider', x: p.x + 160, y: p.y }]);
    });
    add('Look at spider', (s) => {
      const sp = s.spiders.find((k) => k.hp > 0);
      if (sp) camera.focus(sp.x, sp.y, 1);
    });
    add('Start rain', () => sim.sendCommands([{ type: 'startRain', ticks: 900 }]));
    add('Add antlion pit (+6 ants)', (s) => {
      const p = near(s, PLAYER_COLONY);
      const x = p.x + 240;
      const y = p.y - 240;
      sim.sendCommands([
        { type: 'addAntlion', x, y },
        { type: 'spawnAnts', count: 6, x: x + 36, y, colony: PLAYER_COLONY, caste: Caste.Worker },
      ]);
      playerInput.setFollow(false);
      camera.focus(x, y, 2);
    });
    add('Look at pit', (s) => {
      const a = s.antlions[s.antlions.length - 1];
      if (a) camera.focus(a.x, a.y, 1);
    });
    add('Red raid on', () => sim.sendCommands([{ type: 'setRaid', colony: RED_COLONY, on: true }]));
    panel.appendChild(row);
  }

  // --- Menus, game session flow, tutorial -------------------------------------------------
  const tutorial = new TutorialPanel(touch, () => settings.update({ tutorialSeen: true }));
  const observeTutorial = (s: Snapshot): void => {
    const black = s.colonies[PLAYER_COLONY];
    if (!black) return;
    tutorial.observe({
      player: s.player,
      nest: black.nest,
      food: black.food,
      ratio: black.ratio,
      casteRatio: black.casteRatio,
      layer,
      scentOn,
      redQueenDead: s.colonies[RED_COLONY]?.lost ?? false,
    });
  };

  const menu: Menu = new Menu({
    settings,
    difficulty,
    onNewGame: (options) => startGame(options),
    onResume: () => resume(),
    onRestart: () =>
      lastConfig.campaign
        ? startCampaign({ difficulty: lastConfig.difficulty, seed: lastConfig.seed })
        : startGame({
            difficulty: lastConfig.difficulty,
            seed: lastConfig.seed,
            tutorial: false,
            ...(lastConfig.sandbox ? { sandbox: lastConfig.sandbox } : {}),
          }),
    onQuit: () => startBackdrop(),
    onNewCampaign: (options) => startCampaign(options),
    onReplayTutorial: () => {
      if (mode === 'menu') {
        startGame({ difficulty: lastConfig.difficulty, seed: undefined, tutorial: true });
      } else {
        resume();
        tutorial.start();
      }
    },
  });
  // Continue is offered whenever any save (autosave or manual) exists.
  const refreshContinue = (): void => {
    void hasSave().then((any) => menu.setContinue(any ? continueGame : null));
    void saves
      .list()
      .then((metas) => {
        const slot = latestCampaignSlot(metas);
        menu.setCampaignContinue(slot ? () => continueCampaign(slot) : null);
      })
      .catch(() => menu.setCampaignContinue(null));
  };

  const syncMenuClasses = (): void => {
    document.body.classList.toggle('in-menu', mode === 'menu');
    document.body.classList.toggle('menu-open', menu.isOpen);
  };

  /** Start (or restart) a real game on the existing Pixi app and worker; no reload. */
  function startGame(options: NewGameOptions): void {
    mode = 'playing';
    lastConfig = {
      seed: options.seed ?? randomSeed(),
      difficulty: options.difficulty,
      ...(options.sandbox ? { sandbox: options.sandbox } : {}),
    };
    menu.close();
    syncMenuClasses();
    tutorial.stop();
    pendingTutorial = options.tutorial;
    latest = null;
    hideGameOver();
    setPausedUi(false);
    sim.init({
      seed: lastConfig.seed,
      difficulty: lastConfig.difficulty,
      maxAnts: governor.maxAnts,
      ...(lastConfig.sandbox ? sandboxConfig(lastConfig.sandbox) : {}),
    });
    sim.setPaused(false);
    sim.setSpeed(speed);
    playerInput.setFollow(settings.value.followCamera);
    setScent(settings.value.scentVision);
  }

  /** Start a new campaign: the start patch in detail, the yard map behind it. */
  function startCampaign(options: NewCampaignOptions): void {
    mode = 'playing';
    lastConfig = {
      seed: options.seed ?? randomSeed(),
      difficulty: options.difficulty,
      campaign: true,
    };
    menu.close();
    syncMenuClasses();
    tutorial.stop();
    pendingTutorial = false;
    latest = null;
    hideGameOver();
    setPausedUi(false);
    sim.initCampaign({
      seed: lastConfig.seed,
      difficulty: lastConfig.difficulty,
      maxAnts: governor.maxAnts,
    });
    sim.setPaused(false);
    sim.setSpeed(speed);
    playerInput.setFollow(settings.value.followCamera);
    setScent(settings.value.scentVision);
  }

  /** Resume the newest campaign save. */
  function continueCampaign(slot: SaveSlot): void {
    mode = 'playing';
    menu.close();
    syncMenuClasses();
    tutorial.stop();
    pendingTutorial = false;
    hideGameOver();
    setPausedUi(false);
    sim.setPaused(false);
    playerInput.setFollow(settings.value.followCamera);
    setScent(settings.value.scentVision);
    saves
      .load(slot)
      .then((ok) => {
        if (!ok) startBackdrop();
      })
      .catch(() => startBackdrop());
  }

  /** Resume the most recent save. */
  function continueGame(): void {
    mode = 'playing';
    menu.close();
    syncMenuClasses();
    tutorial.stop();
    pendingTutorial = false;
    hideGameOver();
    setPausedUi(false);
    sim.setPaused(false);
    playerInput.setFollow(settings.value.followCamera);
    setScent(settings.value.scentVision);
    loadLatest()
      .then((ok) => {
        if (!ok) startBackdrop();
      })
      .catch(() => startBackdrop());
  }

  /** Back to the main menu over a small ambient colony. */
  function startBackdrop(): void {
    mode = 'menu';
    tutorial.stop();
    pendingTutorial = false;
    latest = null;
    hideGameOver();
    setPausedUi(false);
    setScent(false);
    sim.init({ seed: randomSeed(), colonies: 1, initialAnts: 40, difficulty });
    sim.setPaused(false);
    sim.setSpeed(1);
    refreshContinue();
    menu.showMain();
    syncMenuClasses();
  }

  function openPause(): void {
    if (mode !== 'playing' || menu.isOpen) return;
    setPausedUi(true);
    sim.setPaused(true);
    menu.showPause();
    syncMenuClasses();
  }

  function resume(): void {
    menu.close();
    syncMenuClasses();
    setPausedUi(false);
    sim.setPaused(false);
  }

  /** Esc / Android back: up a menu level, or open the pause menu during play. */
  const handleBack = (native: boolean): void => {
    if (campaign.mapOpen) {
      campaign.closeMap();
    } else if (menu.isOpen) {
      if (!menu.back() && native) void App.exitApp().catch(() => {});
      syncMenuClasses();
    } else if (mode === 'playing' && modal.hidden) {
      // Back from the nest view returns to the surface before it opens the pause menu.
      if (layer === 1) setLayer(0);
      else openPause();
    }
  };
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    handleBack(false);
  });
  void App.addListener('backButton', () => handleBack(true)).catch(() => {});

  settings.subscribe((s, changed) => {
    art.setMode(s.palette);
    fps.el.hidden = !s.showFps;
    haptics.enabled = s.haptics;
    app.ticker.maxFPS = s.batterySaver ? BATTERY_SAVER_FPS : 0;
    governor.batterySaver = s.batterySaver;
    if (mode === 'playing') {
      if (changed.includes('scentVision')) setScent(s.scentVision);
      if (changed.includes('followCamera')) playerInput.setFollow(s.followCamera);
    }
    if (changed.includes('reduceMotion') && mode === 'menu') {
      backdropFrozen = false;
      sim.setPaused(false);
    }
    if (changed.includes('tutorialSeen')) return;
  });
  fps.el.hidden = !settings.value.showFps;
  app.ticker.maxFPS = settings.value.batterySaver ? BATTERY_SAVER_FPS : 0;
  governor.batterySaver = settings.value.batterySaver;

  // Test hook for the e2e suite: dev and `--mode e2e` builds only, never in production.
  if (import.meta.env.DEV || import.meta.env.MODE === 'e2e') {
    window.__antDebug = {
      state: () => ({
        mode,
        paused,
        layer,
        tick: latest?.tick ?? -1,
        winner: latest?.winner ?? -1,
        population: latest?.colonies.map((c) => c.population) ?? [],
        player: latest?.player ? { x: latest.player.x, y: latest.player.y } : null,
        seed: lastConfig.seed,
        tutorialActive: tutorial.active,
        sandbox: sandbox.isActive,
        tool: sandbox.toolMode,
        rocks: rockCount,
        speed,
        audio: audio.backend.debugState(),
        campaign: campaign.state && {
          active: campaign.state.active,
          owned: campaign.state.owned,
          breeders: campaign.state.breeders,
          mapOpen: campaign.mapOpen,
          feet: campaign.feetCount,
          kind: campaign.state.patches[campaign.state.active]?.kind ?? 'yard',
        },
      }),
      send: (commands) => sim.sendCommands(commands),
    };
  }

  registerServiceWorker();

  if (params.has('play')) {
    startGame({
      difficulty,
      seed: Number(params.get('seed')) || undefined,
      tutorial: false,
    });
  } else {
    startBackdrop();
  }

  setInterval(() => {
    const s = latest;
    if (!s) return;
    const [black, red] = s.colonies;
    popBlack.textContent = black ? `${black.population}` : '';
    popRed.textContent = red ? `${red.population}` : '';
    popRed.hidden = !red;
    statsEl.textContent = `food ${Math.floor(black?.food ?? 0)} · tick ${s.tick}`;
    colonyPanel?.update(s);
    if (lastAutosaveTick < 0) lastAutosaveTick = s.tick;
    else if (s.tick - lastAutosaveTick >= AUTOSAVE_TICKS) autosave();
    nestSwitch.hidden = layer === 0 || !enemyNestKnown();
    audio.director.idle(audioContext());
  }, 250);
}

void main();
