import * as THREE from 'three';

export interface ParticleSystemOptions {
  capacity: number;
  blending: THREE.Blending;
  /** Colour at birth -> colour at death. */
  colorA: THREE.Color;
  colorB: THREE.Color;
  sizeStart: number;
  sizeEnd: number;
  opacity: number;
  /** Vertical acceleration (buoyancy > 0, gravity < 0) applied as 0.5*a*t^2. */
  buoyancy: number;
  /** How strongly wind drift accelerates the particle (xz). */
  windFactor: number;
  /** Lateral wobble amplitude. */
  wobble: number;
  depthWrite?: boolean;
}

/**
 * Pooled GPU-animated point particles: a ring buffer where the CPU only writes
 * spawns; motion (velocity, buoyancy, wind drift, wobble) and fading are
 * integrated in the vertex shader from per-particle attributes.
 */
export class GpuParticleSystem {
  readonly points: THREE.Points;
  private positions: Float32Array;
  private velocities: Float32Array;
  private births: Float32Array;
  private lives: Float32Array;
  private sizes: Float32Array;
  private seeds: Float32Array;
  private head = 0;
  private capacity: number;
  private material: THREE.ShaderMaterial;
  private geometry: THREE.BufferGeometry;
  private dirty = false;

  constructor(opts: ParticleSystemOptions) {
    this.capacity = opts.capacity;
    this.positions = new Float32Array(opts.capacity * 3);
    this.velocities = new Float32Array(opts.capacity * 3);
    this.births = new Float32Array(opts.capacity).fill(-1e9);
    this.lives = new Float32Array(opts.capacity).fill(1);
    this.sizes = new Float32Array(opts.capacity);
    this.seeds = new Float32Array(opts.capacity);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aVel', new THREE.BufferAttribute(this.velocities, 3));
    this.geometry.setAttribute('aBirth', new THREE.BufferAttribute(this.births, 1));
    this.geometry.setAttribute('aLife', new THREE.BufferAttribute(this.lives, 1));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute('aSeed', new THREE.BufferAttribute(this.seeds, 1));
    // particles move far from their spawn point; skip frustum culling
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(64, 16, 64), 1e6);

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: opts.depthWrite ?? false,
      blending: opts.blending,
      uniforms: {
        uTime: { value: 0 },
        uWind: { value: new THREE.Vector2(0, 0) },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        uColorA: { value: opts.colorA },
        uColorB: { value: opts.colorB },
        uSizeStart: { value: opts.sizeStart },
        uSizeEnd: { value: opts.sizeEnd },
        uOpacity: { value: opts.opacity },
        uBuoyancy: { value: opts.buoyancy },
        uWindFactor: { value: opts.windFactor },
        uWobble: { value: opts.wobble },
      },
      vertexShader: /* glsl */ `
        uniform float uTime, uPixelRatio, uSizeStart, uSizeEnd, uBuoyancy, uWindFactor, uWobble;
        uniform vec2 uWind;
        attribute vec3 aVel;
        attribute float aBirth, aLife, aSize, aSeed;
        varying float vT;
        void main() {
          float age = uTime - aBirth;
          float t = clamp(age / aLife, 0.0, 1.0);
          vT = t;
          vec3 pos = position + aVel * age;
          pos.y += 0.5 * uBuoyancy * age * age;
          pos.xz += uWind * uWindFactor * age * age;
          pos.x += sin(aSeed * 6.2832 + age * 2.1) * uWobble * t;
          pos.z += cos(aSeed * 4.7124 + age * 1.7) * uWobble * t;
          vec4 mv = modelViewMatrix * vec4(pos, 1.0);
          float size = aSize * mix(uSizeStart, uSizeEnd, t);
          bool dead = age < 0.0 || age >= aLife;
          gl_PointSize = dead ? 0.0 : size * uPixelRatio * (420.0 / -mv.z);
          gl_Position = dead ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColorA, uColorB;
        uniform float uOpacity;
        varying float vT;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          float alpha = smoothstep(0.5, 0.12, d) * uOpacity * (1.0 - vT * vT);
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(mix(uColorA, uColorB, vT), alpha);
        }
      `,
    });

    this.points = new THREE.Points(this.geometry, this.material);
  }

  spawn(
    time: number,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size: number,
    seed: number,
  ): void {
    const i = this.head;
    this.head = (this.head + 1) % this.capacity;
    this.positions[i * 3] = x;
    this.positions[i * 3 + 1] = y;
    this.positions[i * 3 + 2] = z;
    this.velocities[i * 3] = vx;
    this.velocities[i * 3 + 1] = vy;
    this.velocities[i * 3 + 2] = vz;
    this.births[i] = time;
    this.lives[i] = life;
    this.sizes[i] = size;
    this.seeds[i] = seed;
    this.dirty = true;
  }

  update(time: number, windX: number, windZ: number): void {
    this.material.uniforms.uTime.value = time;
    (this.material.uniforms.uWind.value as THREE.Vector2).set(windX, windZ);
    if (this.dirty) {
      this.dirty = false;
      for (const name of ['position', 'aVel', 'aBirth', 'aLife', 'aSize', 'aSeed']) {
        (this.geometry.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
      }
    }
  }
}
