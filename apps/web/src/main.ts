import { Application, Container, Graphics } from 'pixi.js';
import type { Difficulty, SimConfig, Snapshot } from '@ant/shared';
import { Caste, NEST_TILE, PLAYER_COLONY, RED_COLONY, SPEED_STEPS } from '@ant/shared';
import { AntLayer } from './antLayer';
import { Camera } from './camera';
import { ScentOverlay } from './scentOverlay';
import { WorldLayer } from './worldLayer';
import { SimClient } from './simClient';
import { pauseWhenBackgrounded } from './lifecycle';
import { bindSaves, hasSave, loadLatest } from './save';
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
import { Menu, type NewGameOptions } from './ui/menu';
import { SettingsStore } from './ui/settings';
import { bindDocumentSettings, createFpsMeter } from './ui/applySettings';
import { TutorialPanel } from './ui/tutorialPanel';
import { registerServiceWorker } from './pwa';

const SURFACE_BACKGROUND = 0x1b2a1b;
/** Underground ant tints (index = colony): light so they read against dark tunnels. */
const NEST_TINTS = [0xd9c7a5, 0xff6a4a];
const NEST_FIGHT_TINTS = [0xffffff, 0xffd0a0];
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
  scent: ScentOverlay;
  worldLayer: WorldLayer;
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
  const app = new Application();
  await app.init({
    resizeTo: window,
    background: SURFACE_BACKGROUND,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
  });
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
  const weather = new WeatherLayer(app.stage, app.screen);
  const settings = new SettingsStore();
  await settings.load();
  bindDocumentSettings(settings);
  const fps = createFpsMeter();
  /** `menu`: ambient backdrop behind the main menu; `playing`: a real game (maybe paused). */
  let mode: 'menu' | 'playing' = 'menu';
  let backdropFrozen = false;
  let pendingTutorial = false;
  let lastConfig = { seed: 0, difficulty };
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

  const frameNest = (view: NestView): void => {
    const g = view.gridSize!;
    const r = host.getBoundingClientRect();
    const zoom = Math.min(2.5, Math.max(0.5, r.width / (30 * NEST_TILE)));
    nestCamera.focus((g.entranceX + 0.5) * NEST_TILE, 11 * NEST_TILE, zoom);
  };

  const buildScene = (config: SimConfig): Scene => {
    for (const child of world.removeChildren()) child.destroy({ children: true });
    for (const child of nestRoot.removeChildren()) child.destroy({ children: true });
    const bg = new Graphics();
    bg.rect(0, 0, config.worldSize, config.worldSize).fill(0x2f4a2a);
    for (let i = 0; i <= config.worldSize; i += 128) {
      bg.moveTo(i, 0).lineTo(i, config.worldSize).moveTo(0, i).lineTo(config.worldSize, i);
    }
    bg.stroke({ color: 0x3d5c36, width: 1 });
    world.addChild(bg);
    const scent = new ScentOverlay(world, config.worldSize);
    scent.setVisible(scentOn);
    const worldLayer = new WorldLayer(world);
    const mounds: DirtMound[] = [];
    for (let c = 0; c < config.colonies; c++) mounds.push(new DirtMound(world, c));
    const ants = new AntLayer(app.renderer, world, { layer: 0 });
    const spiders = new SpiderLayer(world);
    // Pits are ground texture: just above the grass, below everything that walks on it.
    const antlions = new AntlionLayer(world);
    world.addChildAt(antlions.view, 1);
    antlions.setReduceMotion(settings.value.reduceMotion);
    const nests = [];
    for (let c = 0; c < config.colonies; c++) {
      const view = new NestView(c);
      nestRoot.addChild(view.view);
      const nestAnts = new AntLayer(app.renderer, view.antParent, {
        layer: 1 + c,
        scale: 0.75,
        tints: NEST_TINTS,
        fightTints: NEST_FIGHT_TINTS,
      });
      nests.push({ view, ants: nestAnts, framed: false });
    }
    const marker = new PlayerMarker(world);
    return {
      scent,
      worldLayer,
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

  const sim = new SimClient({
    onReady(config) {
      game = buildScene(config);
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
      camera.focus(config.worldSize / 2, config.worldSize / 2, 1.5);
      if (debug && !tuningMounted) {
        tuningMounted = true;
        mountWarControls(mountTuningPanel(sim, config.behavior));
      }
    },
    onSnapshot(snapshot, speed) {
      const g = game;
      if (!g) return;
      g.worldLayer.update(snapshot);
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
        camera.focus(home.x, home.y, 1.5);
      }
      latest = snapshot;
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
    onTarget: (x, y) => game?.marker.showTarget(x, y),
    keysEnabled: () => mode === 'playing' && !menu.isOpen,
  });

  app.ticker.add(() => {
    fps.tick(app.ticker.FPS);
    weather.setReduceMotion(settings.value.reduceMotion);
    weather.tick(app.ticker.deltaMS);
    const g = game;
    if (!g) return;
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
    foodTool.hidden = next === 1;
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
  function hideGameOver(): void {
    modal.hidden = true;
  }
  again.addEventListener('click', () =>
    startGame({ difficulty: lastConfig.difficulty, seed: undefined, tutorial: false }),
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
      if (sp) camera.focus(sp.x, sp.y, 1.5);
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
      if (a) camera.focus(a.x, a.y, 1.5);
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
      startGame({ difficulty: lastConfig.difficulty, seed: lastConfig.seed, tutorial: false }),
    onQuit: () => startBackdrop(),
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
  };

  const syncMenuClasses = (): void => {
    document.body.classList.toggle('in-menu', mode === 'menu');
    document.body.classList.toggle('menu-open', menu.isOpen);
  };

  /** Start (or restart) a real game on the existing Pixi app and worker; no reload. */
  function startGame(options: NewGameOptions): void {
    mode = 'playing';
    lastConfig = { seed: options.seed ?? randomSeed(), difficulty: options.difficulty };
    menu.close();
    syncMenuClasses();
    tutorial.stop();
    pendingTutorial = options.tutorial;
    latest = null;
    hideGameOver();
    setPausedUi(false);
    sim.init(lastConfig);
    sim.setPaused(false);
    sim.setSpeed(speed);
    playerInput.setFollow(settings.value.followCamera);
    setScent(settings.value.scentVision);
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
    if (menu.isOpen) {
      if (!menu.back() && native) void App.exitApp().catch(() => {});
      syncMenuClasses();
    } else if (mode === 'playing' && modal.hidden) openPause();
  };
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    handleBack(false);
  });
  void App.addListener('backButton', () => handleBack(true)).catch(() => {});

  settings.subscribe((s, changed) => {
    fps.el.hidden = !s.showFps;
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
  }, 250);
}

void main();
