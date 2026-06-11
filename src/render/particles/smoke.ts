import * as THREE from 'three';
import { PARTICLES } from '../../config';
import { GpuParticleSystem } from './particleSystem';

export function createSmokeSystem(): GpuParticleSystem {
  return new GpuParticleSystem({
    capacity: PARTICLES.SMOKE_MAX,
    blending: THREE.NormalBlending,
    colorA: new THREE.Color(0x4a4540),
    colorB: new THREE.Color(0x8d8a86),
    sizeStart: 0.7,
    sizeEnd: 3.4,
    opacity: 0.34,
    buoyancy: 1.6,
    windFactor: 0.9,
    wobble: 0.8,
  });
}

export function createDustSystem(): GpuParticleSystem {
  return new GpuParticleSystem({
    capacity: 600,
    blending: THREE.NormalBlending,
    colorA: new THREE.Color(0x9a8d78),
    colorB: new THREE.Color(0x6d655a),
    sizeStart: 1.2,
    sizeEnd: 2.6,
    opacity: 0.5,
    buoyancy: 0.4,
    windFactor: 0.3,
    wobble: 0.3,
  });
}
