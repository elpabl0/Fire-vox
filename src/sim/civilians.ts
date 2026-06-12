import { CIVILIANS, GRID } from '../config';
import { Rng } from '../core/rng';
import { Mat } from '../world/materials';
import { RoadNetwork } from '../world/roadGraph';
import { VoxelGrid } from '../world/voxelGrid';
import { FireClusterizer } from './fireClusters';
import { UnitBase } from '../units/unit';

const { W, D } = GRID;
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export interface CivilianCar {
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  speed: number;
  heading: number;
  state: 'drive' | 'pullover' | 'flee';
  color: number;
  /** Progress to the next cell decision point. */
  cellX: number;
  cellZ: number;
  /** Seconds spent (almost) stationary while wanting to move — gridlock escape. */
  blockedFor: number;
}

export interface Pedestrian {
  x: number;
  z: number;
  tx: number;
  tz: number;
  heading: number;
  state: 'walk' | 'pause' | 'flee' | 'gawk';
  timer: number;
  color: number;
}

const CAR_COLORS = [0x8899aa, 0x556677, 0xaa6655, 0x668866, 0x99774d, 0x777788, 0xb0b4b8, 0x4d6680];
const PED_COLORS = [0x6b7a8a, 0x8a6b6b, 0x6b8a72, 0x8a826b, 0x726b8a, 0x5d6d7d];

/**
 * Ambient city life: cars cruise the road network and pedestrians wander the
 * sidewalks. Both flee from nearby fire (some pedestrians stop to gawk from a
 * safe distance), and cars pull over for responding engines.
 */
export class CivilianManager {
  readonly cars: CivilianCar[] = [];
  readonly peds: Pedestrian[] = [];

  constructor(
    private grid: VoxelGrid,
    private roads: RoadNetwork,
    private clusters: FireClusterizer,
    private rng: Rng,
  ) {
    // spawn cars on random road cells
    const roadCells: number[] = [];
    for (let c = 0; c < W * D; c++) if (roads.isRoad[c]) roadCells.push(c);
    for (let i = 0; i < CIVILIANS.CARS && roadCells.length > 0; i++) {
      const c = rng.pick(roadCells);
      const x = Math.floor(c / D);
      const z = c % D;
      const dir = this.pickDirection(x, z, 0, 0);
      if (!dir) continue;
      this.cars.push({
        x,
        z,
        dirX: dir[0],
        dirZ: dir[1],
        speed: 0,
        heading: Math.atan2(dir[1], dir[0]),
        state: 'drive',
        color: rng.pick(CAR_COLORS),
        cellX: x,
        cellZ: z,
        blockedFor: 0,
      });
    }
    // spawn pedestrians on walkable cells
    for (let i = 0; i < CIVILIANS.PEDESTRIANS; i++) {
      for (let attempt = 0; attempt < 40; attempt++) {
        const x = rng.int(1, W - 2);
        const z = rng.int(1, D - 2);
        if (!this.walkable(x, z)) continue;
        this.peds.push({ x, z, tx: x, tz: z, heading: 0, state: 'pause', timer: rng.range(0, 2), color: rng.pick(PED_COLORS) });
        break;
      }
    }
  }

  update(dt: number, engines: UnitBase[]): void {
    for (const car of this.cars) this.updateCar(car, dt, engines);
    for (const ped of this.peds) this.updatePed(ped, dt);
  }

  private nearestFire(x: number, z: number): { d: number; cx: number; cz: number } | null {
    let best: { d: number; cx: number; cz: number } | null = null;
    for (const c of this.clusters.clusters) {
      const d = Math.hypot(c.cx - x, c.cz - z);
      if (!best || d < best.d) best = { d, cx: c.cx, cz: c.cz };
    }
    return best;
  }

  // --- cars ---

  private updateCar(car: CivilianCar, dt: number, engines: UnitBase[]): void {
    // sirens override everything: pull over for responding engines, even mid-panic
    let engineNear = false;
    for (const e of engines) {
      if (e.kind !== 'engine') continue;
      if (e.state !== 'dispatching' && e.state !== 'returning' && e.state !== 'repositioning') continue;
      if (Math.hypot(e.x - car.x, e.z - car.z) < CIVILIANS.PULLOVER_RADIUS) {
        engineNear = true;
        break;
      }
    }
    if (engineNear) {
      car.state = 'pullover';
    } else if (car.state === 'pullover') {
      car.state = 'drive';
    }

    const fire = this.nearestFire(car.x, car.z);
    if (fire && fire.d < CIVILIANS.FLEE_RADIUS && car.state === 'drive') {
      car.state = 'flee';
      // drive away: reverse if currently heading toward the fire
      const towardFire = (fire.cx - car.x) * car.dirX + (fire.cz - car.z) * car.dirZ > 0;
      if (towardFire) {
        car.dirX = -car.dirX;
        car.dirZ = -car.dirZ;
      }
    } else if (car.state === 'flee' && (!fire || fire.d > CIVILIANS.FLEE_RADIUS * 2)) {
      car.state = 'drive';
    }

    let targetSpeed = car.state === 'pullover' ? 0 : car.state === 'flee' ? CIVILIANS.CAR_SPEED * 1.6 : CIVILIANS.CAR_SPEED;

    // collision avoidance: queue behind any vehicle/engine occupying the road ahead.
    // Stopped leaders propagate stops backwards — that's where traffic jams come from.
    const blocker = this.vehicleAhead(car, engines);
    if (blocker !== null) {
      targetSpeed = Math.min(targetSpeed, blocker);
    }

    if (car.speed < targetSpeed) car.speed = Math.min(targetSpeed, car.speed + CIVILIANS.CAR_ACCEL * dt);
    else car.speed = Math.max(targetSpeed, car.speed - CIVILIANS.CAR_ACCEL * 3 * dt);

    // gridlock escape: blocked too long -> turn around
    if (car.state !== 'pullover' && targetSpeed < 0.3 && blocker !== null) {
      car.blockedFor += dt;
      if (car.blockedFor > CIVILIANS.BLOCKED_TURNAROUND_S) {
        car.blockedFor = 0;
        car.dirX = -car.dirX;
        car.dirZ = -car.dirZ;
      }
    } else if (car.speed > 0.5) {
      car.blockedFor = 0;
    }
    if (car.speed < 0.05) return;

    // advance along the current direction; decide at cell centres
    const nx = car.x + car.dirX * car.speed * dt;
    const nz = car.z + car.dirZ * car.speed * dt;
    const cellX = Math.round(nx);
    const cellZ = Math.round(nz);
    if (cellX !== car.cellX || cellZ !== car.cellZ) {
      // entering a new cell: keep going if it's road, otherwise turn
      if (this.isRoad(cellX, cellZ)) {
        car.cellX = cellX;
        car.cellZ = cellZ;
      } else {
        const dir = this.pickDirection(car.cellX, car.cellZ, -car.dirX, -car.dirZ);
        if (dir) {
          car.dirX = dir[0];
          car.dirZ = dir[1];
        } else {
          car.dirX = -car.dirX;
          car.dirZ = -car.dirZ;
        }
        return;
      }
    }
    car.x = nx;
    car.z = nz;
    const desired = Math.atan2(car.dirZ, car.dirX);
    let d = (desired - car.heading) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    car.heading += d * Math.min(1, dt * 6);
    // occasional random turn at intersections
    if (this.rng.chance(dt * 0.15)) {
      const dir = this.pickDirection(Math.round(car.x), Math.round(car.z), -car.dirX, -car.dirZ);
      if (dir) {
        car.dirX = dir[0];
        car.dirZ = dir[1];
      }
    }
  }

  /**
   * Speed limit imposed by traffic ahead of this car, or null if the lane is
   * clear. Cars match a moving leader's speed and stop short of a stationary
   * one (including fire engines blocking the road).
   */
  private vehicleAhead(car: CivilianCar, engines: UnitBase[]): number | null {
    let limit: number | null = null;
    const consider = (ox: number, oz: number, oSpeed: number) => {
      const dx = ox - car.x;
      const dz = oz - car.z;
      const ahead = dx * car.dirX + dz * car.dirZ;
      if (ahead < 0.3 || ahead > CIVILIANS.FOLLOW_GAP + 1.5) return;
      const lateral = Math.abs(dx * -car.dirZ + dz * car.dirX);
      if (lateral > 0.9) return;
      const v = ahead < CIVILIANS.FOLLOW_GAP ? 0 : Math.max(0, oSpeed * 0.9);
      limit = limit === null ? v : Math.min(limit, v);
    };
    for (const other of this.cars) {
      if (other === car) continue;
      consider(other.x, other.z, other.speed);
    }
    for (const e of engines) {
      if (e.kind !== 'engine') continue;
      consider(e.x, e.z, 0);
    }
    return limit;
  }

  private isRoad(x: number, z: number): boolean {
    return x >= 0 && x < W && z >= 0 && z < D && this.roads.isRoad[x * D + z] === 1;
  }

  /** Pick a road direction from (x,z), avoiding (banX,banZ) (the way we came) when possible. */
  private pickDirection(x: number, z: number, banX: number, banZ: number): readonly [number, number] | null {
    const options: Array<readonly [number, number]> = [];
    for (const d of DIRS) {
      if (!this.isRoad(x + d[0] * 2, z + d[1] * 2)) continue;
      if (d[0] === banX && d[1] === banZ) continue;
      options.push(d);
    }
    if (options.length === 0) return this.isRoad(x + banX * 2, z + banZ * 2) ? [banX, banZ] : null;
    return this.rng.pick(options);
  }

  // --- pedestrians ---

  private updatePed(ped: Pedestrian, dt: number): void {
    const fire = this.nearestFire(ped.x, ped.z);
    if (fire && fire.d < CIVILIANS.FLEE_RADIUS && ped.state !== 'flee') {
      ped.state = 'flee';
      const away = Math.atan2(ped.z - fire.cz, ped.x - fire.cx);
      ped.tx = ped.x + Math.cos(away) * 25;
      ped.tz = ped.z + Math.sin(away) * 25;
    }
    switch (ped.state) {
      case 'pause':
        ped.timer -= dt;
        if (ped.timer <= 0) this.newWanderTarget(ped);
        break;
      case 'walk': {
        if (this.step(ped, CIVILIANS.PED_SPEED, dt)) {
          ped.state = 'pause';
          ped.timer = this.rng.range(0.5, 4);
        }
        break;
      }
      case 'flee': {
        const arrived = this.step(ped, CIVILIANS.PED_FLEE_SPEED, dt);
        const nowFire = fire ?? this.nearestFire(ped.x, ped.z);
        const safe = !nowFire || nowFire.d > CIVILIANS.GAWK_RADIUS;
        if (arrived || safe) {
          if (nowFire && nowFire.d < CIVILIANS.GAWK_RADIUS * 2 && this.rng.chance(CIVILIANS.GAWK_CHANCE)) {
            ped.state = 'gawk';
            ped.heading = Math.atan2(nowFire.cz - ped.z, nowFire.cx - ped.x); // face the fire
          } else {
            ped.state = 'pause';
            ped.timer = this.rng.range(1, 3);
          }
        }
        break;
      }
      case 'gawk': {
        const nowFire = this.nearestFire(ped.x, ped.z);
        if (!nowFire || nowFire.d > CIVILIANS.GAWK_RADIUS * 2) {
          ped.state = 'pause';
          ped.timer = 1;
        } else if (nowFire.d < CIVILIANS.FLEE_RADIUS) {
          ped.state = 'flee'; // it's getting closer — run!
          const away = Math.atan2(ped.z - nowFire.cz, ped.x - nowFire.cx);
          ped.tx = ped.x + Math.cos(away) * 25;
          ped.tz = ped.z + Math.sin(away) * 25;
        } else {
          ped.heading = Math.atan2(nowFire.cz - ped.z, nowFire.cx - ped.x);
        }
        break;
      }
    }
  }

  private newWanderTarget(ped: Pedestrian): void {
    for (let attempt = 0; attempt < 8; attempt++) {
      const tx = ped.x + this.rng.range(-8, 8);
      const tz = ped.z + this.rng.range(-8, 8);
      if (this.walkable(Math.round(tx), Math.round(tz))) {
        ped.tx = tx;
        ped.tz = tz;
        ped.state = 'walk';
        return;
      }
    }
    ped.timer = 1;
  }

  /** Step toward the target across walkable cells; true when arrived/blocked. */
  private step(ped: Pedestrian, speed: number, dt: number): boolean {
    const dx = ped.tx - ped.x;
    const dz = ped.tz - ped.z;
    const dist = Math.hypot(dx, dz);
    const stepLen = speed * dt;
    if (dist <= stepLen) return true;
    let nx = ped.x + (dx / dist) * stepLen;
    let nz = ped.z + (dz / dist) * stepLen;
    if (!this.walkable(Math.round(nx), Math.round(nz))) {
      if (this.walkable(Math.round(nx), Math.round(ped.z))) nz = ped.z;
      else if (this.walkable(Math.round(ped.x), Math.round(nz))) nx = ped.x;
      else return true; // cornered — give up on this target
    }
    ped.heading = Math.atan2(nz - ped.z, nx - ped.x);
    ped.x = nx;
    ped.z = nz;
    return false;
  }

  private walkable(x: number, z: number): boolean {
    if (x < 1 || x >= W - 1 || z < 1 || z >= D - 1) return false;
    if (this.grid.topY(x, z) !== 0) return false;
    const mat = this.grid.material[this.grid.idx(x, 0, z)];
    return mat === Mat.SIDEWALK || mat === Mat.GRASS || mat === Mat.DIRT;
  }
}
