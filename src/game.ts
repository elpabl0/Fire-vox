import { GRID, SIM } from './config';
import { EventBus } from './core/events';
import { Rng } from './core/rng';
import { generateCity, City } from './world/citygen';
import { Wind } from './sim/wind';
import { Weather } from './sim/weather';
import { FireSim } from './sim/fireSim';
import { WaterSim } from './sim/waterSim';
import { FireClusterizer } from './sim/fireClusters';
import { WaveDirector } from './sim/outbreaks';
import { CivilianManager } from './sim/civilians';
import { UnitManager } from './units/unitManager';
import { Engine } from './units/engine';
import { UnitBase } from './units/unit';
import { Economy } from './meta/economy';
import { UpgradeShop } from './meta/upgrades';
import { canRepair, repairBuilding, repairCost } from './meta/repair';
import { loadSave, recordRun } from './meta/persistence';
import { Renderer } from './render/renderer';
import { Sky } from './render/sky';
import { CameraRig } from './render/cameraRig';
import { ChunkManager } from './render/chunkManager';
import { UnitMeshes } from './render/unitMeshes';
import { CivilianMeshes } from './render/civilianMeshes';
import { Beacons } from './render/beacons';
import { TyreTracks } from './render/tyreTracks';
import { FireFx } from './render/particles/fireFx';
import { WaterFx } from './render/particles/waterFx';
import { WeatherFx } from './render/particles/weatherFx';
import { HeatVisionOverlay } from './render/heatVision';
import { Picking } from './render/picking';
import { Hud } from './ui/hud';
import { WindIndicator } from './ui/windIndicator';
import { ShopUi } from './ui/shop';
import { Toolbar } from './ui/toolbar';
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
  readonly weather: Weather;
  readonly fire: FireSim;
  readonly water: WaterSim;
  readonly clusters: FireClusterizer;
  readonly waves: WaveDirector;
  readonly units: UnitManager;
  readonly civilians: CivilianManager;
  readonly economy: Economy;
  readonly shop = new UpgradeShop();

  private renderer: Renderer;
  private sky: Sky;
  private cameraRig: CameraRig;
  private chunks: ChunkManager;
  private unitMeshes: UnitMeshes;
  private civilianMeshes: CivilianMeshes;
  private beacons: Beacons;
  private tracks: TyreTracks;
  private fireFx: FireFx;
  private waterFx: WaterFx;
  private weatherFx: WeatherFx;
  private heatVision: HeatVisionOverlay;
  private picking: Picking;
  private hud: Hud;
  private windUi: WindIndicator;
  private shopUi: ShopUi;
  private toolbar: Toolbar;
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
  private lastBrushAt = 0;
  private lastTrackAt = new Map<number, number>();

  constructor(readonly seed: number) {
    // --- simulation (pure TS, no three.js) ---
    const rng = new Rng(seed);
    this.city = generateCity(seed);
    this.wind = new Wind(rng.fork(1));
    this.weather = new Weather(rng.fork(6));
    this.fire = new FireSim(this.city.grid, this.city.buildings, this.wind, rng.fork(2), this.events);
    this.water = new WaterSim(this.city.grid, this.fire);
    this.clusters = new FireClusterizer(this.city.grid, this.wind);
    this.waves = new WaveDirector(this.city.grid, this.city.buildings, this.fire, this.wind, rng.fork(3), this.events);
    this.waves.origin = this.city.stationDoor;
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
    this.civilians = new CivilianManager(this.city.grid, this.city.roads, this.clusters, rng.fork(7));
    this.units.obstacleCheck = (unit) => this.carAhead(unit);
    this.economy = new Economy(this.city.buildings, this.events, this.waves);

    // --- render ---
    const container = document.getElementById('app')!;
    this.renderer = new Renderer(container);
    this.cameraRig = new CameraRig(this.renderer.camera, this.renderer.renderer.domElement);
    this.cameraRig.target.set(this.city.stationDoor.x, 0, this.city.stationDoor.z);
    this.chunks = new ChunkManager(this.city.grid, this.renderer.scene);
    this.sky = new Sky(this.renderer, this.chunks.material);
    this.chunks.rebuildAll();
    this.unitMeshes = new UnitMeshes(this.units, this.renderer.scene);
    this.civilianMeshes = new CivilianMeshes(this.civilians, this.renderer.scene);
    this.beacons = new Beacons(this.renderer.scene, this.city.grid);
    this.tracks = new TyreTracks(this.renderer.scene);
    const fxRng = rng.fork(5);
    this.fireFx = new FireFx(this.city.grid, this.fire, this.wind, fxRng, this.renderer.scene);
    this.waterFx = new WaterFx(this.units, fxRng, this.renderer.scene);
    this.weatherFx = new WeatherFx(this.weather, this.wind, fxRng, this.renderer.scene);
    this.heatVision = new HeatVisionOverlay(this.city.grid, this.fire);
    this.picking = new Picking(this.renderer.camera, this.chunks, this.unitMeshes);

    // --- ui ---
    this.hud = new Hud(this.economy, this.units, this.waves, this.events);
    this.windUi = new WindIndicator(this.wind);
    this.toolbar = new Toolbar(() => {
      this.economy.earn(1000);
      this.events.emit('toast', { text: 'Dev: +$1000', kind: 'info' });
    });
    this.shopUi = new ShopUi(
      this.shop,
      this.economy,
      {
        units: this.units,
        unlockHeatVision: () => {
          this.heatVision.unlocked = true;
          this.heatVision.enabled = true;
        },
        grantHydrant: () => {
          this.toolbar.addHydrant();
          this.events.emit('toast', { text: 'Hydrant kit ready — use the toolbar to place it', kind: 'info' });
        },
      },
      this.events,
    );
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
    this.events.on('outbreak', () => {
      this.events.emit('toast', { text: '🔥 Fire reported!', kind: 'warn' });
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
      if (e.button === 0 && (this.toolbar.tool === 'fireBrush' || this.toolbar.tool === 'waterBrush')) {
        this.applyBrush(e.clientX, e.clientY);
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      // brushes paint while dragging with the primary button
      if ((e.buttons & 1) !== 0 && (this.toolbar.tool === 'fireBrush' || this.toolbar.tool === 'waterBrush')) {
        if (this.time - this.lastBrushAt > 0.06) this.applyBrush(e.clientX, e.clientY);
      }
    });
    canvas.addEventListener('pointerup', (e) => {
      if (e.button !== 0) return;
      if (this.toolbar.tool === 'fireBrush' || this.toolbar.tool === 'waterBrush') return;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return; // drag, not click
      this.onClick(e.clientX, e.clientY, e.shiftKey);
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (this.started && !this.economy.isGameOver) this.paused = !this.paused;
      } else if (e.code === 'KeyH') {
        this.heatVision.toggle();
      } else if (e.code === 'KeyR') {
        this.toolbar.select(this.toolbar.tool === 'repair' ? 'order' : 'repair');
      } else if (e.code === 'Backquote') {
        this.debugPanel.classList.toggle('open');
      } else if (e.code === 'Escape') {
        this.units.selected = null;
        this.toolbar.select('order');
      }
    });
  }

  private onClick(x: number, y: number, shift: boolean): void {
    // world tools target the map, never the unit meshes that may overlap it
    const toolMode = this.toolbar.tool === 'repair' || this.toolbar.tool === 'hydrant';
    const hit = this.picking.pick(x, y, toolMode);
    switch (this.toolbar.tool) {
      case 'repair':
        if (hit.voxel) this.tryRepair(hit.voxel);
        return;
      case 'hydrant':
        if (hit.point) this.tryPlaceHydrant(hit.point.x, hit.point.z);
        return;
      default:
        break;
    }
    if (hit.unit) {
      this.units.selected = this.units.selected === hit.unit ? null : hit.unit;
      return;
    }
    if (!hit.point) return;
    if (shift && this.toolbar.devMode) {
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

  private tryRepair(voxel: { x: number; y: number; z: number }): void {
    const grid = this.city.grid;
    const idx = grid.idx(voxel.x, voxel.y, voxel.z);
    const ownerId = grid.owner[idx] || grid.originalOwner[idx];
    const building = this.city.buildings[ownerId];
    if (!building || building.id === 0) {
      this.events.emit('toast', { text: 'No building there to repair', kind: 'info' });
      return;
    }
    const check = canRepair(building);
    if (!check.ok) {
      this.events.emit('toast', { text: check.reason!, kind: 'info' });
      return;
    }
    const cost = repairCost(building);
    if (!this.economy.spend(cost)) {
      this.events.emit('toast', { text: `Repair costs $${cost} — not enough cash`, kind: 'warn' });
      return;
    }
    repairBuilding(grid, this.fire, building);
    this.events.emit('toast', { text: `Rebuilt for $${cost}`, kind: 'good' });
  }

  private tryPlaceHydrant(x: number, z: number): void {
    const vx = Math.round(x);
    const vz = Math.round(z);
    if (vx < 0 || vx >= GRID.W || vz < 0 || vz >= GRID.D) return;
    const roads = this.city.roads;
    if (roads.distToRoad[vx * D + vz] > 2 || this.city.grid.topY(vx, vz) !== 0) {
      this.events.emit('toast', { text: 'Hydrants must sit on open ground beside a road', kind: 'info' });
      return;
    }
    if (!this.toolbar.useHydrant()) return;
    this.units.placeHydrant(vx, vz);
    this.events.emit('toast', { text: 'Hydrant installed', kind: 'good' });
  }

  private applyBrush(clientX: number, clientY: number): void {
    this.lastBrushAt = this.time;
    const hit = this.picking.pick(clientX, clientY);
    if (!hit.point) return;
    const cx = Math.round(hit.point.x);
    const cz = Math.round(hit.point.z);
    if (this.toolbar.tool === 'waterBrush') {
      this.water.dropArea(cx, cz, 4, 90);
      return;
    }
    // fire brush: ignite the tops of a small disc
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        if (dx * dx + dz * dz > 5) continue;
        const x = cx + dx;
        const z = cz + dz;
        if (x < 0 || x >= GRID.W || z < 0 || z >= GRID.D) continue;
        const ty = this.city.grid.topY(x, z);
        if (ty >= 0) this.fire.ignite(this.city.grid.idx(x, ty, z));
      }
    }
  }

  /** Civilian car directly ahead of a driving engine? (used to ease off, not stop) */
  private carAhead(unit: UnitBase): boolean {
    const hx = Math.cos(unit.heading);
    const hz = Math.sin(unit.heading);
    for (const car of this.civilians.cars) {
      if (car.state === 'pullover') continue; // already clearing the lane
      const dx = car.x - unit.x;
      const dz = car.z - unit.z;
      const ahead = dx * hx + dz * hz;
      if (ahead < 0.5 || ahead > 3.5) continue;
      const lateral = Math.abs(dx * -hz + dz * hx);
      if (lateral < 1.0) return true;
    }
    return false;
  }

  private frame(now: number): void {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min((now - this.lastFrame) / 1000, 0.1);
    this.lastFrame = now;
    this.time += dt;

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
      this.weather.update(dt, this.fire, this.wind);
      this.waves.update(dt);
      this.units.update(dt);
      this.civilians.update(dt, this.units.units);
      this.simAccumulator += dt;
      while (this.simAccumulator >= SIM.TICK_DT) {
        this.simAccumulator -= SIM.TICK_DT;
        this.water.tick();
        this.fire.tick();
        this.heatVision.refreshTexture();
      }
      this.fireFx.update(this.time, dt);
      this.waterFx.update(this.time, dt);
      this.emitDriftTracks();
    }

    this.cameraRig.update(dt);
    this.sky.update(running ? dt : 0, this.weather);
    this.weatherFx.update(this.time, running ? dt : 0, this.cameraRig.target.x, this.cameraRig.target.z);
    this.heatVision.update(dt);
    this.chunks.update();
    this.unitMeshes.update(dt);
    this.civilianMeshes.update();
    this.beacons.update(this.units.units, this.time);
    this.tracks.update(dt);

    this.hudAccumulator += dt;
    if (this.hudAccumulator >= 0.1) {
      this.hudAccumulator = 0;
      this.hud.update();
      this.shopUi.refresh();
      this.windUi.update(this.cameraRig.yaw, this.weather.label());
      this.alerts.update();
      if (this.debugPanel.classList.contains('open')) this.updateDebug();
    }

    this.renderer.render();
  }

  private emitDriftTracks(): void {
    for (const unit of this.units.units) {
      if (!(unit instanceof Engine) || !unit.drifting) continue;
      const last = this.lastTrackAt.get(unit.id) ?? 0;
      if (this.time - last < 0.1) continue;
      this.lastTrackAt.set(unit.id, this.time);
      this.tracks.addPair(unit.x, unit.z, unit.heading, unit.heading);
    }
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
      `weather      ${this.weather.kind} ${(this.weather.intensity * 100).toFixed(0)}% wet=${this.weather.wetness.toFixed(2)} snow=${this.weather.snowCover.toFixed(2)}`,
      `time of day  ${this.sky.timeOfDay.toFixed(2)} ${this.sky.isNight ? '(night)' : '(day)'}`,
      `wind         ${this.wind.strength.toFixed(2)} @ ${((this.wind.angle * 180) / Math.PI).toFixed(0)}°`,
      `units        ${this.units.units.map((u) => `${u.kind[0]}:${u.state}`).join(' ')}`,
    ].join('\n');
  }
}
