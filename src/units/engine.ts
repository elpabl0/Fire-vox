import { GRID } from '../config';
import { Flag } from '../world/materials';
import { findRoadPath, PathPoint } from './pathfinding';
import { EngineState, UnitBase, UnitContext, UnitStats } from './unit';

const { D, H } = GRID;

/**
 * Road-bound fire engine. Drives the road network to a standing spot within
 * hose range of its claimed perimeter voxel, sprays (sim-authoritative water
 * delivery; the ballistic arc is rendered by waterFx), and returns to the
 * station to refill when dry.
 */
export class Engine extends UnitBase {
  readonly kind = 'engine' as const;
  name: string;
  private _state: EngineState = 'idle';
  private path: PathPoint[] | null = null;
  private pathIdx = 0;
  /** Where the current path is taking us, so arrival can transition correctly. */
  private destination: 'fire' | 'station' = 'fire';
  /** Time left before re-evaluating a stale/no-target situation. */
  private retargetIn = 0;

  constructor(stats: UnitStats, index: number) {
    super(stats);
    this.name = `Engine ${index}`;
  }

  get state(): string {
    return this._state;
  }

  orderTo(x: number, z: number, ctx: UnitContext): void {
    const cluster = ctx.clusters.nearestCluster(x, z);
    ctx.releaseTarget(this);
    this.assignedCluster = cluster ? cluster.id : -1;
    this.driveTo(x, z, ctx, 'fire');
  }

  /** Coordinator auto-assignment. */
  assignCluster(clusterId: number, cx: number, cz: number, ctx: UnitContext): void {
    this.assignedCluster = clusterId;
    if (this._state === 'idle' || this._state === 'fighting' || this._state === 'repositioning' || this._state === 'dispatching') {
      this.driveTo(cx, cz, ctx, 'fire');
    }
  }

  private driveTo(x: number, z: number, ctx: UnitContext, destination: 'fire' | 'station'): void {
    const from = ctx.roads.nearestRoadCell(this.x, this.z);
    const to = ctx.roads.nearestRoadCell(x, z);
    if (!from || !to) return;
    const path = findRoadPath(ctx.roads, from.x, from.z, to.x, to.z);
    if (!path) return;
    this.path = path;
    this.pathIdx = 0;
    this.destination = destination;
    this._state = destination === 'station' ? 'returning' : 'dispatching';
    this.spraying = false;
  }

  update(dt: number, ctx: UnitContext): void {
    switch (this._state) {
      case 'idle':
        this.spraying = false;
        break;
      case 'dispatching':
      case 'returning':
      case 'repositioning':
        this.followPath(dt, ctx);
        break;
      case 'fighting':
        this.fight(dt, ctx);
        break;
      case 'refilling':
        this.water = Math.min(this.stats.waterMax, this.water + this.stats.refillRate * dt);
        if (this.water >= this.stats.waterMax) {
          this._state = 'idle';
        }
        break;
    }
  }

  private followPath(dt: number, ctx: UnitContext): void {
    if (!this.path || this.pathIdx >= this.path.length) {
      this.onArrived(ctx);
      return;
    }
    const wp = this.path[this.pathIdx];
    // slow into corners: slower when next waypoint is a turn and we're close
    const arrived = this.moveToward(wp.x, wp.z, dt, this.pathIdx === this.path.length - 1 ? 0.7 : 1);
    if (arrived) {
      this.pathIdx++;
      if (this.pathIdx >= this.path.length) this.onArrived(ctx);
    }
  }

  private onArrived(ctx: UnitContext): void {
    this.path = null;
    if (this.destination === 'station') {
      this._state = 'refilling';
    } else {
      this._state = 'fighting';
      this.retargetIn = 0;
      void ctx;
    }
  }

  private fight(dt: number, ctx: UnitContext): void {
    if (this.water <= 0) {
      ctx.releaseTarget(this);
      this.spraying = false;
      this.driveTo(ctx.stationDoor.x, ctx.stationDoor.z, ctx, 'station');
      return;
    }
    // validate target
    if (this.targetVoxel >= 0) {
      const burning = (ctx.grid.flags[this.targetVoxel] & Flag.BURNING) !== 0;
      const tx = Math.floor(this.targetVoxel / (D * H));
      const tz = Math.floor(this.targetVoxel / H) % D;
      const inRange = Math.hypot(tx - this.x, tz - this.z) <= this.stats.hoseRange;
      if (!burning || !inRange) {
        ctx.releaseTarget(this);
      }
    }
    if (this.targetVoxel < 0) {
      this.retargetIn -= dt;
      this.spraying = false;
      if (this.retargetIn > 0) return;
      this.retargetIn = 0.5;
      const idx = ctx.requestTarget(this);
      if (idx < 0) {
        // nothing sprayable from here: claim a target elsewhere on the
        // perimeter and drive to its road spot (claim survives the drive)
        const engagement = ctx.requestEngagement(this);
        if (engagement) {
          if (Math.hypot(engagement.spotX - this.x, engagement.spotZ - this.z) > 1.5) {
            this.driveTo(engagement.spotX, engagement.spotZ, ctx, 'fire');
            this._state = 'repositioning';
          }
          return;
        }
        const cluster = ctx.clusters.byId(this.assignedCluster);
        if (!cluster || cluster.size === 0) {
          this.assignedCluster = -1;
          this._state = 'idle';
        }
        // cluster alive but unreachable by road (interior fire): hold position,
        // retry shortly — spillover or the helicopter handles the core
        this.retargetIn = 1.5;
        return;
      }
    }
    // spray the claimed voxel (with slight scatter so the splash wets neighbours)
    const tx = Math.floor(this.targetVoxel / (D * H));
    const tz = Math.floor(this.targetVoxel / H) % D;
    const ty = this.targetVoxel % H;
    this.heading = Math.atan2(tz - this.z, tx - this.x);
    this.spraying = true;
    const amount = this.stats.hosePower * dt;
    ctx.water.hitAt(tx + ctx.rng.range(-0.6, 0.6), ty, tz + ctx.rng.range(-0.6, 0.6), amount);
    this.water -= amount;
  }
}
