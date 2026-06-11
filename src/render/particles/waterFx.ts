import * as THREE from 'three';
import { GRID, PARTICLES } from '../../config';
import { ballisticVelocity } from '../../core/math';
import { Rng } from '../../core/rng';
import { UnitManager } from '../../units/unitManager';
import { GpuParticleSystem } from './particleSystem';

const { D, H } = GRID;
const GRAVITY = 14;

/**
 * Hose streams: CPU-integrated ballistic droplets so arcs follow real physics
 * and splash at the impact point. Purely visual — water *delivery* to the sim
 * is done by the units themselves (engine.fight / helicopter drop), keeping
 * gameplay deterministic and independent of the render path.
 */
export class WaterFx {
  private points: THREE.Points;
  private positions: Float32Array;
  private velocities: Float32Array;
  /** Remaining flight time; <= 0 means free slot. */
  private ttl: Float32Array;
  private head = 0;
  readonly splash: GpuParticleSystem;
  liveCount = 0;

  constructor(
    private units: UnitManager,
    private rng: Rng,
    scene: THREE.Scene,
  ) {
    const cap = PARTICLES.WATER_MAX;
    this.positions = new Float32Array(cap * 3);
    this.velocities = new Float32Array(cap * 3);
    this.ttl = new Float32Array(cap);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(64, 16, 64), 1e6);
    const material = new THREE.PointsMaterial({
      color: 0x9fd0ff,
      size: 3.5,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    });
    this.points = new THREE.Points(geometry, material);
    scene.add(this.points);

    this.splash = new GpuParticleSystem({
      capacity: PARTICLES.SPLASH_MAX,
      blending: THREE.NormalBlending,
      colorA: new THREE.Color(0xcfe8ff),
      colorB: new THREE.Color(0x9fc8e8),
      sizeStart: 0.9,
      sizeEnd: 1.8,
      opacity: 0.5,
      buoyancy: -6,
      windFactor: 0,
      wobble: 0.1,
    });
    scene.add(this.splash.points);
  }

  update(time: number, dt: number): void {
    // emit droplets from spraying units
    for (const unit of this.units.units) {
      if (!unit.spraying) continue;
      if (unit.kind === 'engine' && unit.targetVoxel >= 0) {
        const tx = Math.floor(unit.targetVoxel / (D * H)) + 0.5;
        const tz = (Math.floor(unit.targetVoxel / H) % D) + 0.5;
        const ty = (unit.targetVoxel % H) + 0.5;
        const arc = ballisticVelocity(unit.x, 2.0, unit.z, tx, ty, tz, GRAVITY, 3.5);
        const perFrame = Math.max(1, Math.round(dt * 240));
        for (let i = 0; i < perFrame; i++) {
          this.spawnDroplet(
            unit.x,
            2.0,
            unit.z,
            arc.vx + this.rng.range(-0.5, 0.5),
            arc.vy + this.rng.range(-0.3, 0.3),
            arc.vz + this.rng.range(-0.5, 0.5),
            arc.flightTime,
          );
        }
      } else if (unit.kind === 'helicopter') {
        // water curtain falling from the bucket
        const perFrame = Math.max(1, Math.round(dt * 300));
        for (let i = 0; i < perFrame; i++) {
          this.spawnDroplet(
            unit.x + this.rng.range(-1, 1),
            unit.y - 1,
            unit.z + this.rng.range(-1, 1),
            this.rng.range(-0.5, 0.5),
            -2,
            this.rng.range(-0.5, 0.5),
            2.2,
          );
        }
      }
    }
    // integrate
    let live = 0;
    for (let i = 0; i < this.ttl.length; i++) {
      if (this.ttl[i] <= 0) continue;
      this.ttl[i] -= dt;
      const o = i * 3;
      this.velocities[o + 1] -= GRAVITY * dt;
      this.positions[o] += this.velocities[o] * dt;
      this.positions[o + 1] += this.velocities[o + 1] * dt;
      this.positions[o + 2] += this.velocities[o + 2] * dt;
      if (this.ttl[i] <= 0 || this.positions[o + 1] < 0) {
        // impact: splash and retire (hide far below the map)
        this.splash.spawn(time, this.positions[o], Math.max(1, this.positions[o + 1]) + 0.3, this.positions[o + 2], this.rng.range(-1, 1), this.rng.range(0.5, 1.5), this.rng.range(-1, 1), this.rng.range(0.3, 0.6), 1, this.rng.next());
        this.ttl[i] = 0;
        this.positions[o + 1] = -100;
      } else {
        live++;
      }
    }
    this.liveCount = live;
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.splash.update(time, 0, 0);
  }

  private spawnDroplet(x: number, y: number, z: number, vx: number, vy: number, vz: number, ttl: number): void {
    const i = this.head;
    this.head = (this.head + 1) % this.ttl.length;
    const o = i * 3;
    this.positions[o] = x;
    this.positions[o + 1] = y;
    this.positions[o + 2] = z;
    this.velocities[o] = vx;
    this.velocities[o + 1] = vy;
    this.velocities[o + 2] = vz;
    this.ttl[i] = ttl;
  }
}
