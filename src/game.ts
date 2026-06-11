import { GRID, SIM } from './config';
import { EventBus } from './core/events';
import { Rng } from './core/rng';
import { generateCity, City } from './world/citygen';
import { Wind } from './sim/wind';
import { FireSim } from './sim/fireSim';
import { WaterSim } from './sim/waterSim';
import { FireClusterizer } from './sim/fireClusters';
import { WaveDirector } from './sim/outbreaks';
import { UnitManager } from './units/unitManager';
import { Economy } from './meta/economy';
import { UpgradeShop } from './meta/upgrades';
import { loadSave, recordRun } from './meta/persistence';
import { Renderer } from './render/renderer';
import { CameraRig } from './render/cameraRig';
import { ChunkManager } from './render/chunkManager';
import { UnitMeshes } from './render/unitMeshes';
import { FireFx } from './render/particles/fireFx';
import { WaterFx } from './render/particles/waterFx';
import { HeatVisionOverlay } from './render/heatVision';
import { Picking } from './render/picking';
import { Hud } from './ui/hud';
import { WindIndicator } from './ui/windIndicator';
import { ShopUi } from './ui/shop';
import { FireAlerts } from './ui/minimapAlerts';
import { Screens } from './ui/screens';

const { D, H } = GRID;

/**
 * Orchestrator: builds the world + sims + render + UI, runs the fixed-timestep
 * sim tick (6 Hz) inside a 60 fps render loop.
 */
export class Game {
  readonly events = new EventBus();
  readonly city: City;
  readonly wind: Wind;
  readonly fire: FireSim;
  readonly water: WaterSim;
  readonly clusters: FireClusterizer;
  readonly waves: WaveDirector;
  readonly units: UnitManager;
  readonly economy: Economy;
  readonly shop = new UpgradeShop();

  private renderer: Renderer;
  private cameraRig: CameraRig;
  private chunks: ChunkManager;
  private unitMeshes: UnitMeshes;
  private fireFx: FireFx;
  private waterFx: WaterFx;
  private heatVision: HeatVisionOverlay;
  private picking: Picking;
  private hud: Hud;
  private windUi: WindIndicator;
  private shopUi: ShopUi;
  private alerts: FireAlerts;
  private screens = new Screens();
  private debugPanel = document.getElementById('debug-panel')!;

  private started = false;
  private paused = false;
  private simAccumulator = 0;
  private hudAccumulator = 0;
  private lastFrame = 0;
  private time = 0;
  private fps = 0;
  private frameCount = 0;
  private fpsTimer = 0;

  constructor(readonly seed: number) {
    // --- simulation (pure TS, no three.js) ---
    const rng = new Rng(seed);
    this.city = generateCity(seed);
    this.wind = new Wind(rng.fork(1));
    this.fire = new FireSim(this.city.grid, this.city.buildings, this.wind, rng.fork(2), this.events);
    this.water = new WaterSim(this.city.grid, this.fire);
    this.clusters = new FireClusterizer(this.city.grid, this.wind);
    this.waves = new WaveDirector(this.city.grid, this.city.buildings, this.fire, this.wind, rng.fork(3), this.events);
    this.units = new UnitManager(
      this.city.grid,
      this.city.roads,
      this.water,
      this.fire,
      this.clusters,
      rng.fork(4),
      this.city.stationDoor,
      this.city.pond,
    );
    this.units.spawnEngine();
    this.units.spawnEngine();
    this.economy = new Economy(this.city.buildings, this.events, this.waves);

    // --- render ---
    const container = document.getElementById('app')!;
    this.renderer = new Renderer(container);
    this.cameraRig = new CameraRig(this.renderer.camera, this.renderer.renderer.domElement);
    this.cameraRig.target.set(this.city.stationDoor.x, 0, this.city.stationDoor.z);
    this.chunks = new ChunkManager(this.city.grid, this.renderer.scene);
    this.chunks.rebuildAll();
    this.unitMeshes = new UnitMeshes(this.units, this.renderer.scene);
    const fxRng = rng.fork(5);
    this.fireFx = new FireFx(this.city.grid, this.fire, this.wind, fxRng, this.renderer.scene);
    this.waterFx = new WaterFx(this.units, fxRng, this.renderer.scene);
    this.heatVision = new HeatVisionOverlay(this.city.grid, this.fire, this.renderer.scene);
    this.picking = new Picking(this.renderer.camera, this.chunks, this.unitMeshes);

    // --- ui ---
    this.hud = new Hud(this.economy, this.units, this.waves, this.events);
    this.windUi = new WindIndicator(this.wind);
    this.shopUi = new ShopUi(this.shop, this.economy, {
      units: this.units,
      unlockHeatVision: () => {
        this.heatVision.unlocked = true;
        this.heatVision.enabled = true;
      },
    }, this.events);
    this.alerts = new FireAlerts(this.clusters, this.renderer.camera);

    this.wireEvents();
    this.wireInput();

    this.screens.showTitle(loadSave(), seed, () => {
      this.started = true;
    });

    requestAnimationFrame((t) => this.frame(t));
  }

  private wireEvents(): void {
    this.events.on('voxelDestroyed', ({ idx }) => {
      const x = Math.floor(idx / (D * H));
      const z = Math.floor(idx / H) % D;
      const y = idx % H;
      this.fireFx.puffAt(this.time, x, y, z);
    });
    this.events.on('waveStarted', ({ wave }) => {
      this.events.emit('toast', { text: `Wave ${wave} — stay sharp`, kind: 'info' });
    });
    this.events.on('outbreak', ({ x, z }) => {
      this.events.emit('toast', { text: '🔥 Fire reported!', kind: 'warn' });
      void x;
      void z;
    });
    this.events.on('gameOver', ({ score, wave }) => {
      const prev = loadSave();
      const isRecord = score > prev.highScore;
      const save = recordRun(score, wave, this.seed);
      this.screens.showGameOver(score, wave, save, isRecord);
    });
  }

  private wireInput(): void {
    const canvas = this.renderer.renderer.domElement;
    let downX = 0;
    let downY = 0;
    canvas.addEventListener('pointerdown', (e) => {
      downX = e.clientX;
      downY = e.clientY;
    });
    canvas.addEventListener('pointerup', (e) => {
      if (e.button !== 0) return;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return; // drag, not click
      this.onClick(e.clientX, e.clientY, e.shiftKey);
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (this.started && !this.economy.isGameOver) this.paused = !this.paused;
      } else if (e.code === 'KeyH') {
        this.heatVision.toggle();
      } else if (e.code === 'Backquote') {
        this.debugPanel.classList.toggle('open');
      } else if (e.code === 'Escape') {
        this.units.selected = null;
      }
    });
  }

  private onClick(x: number, y: number, shift: boolean): void {
    const hit = this.picking.pick(x, y);
    if (hit.unit) {
      this.units.selected = this.units.selected === hit.unit ? null : hit.unit;
      return;
    }
    if (!hit.point) return;
    if (shift) {
      // debug tool: ignite the clicked voxel
      const vx = Math.floor(hit.point.x);
      const vz = Math.floor(hit.point.z);
      if (vx >= 0 && vx < GRID.W && vz >= 0 && vz < GRID.D) {
        const ty = this.city.grid.topY(vx, vz);
        if (ty >= 0) this.fire.ignite(this.city.grid.idx(vx, ty, vz));
      }
      return;
    }
    this.units.orderAt(hit.point.x, hit.point.z);
  }

  private frame(now: number): void {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min((now - this.lastFrame) / 1000, 0.1);
    this.lastFrame = now;
    this.time += dt;

    // fps tracking
    this.frameCount++;
    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.5) {
      this.fps = this.frameCount / this.fpsTimer;
      this.frameCount = 0;
      this.fpsTimer = 0;
    }

    const running = this.started && !this.paused && !this.economy.isGameOver;
    if (running) {
      this.wind.update(dt);
      this.waves.update(dt);
      this.units.update(dt);
      this.simAccumulator += dt;
      while (this.simAccumulator >= SIM.TICK_DT) {
        this.simAccumulator -= SIM.TICK_DT;
        this.water.tick();
        this.fire.tick();
        this.heatVision.refreshTexture();
      }
      this.fireFx.update(this.time, dt);
      this.waterFx.update(this.time, dt);
    }

    this.cameraRig.update(dt);
    this.heatVision.update(dt);
    this.chunks.update();
    this.unitMeshes.update(dt);

    this.hudAccumulator += dt;
    if (this.hudAccumulator >= 0.1) {
      this.hudAccumulator = 0;
      this.hud.update();
      this.shopUi.refresh();
      this.windUi.update(this.cameraRig.yaw);
      this.alerts.update();
      if (this.debugPanel.classList.contains('open')) this.updateDebug();
    }

    this.renderer.render();
  }

  private updateDebug(): void {
    this.debugPanel.textContent = [
      `fps          ${this.fps.toFixed(0)}`,
      `sim tick     ${this.fire.lastTickMs.toFixed(2)} ms`,
      `active fire  ${this.fire.activeFire.size}`,
      `hot cells    ${this.fire.hotCells.size}`,
      `clusters     ${this.clusters.clusters.length}`,
      `dirty chunks ${this.chunks.dirtyCount}`,
      `draw calls   ${this.renderer.drawCalls}`,
      `water drops  ${this.waterFx.liveCount}`,
      `wind         ${this.wind.strength.toFixed(2)} @ ${((this.wind.angle * 180) / Math.PI).toFixed(0)}°`,
      `units        ${this.units.units.map((u) => `${u.kind[0]}:${u.state}`).join(' ')}`,
      ``,
      `shift+click: ignite`,
    ].join('\n');
  }
}
