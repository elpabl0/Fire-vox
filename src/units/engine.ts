import { GRID, UNITS } from '../config';
import { lerpAngle } from '../core/math';
import { Flag } from '../world/materials';
import { Firefighter } from './firefighter';
import { findRoadPath, PathPoint } from './pathfinding';
import { EngineState, UnitBase, UnitContext, UnitStats } from './unit';

const { D, H } = GRID;

function angleDelta(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Road-bound fire engine with simple driving physics: acceleration/braking,
 * a speed-limited turning circle, and grip lag that makes fast corners drift
 * (leaving tyre tracks). Dispatch is player-driven; idle engines only
 * self-engage fires in close proximity.
 */
export class Engine extends UnitBase {
  readonly kind = 'engine' as const;
  name: string;
  /** Deployable crew using the engine's tank (granted by the Crew upgrade). */
  readonly crew: Firefighter[] = [];
  /** True while the chassis slides — the renderer drops tyre tracks. */
  drifting = false;

  private _state: EngineState = 'idle';
  private path: PathPoint[] | null = null;
  /** Cumulative length at each path vertex. */
  private cumLen: number[] = [];
  /** Distance travelled along the path. */
  private s = 0;
  private destination: 'fire' | 'station' = 'fire';
  private retargetIn = 0;
  private engageCheckIn = 0;
  /** Current scalar speed and the direction the chassis actually travels. */
  private speedCur = 0;
  private travelAngle = 0;

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
    this.orderedTarget = { x, z };
    this.driveTo(x, z, ctx, 'fire');
  }

  /** Coordinator/local auto-assignment (not a player order — no beacon). */
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
    // prepend the actual position so the drive starts from where we stand
    this.path = [{ x: this.x, z: this.z }, ...path];
    this.cumLen = [0];
    for (let i = 1; i < this.path.length; i++) {
      const a = this.path[i - 1];
      const b = this.path[i];
      this.cumLen.push(this.cumLen[i - 1] + Math.hypot(b.x - a.x, b.z - a.z));
    }
    this.s = 0;
    this.destination = destination;
    this._state = destination === 'station' ? 'returning' : 'dispatching';
    this.spraying = false;
  }

  update(dt: number, ctx: UnitContext): void {
    switch (this._state) {
      case 'idle':
        this.spraying = false;
        this.coast(dt);
        this.checkLocalEngage(dt, ctx);
        break;
      case 'dispatching':
      case 'returning':
      case 'repositioning':
        this.drive(dt, ctx);
        break;
      case 'fighting':
        this.coast(dt);
        this.fight(dt, ctx);
        break;
      case 'refilling':
        this.coast(dt);
        this.water = Math.min(this.stats.waterMax, this.water + this.stats.refillRate * dt);
        if (this.water >= this.stats.waterMax) {
          this._state = 'idle';
        }
        break;
    }
    for (const ff of this.crew) ff.update(dt, ctx);
  }

  /** Roll to a stop when not driving. */
  private coast(dt: number): void {
    this.drifting = false;
    if (this.speedCur > 0) {
      this.speedCur = Math.max(0, this.speedCur - UNITS.ENGINE.brake * dt);
      this.x += Math.cos(this.travelAngle) * this.speedCur * dt;
      this.z += Math.sin(this.travelAngle) * this.speedCur * dt;
    }
  }

  /** Idle engines engage fires that break out in close proximity. */
  private checkLocalEngage(dt: number, ctx: UnitContext): void {
    this.engageCheckIn -= dt;
    if (this.engageCheckIn > 0) return;
    this.engageCheckIn = 1.0;
    const near = ctx.clusters.nearestBurning(this.x, this.z);
    if (near && near.dist <= UNITS.ENGINE.engageRadius) {
      this.assignCluster(near.cluster.id, near.cluster.cx, near.cluster.cz, ctx);
    }
  }

  /**
   * Path-distance driving: a speed profile (accelerate on straights, brake
   * into corners and the final stop) advances a scalar along the route, so
   * arrival is guaranteed. Heading chases the road tangent at a grip-limited
   * rate — when it lags at speed, the engine is drifting.
   */
  private drive(dt: number, ctx: UnitContext): void {
    if (!this.path || this.path.length < 2) {
      this.onArrived(ctx);
      return;
    }
    const total = this.cumLen[this.cumLen.length - 1];
    const remaining = total - this.s;
    const E = UNITS.ENGINE;

    // corner ahead: angle change at the next vertex and the distance to it
    let targetSpeed = this.stats.speed;
    const seg = this.segmentAt(this.s);
    if (seg.index + 1 < this.path.length - 1) {
      const distToCorner = this.cumLen[seg.index + 1] - this.s;
      const a = this.path[seg.index];
      const b = this.path[seg.index + 1];
      const c = this.path[seg.index + 2];
      const turn = Math.abs(angleDelta(Math.atan2(c.z - b.z, c.x - b.x), Math.atan2(b.z - a.z, b.x - a.x)));
      if (turn > 0.3) {
        const cornerSpeed = Math.max(2.6, this.stats.speed * (1 - turn / Math.PI) * 0.55);
        // brake so we reach the corner at cornerSpeed
        targetSpeed = Math.min(targetSpeed, Math.sqrt(cornerSpeed * cornerSpeed + 2 * E.brake * Math.max(0, distToCorner)));
      }
    }
    // brake to a stop at the end of the route
    targetSpeed = Math.min(targetSpeed, Math.sqrt(2 * E.brake * Math.max(0.04, remaining)));
    // ease off behind traffic (cars pull over for the siren; don't stall the response)
    if (ctx.obstacleAhead(this)) targetSpeed = Math.min(targetSpeed, 3.2);

    if (this.speedCur < targetSpeed) this.speedCur = Math.min(targetSpeed, this.speedCur + E.accel * dt);
    else this.speedCur = Math.max(targetSpeed, this.speedCur - E.brake * dt);

    this.s += this.speedCur * dt;
    if (this.s >= total) {
      const end = this.path[this.path.length - 1];
      this.x = end.x;
      this.z = end.z;
      this.onArrived(ctx);
      return;
    }
    const pos = this.sampleAt(this.s);
    this.x = pos.x;
    this.z = pos.z;

    // chassis heading chases the road tangent; grip drops with speed -> drift
    const tangent = pos.tangent;
    const gripRate = E.grip / (1 + Math.max(0, this.speedCur - 5.5) * 0.55);
    this.travelAngle = tangent;
    this.heading = lerpAngle(this.heading, tangent, Math.min(1, gripRate * dt));
    this.drifting = Math.abs(angleDelta(this.heading, tangent)) > 0.18 && this.speedCur > 4.2;
  }

  private segmentAt(s: number): { index: number } {
    for (let i = 1; i < this.cumLen.length; i++) {
      if (s <= this.cumLen[i]) return { index: i - 1 };
    }
    return { index: this.cumLen.length - 2 };
  }

  private sampleAt(s: number): { x: number; z: number; tangent: number } {
    const { index } = this.segmentAt(s);
    const a = this.path![index];
    const b = this.path![index + 1];
    const segLen = this.cumLen[index + 1] - this.cumLen[index] || 1;
    const t = (s - this.cumLen[index]) / segLen;
    return {
      x: a.x + (b.x - a.x) * t,
      z: a.z + (b.z - a.z) * t,
      tangent: Math.atan2(b.z - a.z, b.x - a.x),
    };
  }

  private onArrived(ctx: UnitContext): void {
    this.path = null;
    this.drifting = false;
    if (this.destination === 'station') {
      this._state = 'refilling';
    } else {
      this._state = 'fighting';
      this.retargetIn = 0;
      this.orderedTarget = null;
      void ctx;
    }
  }

  private fight(dt: number, ctx: UnitContext): void {
    if (this.water <= 0) {
      ctx.releaseTarget(this);
      this.spraying = false;
      const refill = ctx.nearestRefill(this.x, this.z);
      this.driveTo(refill.x, refill.z, ctx, 'station');
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
        // retry shortly — crew, spillover or the helicopter handle the core
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
