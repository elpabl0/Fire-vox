import { GRID, UNITS } from '../config';
import { HeliState, UnitBase, UnitContext, UnitStats } from './unit';

const { D, H } = GRID;

/**
 * Free-flying water bomber: fills at the pond, drops on the hottest core of its
 * assigned cluster — complementing road-bound engines that work the perimeter.
 */
export class Helicopter extends UnitBase {
  readonly kind = 'helicopter' as const;
  readonly name = 'Helicopter';
  private _state: HeliState = 'idle';
  private dropTimer = 0;
  cruiseY = UNITS.HELICOPTER.altitude;

  constructor(stats: UnitStats) {
    super(stats);
    this.y = this.cruiseY;
  }

  get state(): string {
    return this._state;
  }

  orderTo(x: number, z: number, ctx: UnitContext): void {
    const cluster = ctx.clusters.nearestCluster(x, z);
    this.assignedCluster = cluster ? cluster.id : -1;
    if (this.assignedCluster >= 0) {
      this._state = this.water > 0 ? 'toFire' : 'toWater';
    }
  }

  update(dt: number, ctx: UnitContext): void {
    this.y = this.cruiseY;
    const cluster = ctx.clusters.byId(this.assignedCluster);
    switch (this._state) {
      case 'idle':
        this.spraying = false;
        if (cluster && cluster.size > 0) {
          this._state = this.water > 0 ? 'toFire' : 'toWater';
        }
        break;
      case 'toWater':
        if (this.moveToward(ctx.pond.x, ctx.pond.z, dt)) this._state = 'filling';
        break;
      case 'filling':
        this.water = Math.min(this.stats.waterMax, this.water + UNITS.HELICOPTER.fillRate * dt);
        if (this.water >= this.stats.waterMax) {
          this._state = cluster && cluster.size > 0 ? 'toFire' : 'idle';
          if (this._state === 'idle') this.assignedCluster = -1;
        }
        break;
      case 'toFire': {
        if (!cluster || cluster.size === 0) {
          this.assignedCluster = -1;
          this._state = 'idle';
          break;
        }
        const core = cluster.coreIdx;
        const tx = core >= 0 ? Math.floor(core / (D * H)) : cluster.cx;
        const tz = core >= 0 ? Math.floor(core / H) % D : cluster.cz;
        if (this.moveToward(tx, tz, dt)) {
          this._state = 'dropping';
          this.dropTimer = 0.8;
        }
        break;
      }
      case 'dropping':
        this.spraying = true;
        this.dropTimer -= dt;
        if (this.dropTimer <= 0) {
          ctx.water.dropArea(this.x, this.z, UNITS.HELICOPTER.dropRadius, this.water);
          this.water = 0;
          this.spraying = false;
          this._state = cluster && cluster.size > 0 ? 'toWater' : 'idle';
          if (this._state === 'idle') this.assignedCluster = -1;
        }
        break;
    }
  }
}
