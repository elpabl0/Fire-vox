import { VoxelGrid } from '../world/voxelGrid';
import { RoadNetwork } from '../world/roadGraph';
import { WaterSim } from '../sim/waterSim';
import { FireClusterizer } from '../sim/fireClusters';
import { Rng } from '../core/rng';

export type UnitKind = 'engine' | 'helicopter' | 'firefighter';

export type EngineState = 'idle' | 'dispatching' | 'fighting' | 'repositioning' | 'returning' | 'refilling';
export type HeliState = 'idle' | 'toBase' | 'landed' | 'toWater' | 'filling' | 'toFire' | 'dropping';
export type FirefighterState = 'riding' | 'moving' | 'spraying' | 'returning';

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
  /** Nearest water source for an empty engine: the station or a placed hydrant. */
  nearestRefill(x: number, z: number): { x: number; z: number };
  /** Claim a perimeter target within `reach` of the unit's position; returns voxel idx or -1. */
  requestTarget(unit: UnitBase, reach?: number): number;
  /** Claim any road-reachable perimeter target plus the road spot to spray it from. */
  requestEngagement(unit: UnitBase): { voxel: number; spotX: number; spotZ: number } | null;
  releaseTarget(unit: UnitBase): void;
  /** True when a civilian vehicle blocks the road just ahead of this unit. */
  obstacleAhead(unit: UnitBase): boolean;
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
  /** Player-clicked destination — drives the dispatch beacon. */
  orderedTarget: { x: number; z: number } | null = null;
  /** Per-unit accent colour (beacon, light bar), assigned at spawn. */
  accentColor = 0xff8c3a;

  constructor(stats: UnitStats) {
    this.stats = { ...stats };
    this.water = stats.waterMax;
  }

  abstract get state(): string;
  abstract update(dt: number, ctx: UnitContext): void;
  /** Player order: engage the fire cluster nearest to (x,z). */
  abstract orderTo(x: number, z: number, ctx: UnitContext): void;

  get waterFraction(): number {
    return this.stats.waterMax > 0 ? this.water / this.stats.waterMax : 0;
  }

  /** Move toward (tx,tz) at stats.speed; returns true when arrived. Simple kinematics (air/foot units). */
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
