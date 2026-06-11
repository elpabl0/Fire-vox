import * as THREE from 'three';
import { GRID, PARTICLES } from '../../config';
import { Rng } from '../../core/rng';
import { MATERIALS } from '../../world/materials';
import { FireSim } from '../../sim/fireSim';
import { VoxelGrid } from '../../world/voxelGrid';
import { Wind } from '../../sim/wind';
import { GpuParticleSystem } from './particleSystem';
import { createSmokeSystem, createDustSystem } from './smoke';

const { D, H } = GRID;

export function createFlameSystem(): GpuParticleSystem {
  return new GpuParticleSystem({
    capacity: PARTICLES.FLAME_MAX,
    blending: THREE.AdditiveBlending,
    colorA: new THREE.Color(0xffd27a),
    colorB: new THREE.Color(0xe83a10),
    sizeStart: 1.5,
    sizeEnd: 0.4,
    opacity: 0.85,
    buoyancy: 2.4,
    windFactor: 0.35,
    wobble: 0.25,
  });
}

export function createEmberSystem(): GpuParticleSystem {
  return new GpuParticleSystem({
    capacity: PARTICLES.EMBER_MAX,
    blending: THREE.AdditiveBlending,
    colorA: new THREE.Color(0xffc04a),
    colorB: new THREE.Color(0xb02808),
    sizeStart: 0.35,
    sizeEnd: 0.15,
    opacity: 1.0,
    buoyancy: -1.2, // rises on initial velocity, then sinks
    windFactor: 1.6,
    wobble: 0.6,
  });
}

/**
 * Samples a random subset of burning voxels each frame and emits flame, smoke
 * and ember particles from them — emission cost is bounded regardless of fire size.
 */
export class FireFx {
  readonly smoke = createSmokeSystem();
  readonly flame = createFlameSystem();
  readonly ember = createEmberSystem();
  readonly dust = createDustSystem();
  private sampleScratch = new Int32Array(8192);

  constructor(
    private grid: VoxelGrid,
    private fire: FireSim,
    private wind: Wind,
    private rng: Rng,
    scene: THREE.Scene,
  ) {
    scene.add(this.smoke.points);
    scene.add(this.flame.points);
    scene.add(this.ember.points);
    scene.add(this.dust.points);
  }

  update(time: number, dt: number): void {
    const active = this.fire.activeFire;
    if (active.size > 0) {
      // copy the active set into scratch for random sampling
      let n = 0;
      for (const idx of active) {
        if (n >= this.sampleScratch.length) break;
        this.sampleScratch[n++] = idx;
      }
      const samples = Math.min(PARTICLES.EMIT_SAMPLES, n);
      for (let s = 0; s < samples; s++) {
        const idx = this.sampleScratch[Math.floor(this.rng.next() * n)];
        const x = Math.floor(idx / (D * H)) + this.rng.range(0.1, 0.9);
        const z = (Math.floor(idx / H) % D) + this.rng.range(0.1, 0.9);
        const y = (idx % H) + 1;
        const smokeRate = MATERIALS[this.grid.material[idx]].smokeRate;
        // flames: short-lived, rising
        if (this.rng.chance(0.75)) {
          this.flame.spawn(time, x, y - this.rng.range(0, 0.6), z, this.rng.range(-0.3, 0.3), this.rng.range(0.8, 1.8), this.rng.range(-0.3, 0.3), this.rng.range(0.35, 0.8), this.rng.range(0.7, 1.4), this.rng.next());
        }
        // smoke: long-lived, wind-drifted columns
        if (this.rng.chance(0.55 * smokeRate)) {
          this.smoke.spawn(time, x, y + 0.4, z, this.rng.range(-0.4, 0.4), this.rng.range(1.2, 2.4), this.rng.range(-0.4, 0.4), this.rng.range(2.5, 5.0), this.rng.range(0.8, 1.6), this.rng.next());
        }
        // embers: occasional sparks blown downwind
        if (this.rng.chance(0.08 * this.wind.strength + 0.02)) {
          this.ember.spawn(
            time,
            x,
            y,
            z,
            this.wind.dirX * this.wind.strength * 4 + this.rng.range(-1, 1),
            this.rng.range(2, 5),
            this.wind.dirZ * this.wind.strength * 4 + this.rng.range(-1, 1),
            this.rng.range(0.8, 1.8),
            1,
            this.rng.next(),
          );
        }
      }
    }
    void dt;
    this.smoke.update(time, this.wind.dirX * this.wind.strength * 3, this.wind.dirZ * this.wind.strength * 3);
    this.flame.update(time, this.wind.dirX * this.wind.strength * 2, this.wind.dirZ * this.wind.strength * 2);
    this.ember.update(time, this.wind.dirX * this.wind.strength * 4, this.wind.dirZ * this.wind.strength * 4);
    this.dust.update(time, 0, 0);
  }

  /** Dust puff for collapsing voxels. */
  puffAt(time: number, x: number, y: number, z: number): void {
    for (let i = 0; i < 4; i++) {
      this.dust.spawn(time, x + 0.5, y + 0.5, z + 0.5, this.rng.range(-1.2, 1.2), this.rng.range(0.3, 1.2), this.rng.range(-1.2, 1.2), this.rng.range(0.8, 1.6), this.rng.range(0.8, 1.5), this.rng.next());
    }
  }
}
