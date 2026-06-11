import { VoxelGrid } from '../world/voxelGrid';
import { RoadNetwork } from '../world/roadGraph';
import { WaterSim } from '../sim/waterSim';
import { FireClusterizer } from '../sim/fireClusters';
import { Rng } from '../core/rng';

export type UnitKind = 'engine' | 'helicopter';

export type EngineState = 'idle' | 'dispatching' | 'fighting' | 'repositioning' | 'returning' | 'refilling';
export type HeliState = 'idle' | 'toWater' | 'filling' | 'toFire' | 'dropping';

export interface UnitStats {
  speed: number;
  hoseRange: number;
  hosePower: number;
  waterMax: number;
  refillRate: number;
}

/** Everything a unit needs to act on the world each tick. */
export interface UnitContext {
  grid: VoxelGrid;
  roads: RoadNetwork;
  water: WaterSim;
  clusters: FireClusterizer;
  rng: Rng;
  stationDoor: { x: number; z: number };
  pond: { x: number; z: number };
  /** Claim a perimeter target sprayable from the unit's current spot; returns voxel idx or -1. */
  requestTarget(unit: UnitBase): number;
  /** Claim any road-reachable perimeter target plus the road spot to spray it from. */
  requestEngagement(unit: UnitBase): { voxel: number; spotX: number; spotZ: number } | null;
  releaseTarget(unit: UnitBase): void;
}

let nextUnitId = 1;

export abstract class UnitBase {
  readonly id = nextUnitId++;
  abstract readonly kind: UnitKind;
  abstract readonly name: string;
  x = 0;
  z = 0;
  y = 1;
  heading = 0;
  water: number;
  stats: UnitStats;
  assignedCluster = -1;
  targetVoxel = -1;
  /** True while actively spraying/dropping — drives the water FX. */
  spraying = false;

  constructor(stats: UnitStats) {
    this.stats = { ...stats };
    this.water = stats.waterMax;
  }

  abstract get state(): string;
  abstract update(dt: number, ctx: UnitContext): void;
  /** Player order: engage the fire cluster nearest to (x,z). */
  abstract orderTo(x: number, z: number, ctx: UnitContext): void;

  get waterFraction(): number {
    return this.water / this.stats.waterMax;
  }

  /** Move toward (tx,tz) at stats.speed; returns true when arrived. */
  protected moveToward(tx: number, tz: number, dt: number, speedMul = 1): boolean {
    const dx = tx - this.x;
    const dz = tz - this.z;
    const dist = Math.hypot(dx, dz);
    const step = this.stats.speed * speedMul * dt;
    if (dist <= step) {
      this.x = tx;
      this.z = tz;
      return true;
    }
    this.x += (dx / dist) * step;
    this.z += (dz / dist) * step;
    this.heading = Math.atan2(dz, dx);
    return false;
  }
}

export { nextUnitId };
