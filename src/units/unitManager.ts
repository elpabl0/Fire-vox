import { UNITS } from '../config';
import { Rng } from '../core/rng';
import { FireClusterizer } from '../sim/fireClusters';
import { FireSim } from '../sim/fireSim';
import { WaterSim } from '../sim/waterSim';
import { RoadNetwork } from '../world/roadGraph';
import { VoxelGrid } from '../world/voxelGrid';
import { Coordinator } from './coordinator';
import { Engine } from './engine';
import { Helicopter } from './helicopter';
import { UnitBase, UnitContext, UnitStats } from './unit';

/** Owns all units: spawning, per-frame updates, periodic coordination, selection. */
export class UnitManager {
  readonly units: UnitBase[] = [];
  readonly coordinator: Coordinator;
  selected: UnitBase | null = null;
  /** Idle units engage nearby fires on their own when enabled (always on; kept as a flag for testing). */
  autoAssign = true;
  /** Upgrade-modified stats applied to newly spawned and existing engines. */
  readonly engineStats: UnitStats = { ...UNITS.ENGINE };
  private coordinateIn = 0;
  private engineCount = 0;
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
      requestTarget: (unit) => coordinator.requestTarget(unit),
      requestEngagement: (unit) => coordinator.requestEngagement(unit),
      releaseTarget: (unit) => coordinator.releaseTarget(unit),
    };
  }

  spawnEngine(): Engine {
    this.engineCount++;
    const engine = new Engine(this.engineStats, this.engineCount);
    engine.x = this.ctx.stationDoor.x;
    engine.z = this.ctx.stationDoor.z;
    // offset spawn so multiple engines don't stack
    engine.z += (this.engineCount - 1) * 1.5;
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
    heli.x = this.ctx.stationDoor.x;
    heli.z = this.ctx.stationDoor.z;
    this.units.push(heli);
    return heli;
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
      this.coordinator.replan(this.units, this.fire.activeFire, this.ctx, this.autoAssign);
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
      if (u.state !== 'idle') continue;
      const d = Math.hypot(u.x - x, u.z - z);
      if (d < bestD) {
        bestD = d;
        best = u;
      }
    }
    return best;
  }
}
