import { GRID, UNITS } from '../config';
import { HeliState, UnitBase, UnitContext, UnitStats } from './unit';

const { D, H } = GRID;

/**
 * Free-flying water bomber: fills at the pond, drops on the hottest core of its
 * assigned cluster — complementing road-bound engines that work the perimeter.
 * Returns to the HQ pad and lands when there is nothing to fight.
 */
export class Helicopter extends UnitBase {
  readonly kind = 'helicopter' as const;
  readonly name = 'Helicopter';
  private _state: HeliState = 'landed';
  private dropTimer = 0;
  /** Rotor speed factor for the renderer (spins down when landed). */
  rotorSpeed = 0;
  cruiseY = UNITS.HELICOPTER.altitude;
  /** Assigned helipad on the HQ roof (falls back to the station door). */
  pad: { x: number; z: number; y: number } | null = null;
  private targetY = 1.2;

  constructor(stats: UnitStats) {
    super(stats);
    this.y = 1.2;
  }

  get state(): string {
    return this._state;
  }

  orderTo(x: number, z: number, ctx: UnitContext): void {
    const cluster = ctx.clusters.nearestCluster(x, z);
    this.assignedCluster = cluster ? cluster.id : -1;
    if (this.assignedCluster >= 0) {
      this.orderedTarget = { x, z };
      this._state = this.water > 0 ? 'toFire' : 'toWater';
    }
  }

  update(dt: number, ctx: UnitContext): void {
    const cluster = ctx.clusters.byId(this.assignedCluster);
    const airborne = this._state !== 'landed';
    this.targetY = airborne ? this.cruiseY : this.pad ? this.pad.y + 0.35 : 1.2;
    this.y += (this.targetY - this.y) * Math.min(1, dt * 1.6);
    const rotorTarget = airborne ? 1 : 0;
    this.rotorSpeed += (rotorTarget - this.rotorSpeed) * Math.min(1, dt * 0.8);

    switch (this._state) {
      case 'landed':
        this.spraying = false;
        if (cluster && cluster.size > 0) this._state = this.water > 0 ? 'toFire' : 'toWater';
        break;
      case 'idle':
      case 'toBase':
        this.spraying = false;
        this._state = 'toBase';
        if (cluster && cluster.size > 0) {
          this._state = this.water > 0 ? 'toFire' : 'toWater';
          break;
        }
        if (this.moveToward(this.pad ? this.pad.x : ctx.stationDoor.x, this.pad ? this.pad.z : ctx.stationDoor.z, dt)) {
          this._state = 'landed';
          this.orderedTarget = null;
        }
        break;
      case 'toWater':
        if (this.moveToward(ctx.pond.x, ctx.pond.z, dt)) this._state = 'filling';
        break;
      case 'filling':
        this.water = Math.min(this.stats.waterMax, this.water + UNITS.HELICOPTER.fillRate * dt);
        if (this.water >= this.stats.waterMax) {
          if (cluster && cluster.size > 0) {
            this._state = 'toFire';
          } else {
            this.assignedCluster = -1;
            this._state = 'toBase';
          }
        }
        break;
      case 'toFire': {
        if (!cluster || cluster.size === 0) {
          this.assignedCluster = -1;
          this._state = 'toBase';
          break;
        }
        const core = cluster.coreIdx;
        const tx = core >= 0 ? Math.floor(core / (D * H)) : cluster.cx;
        const tz = core >= 0 ? Math.floor(core / H) % D : cluster.cz;
        if (this.moveToward(tx, tz, dt)) {
          this._state = 'dropping';
          this.dropTimer = 0.8;
          this.orderedTarget = null;
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
          if (cluster && cluster.size > 0) {
            this._state = 'toWater';
          } else {
            this.assignedCluster = -1;
            this._state = 'toBase';
          }
        }
        break;
    }
  }
}
