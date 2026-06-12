import { GRID, UNITS } from '../config';
import { Flag, Mat } from '../world/materials';
import { FirefighterState, UnitBase, UnitContext } from './unit';
import type { Engine } from './engine';

const { D, H } = GRID;

/**
 * Crew member carried by an engine. Deploys on foot while the engine fights,
 * claims its own perimeter target through the coordinator, and sprays a hand
 * line fed from the engine's tank (tethered by hose length).
 */
export class Firefighter extends UnitBase {
  readonly kind = 'firefighter' as const;
  readonly name = 'Firefighter';
  deployed = false;
  private _state: FirefighterState = 'riding';
  private retargetIn = 0;

  constructor(private engine: Engine) {
    super({
      speed: UNITS.FIREFIGHTER.speed,
      hoseRange: UNITS.FIREFIGHTER.hoseRange,
      hosePower: UNITS.FIREFIGHTER.hosePower,
      waterMax: 0,
      refillRate: 0,
    });
    this.x = engine.x;
    this.z = engine.z;
  }

  get state(): string {
    return this._state;
  }

  orderTo(): void {
    // crew is not directly ordered; it follows its engine
  }

  update(dt: number, ctx: UnitContext): void {
    const e = this.engine;
    const shouldDeploy = e.state === 'fighting' && e.water > 2;
    if (!shouldDeploy) {
      this.spraying = false;
      if (this.deployed) {
        this._state = 'returning';
        if (this.walkToward(e.x, e.z, dt, ctx) || Math.hypot(e.x - this.x, e.z - this.z) < 1.2) {
          this.deployed = false;
          this._state = 'riding';
          ctx.releaseTarget(this);
        }
      } else {
        this.x = e.x;
        this.z = e.z;
        this.targetVoxel = -1;
      }
      return;
    }
    if (!this.deployed) {
      this.deployed = true;
      this._state = 'moving';
      // hop off beside the truck
      this.x = e.x + Math.cos(e.heading + Math.PI / 2) * 1.2;
      this.z = e.z + Math.sin(e.heading + Math.PI / 2) * 1.2;
    }
    this.assignedCluster = e.assignedCluster;

    // validate / acquire own claim (reach: tether from the engine + hand-line range)
    if (this.targetVoxel >= 0 && !(ctx.grid.flags[this.targetVoxel] & Flag.BURNING)) {
      ctx.releaseTarget(this);
    }
    if (this.targetVoxel < 0) {
      this.spraying = false;
      this.retargetIn -= dt;
      if (this.retargetIn > 0) return;
      this.retargetIn = 0.6;
      // claims are measured from the ENGINE so the tether stays satisfiable
      const saveX = this.x;
      const saveZ = this.z;
      this.x = e.x;
      this.z = e.z;
      ctx.requestTarget(this, UNITS.FIREFIGHTER.tether + this.stats.hoseRange - 1);
      this.x = saveX;
      this.z = saveZ;
      if (this.targetVoxel < 0) return;
    }
    const tx = Math.floor(this.targetVoxel / (D * H));
    const tz = Math.floor(this.targetVoxel / H) % D;
    const ty = this.targetVoxel % H;
    const dist = Math.hypot(tx - this.x, tz - this.z);
    if (dist > this.stats.hoseRange - 0.5) {
      this._state = 'moving';
      this.spraying = false;
      this.walkToward(tx, tz, dt, ctx);
      return;
    }
    // in range: spray from the engine's tank
    this._state = 'spraying';
    this.heading = Math.atan2(tz - this.z, tx - this.x);
    this.spraying = true;
    const amount = Math.min(this.stats.hosePower * dt, e.water);
    if (amount <= 0) {
      this.spraying = false;
      return;
    }
    e.water -= amount;
    ctx.water.hitAt(tx + ctx.rng.range(-0.4, 0.4), ty, tz + ctx.rng.range(-0.4, 0.4), amount);
  }

  /** Foot movement constrained to open ground cells and the hose tether. Returns true on arrival. */
  private walkToward(tx: number, tz: number, dt: number, ctx: UnitContext): boolean {
    const dx = tx - this.x;
    const dz = tz - this.z;
    const dist = Math.hypot(dx, dz);
    const step = this.stats.speed * dt;
    if (dist <= step) return true;
    let nx = this.x + (dx / dist) * step;
    let nz = this.z + (dz / dist) * step;
    // hose tether to the engine
    const e = this.engine;
    const tetherD = Math.hypot(nx - e.x, nz - e.z);
    if (tetherD > UNITS.FIREFIGHTER.tether) return false;
    // walkable check with axis sliding
    if (!this.walkable(nx, nz, ctx)) {
      if (this.walkable(nx, this.z, ctx)) nz = this.z;
      else if (this.walkable(this.x, nz, ctx)) nx = this.x;
      else return false;
    }
    this.heading = Math.atan2(nz - this.z, nx - this.x);
    this.x = nx;
    this.z = nz;
    return false;
  }

  private walkable(x: number, z: number, ctx: UnitContext): boolean {
    const vx = Math.round(x);
    const vz = Math.round(z);
    if (vx < 0 || vx >= GRID.W || vz < 0 || vz >= GRID.D) return false;
    const top = ctx.grid.topY(vx, vz);
    if (top !== 0) return false; // only open ground (no buildings/cars/rubble)
    return ctx.grid.material[ctx.grid.idx(vx, 0, vz)] !== Mat.WATER;
  }
}
