import { UNITS } from '../config';
import { Rng } from '../core/rng';
import { FireClusterizer } from '../sim/fireClusters';
import { FireSim } from '../sim/fireSim';
import { WaterSim } from '../sim/waterSim';
import { RoadNetwork } from '../world/roadGraph';
import { VoxelGrid } from '../world/voxelGrid';
import { Coordinator } from './coordinator';
import { Engine } from './engine';
import { Firefighter } from './firefighter';
import { Helicopter } from './helicopter';
import { UnitBase, UnitContext, UnitStats } from './unit';

const ACCENT_PALETTE = [0xff8c3a, 0x4db8ff, 0x7fe08a, 0xe85a8a, 0xf0c050, 0xb07fe0];

export interface Hydrant {
  x: number;
  z: number;
}

/** Owns all units: spawning, per-frame updates, periodic coordination, selection, hydrants. */
export class UnitManager {
  readonly units: UnitBase[] = [];
  readonly hydrants: Hydrant[] = [];
  readonly coordinator: Coordinator;
  selected: UnitBase | null = null;
  /** Cross-map auto-dispatch (off: finding fires and dispatching is the player's role). */
  autoAssign = false;
  /** Upgrade-modified stats applied to newly spawned and existing engines. */
  readonly engineStats: UnitStats = { ...UNITS.ENGINE };
  /** Firefighters carried per engine (Crew upgrade). */
  crewLevel = 0;
  /** Hook installed by the game so engines brake for civilian traffic. */
  obstacleCheck: (unit: UnitBase) => boolean = () => false;

  private coordinateIn = 0;
  private engineCount = 0;
  private spawnCount = 0;
  private ctx: UnitContext;

  constructor(
    grid: VoxelGrid,
    roads: RoadNetwork,
    water: WaterSim,
    private fire: FireSim,
    clusters: FireClusterizer,
    rng: Rng,
    stationDoor: { x: number; z: number },
    pond: { x: number; z: number },
  ) {
    this.coordinator = new Coordinator(grid, roads, clusters);
    const coordinator = this.coordinator;
    this.ctx = {
      grid,
      roads,
      water,
      clusters,
      rng,
      stationDoor,
      pond,
      nearestRefill: (x, z) => this.nearestRefill(x, z),
      requestTarget: (unit, reach) => coordinator.requestTarget(unit, reach),
      requestEngagement: (unit) => coordinator.requestEngagement(unit),
      releaseTarget: (unit) => coordinator.releaseTarget(unit),
      obstacleAhead: (unit) => this.obstacleCheck(unit),
    };
  }

  /** All claim-holding actors: rostered units plus deployed crew. */
  get allUnits(): UnitBase[] {
    const all: UnitBase[] = [...this.units];
    for (const u of this.units) {
      if (u instanceof Engine) all.push(...u.crew);
    }
    return all;
  }

  spawnEngine(): Engine {
    this.engineCount++;
    const engine = new Engine(this.engineStats, this.engineCount);
    engine.accentColor = ACCENT_PALETTE[this.spawnCount++ % ACCENT_PALETTE.length];
    engine.x = this.ctx.stationDoor.x;
    engine.z = this.ctx.stationDoor.z;
    engine.z += (this.engineCount - 1) * 2;
    for (let i = 0; i < this.crewLevel; i++) engine.crew.push(new Firefighter(engine));
    this.units.push(engine);
    return engine;
  }

  spawnHelicopter(): Helicopter {
    const heli = new Helicopter({
      speed: UNITS.HELICOPTER.speed,
      hoseRange: 0,
      hosePower: 0,
      waterMax: UNITS.HELICOPTER.waterMax,
      refillRate: UNITS.HELICOPTER.fillRate,
    });
    heli.accentColor = ACCENT_PALETTE[this.spawnCount++ % ACCENT_PALETTE.length];
    heli.x = this.ctx.stationDoor.x;
    heli.z = this.ctx.stationDoor.z;
    this.units.push(heli);
    return heli;
  }

  /** Crew upgrade: every engine (current and future) carries this many firefighters. */
  setCrewLevel(level: number): void {
    this.crewLevel = level;
    for (const u of this.units) {
      if (u instanceof Engine) {
        while (u.crew.length < level) u.crew.push(new Firefighter(u));
      }
    }
  }

  placeHydrant(x: number, z: number): void {
    this.hydrants.push({ x, z });
  }

  nearestRefill(x: number, z: number): { x: number; z: number } {
    let best = this.ctx.stationDoor;
    let bestD = Math.hypot(best.x - x, best.z - z);
    for (const h of this.hydrants) {
      const d = Math.hypot(h.x - x, h.z - z);
      if (d < bestD) {
        bestD = d;
        best = h;
      }
    }
    return best;
  }

  /** Apply an upgraded stat value to current and future engines. */
  applyEngineStat<K extends keyof UnitStats>(key: K, value: UnitStats[K]): void {
    this.engineStats[key] = value;
    for (const u of this.units) {
      if (u.kind === 'engine') {
        const refillingTopUp = key === 'waterMax' && u.water >= u.stats.waterMax;
        u.stats[key] = value;
        if (refillingTopUp) u.water = u.stats.waterMax;
      }
    }
  }

  update(dt: number): void {
    this.coordinateIn -= dt;
    if (this.coordinateIn <= 0) {
      this.coordinateIn = UNITS.COORDINATE_INTERVAL_S;
      this.coordinator.replan(this.allUnits, this.fire.activeFire, this.ctx, this.autoAssign);
    }
    for (const unit of this.units) unit.update(dt, this.ctx);
  }

  /** Player order: send the selected unit (or nearest idle engine) to a map point. */
  orderAt(x: number, z: number): boolean {
    const unit = this.selected ?? this.nearestIdle(x, z);
    if (!unit) return false;
    unit.orderTo(x, z, this.ctx);
    return true;
  }

  private nearestIdle(x: number, z: number): UnitBase | null {
    let best: UnitBase | null = null;
    let bestD = Infinity;
    for (const u of this.units) {
      if (u.state !== 'idle' && u.state !== 'landed') continue;
      const d = Math.hypot(u.x - x, u.z - z);
      if (d < bestD) {
        bestD = d;
        best = u;
      }
    }
    return best;
  }
}
