import * as THREE from 'three';
import { GRID } from '../config';
import { VoxelGrid } from '../world/voxelGrid';
import { FireSim } from '../sim/fireSim';

const { W, D, H } = GRID;

/** Shared uniform: 0 = normal view, 1 = heat vision. Patched into scene materials. */
export const heatVisionUniform = { value: 0 };

/**
 * Heat-vision overlay: a map-aligned additive quad showing per-column max heat
 * through an inferno ramp. Reveals smouldering interiors before visible flame.
 */
export class HeatVisionOverlay {
  unlocked = false;
  enabled = false;
  private texture: THREE.DataTexture;
  private data: Uint8Array<ArrayBuffer>;
  private colMax = new Float32Array(W * D);
  private mesh: THREE.Mesh;
  private fade = 0;

  constructor(
    private grid: VoxelGrid,
    private fire: FireSim,
    scene: THREE.Scene,
  ) {
    this.data = new Uint8Array(W * D);
    this.texture = new THREE.DataTexture(this.data, W, D, THREE.RedFormat, THREE.UnsignedByteType);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.needsUpdate = true;

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uHeat: { value: this.texture },
        uOpacity: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uHeat;
        uniform float uOpacity;
        varying vec2 vUv;
        // inferno-ish ramp
        vec3 ramp(float t) {
          vec3 a = vec3(0.05, 0.02, 0.18);
          vec3 b = vec3(0.65, 0.12, 0.30);
          vec3 c = vec3(0.98, 0.55, 0.08);
          vec3 d = vec3(1.0, 0.98, 0.65);
          if (t < 0.33) return mix(a, b, t / 0.33);
          if (t < 0.66) return mix(b, c, (t - 0.33) / 0.33);
          return mix(c, d, (t - 0.66) / 0.34);
        }
        void main() {
          float h = texture2D(uHeat, vUv).r;
          if (h < 0.015) discard;
          gl_FragColor = vec4(ramp(h) * uOpacity, h * uOpacity);
        }
      `,
    });
    const geometry = new THREE.PlaneGeometry(W, D);
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.rotation.x = -Math.PI / 2;
    // plane UVs after rotation: u → +x, v → -z, so flip handled in writeTexture
    this.mesh.position.set(W / 2, H + 1.5, D / 2);
    this.mesh.visible = false;
    this.mesh.renderOrder = 10;
    scene.add(this.mesh);
  }

  toggle(): void {
    if (!this.unlocked) return;
    this.enabled = !this.enabled;
  }

  /** Recompute the heat texture from the sim's sparse hot sets. Call once per sim tick. */
  refreshTexture(): void {
    if (!this.enabled && this.fade <= 0) return;
    this.colMax.fill(0);
    const { heat } = this.grid;
    const fill = (idx: number) => {
      const x = Math.floor(idx / (D * H));
      const z = Math.floor(idx / H) % D;
      const c = x * D + z;
      if (heat[idx] > this.colMax[c]) this.colMax[c] = heat[idx];
    };
    for (const idx of this.fire.activeFire) fill(idx);
    for (const idx of this.fire.hotCells) fill(idx);
    for (let c = 0; c < W * D; c++) {
      // normalize: ~120 heat = white hot
      this.data[this.texIndex(c)] = Math.min(255, (this.colMax[c] / 120) * 255);
    }
    this.texture.needsUpdate = true;
  }

  /** Map column cell (x*D+z) to texture index, accounting for plane orientation. */
  private texIndex(c: number): number {
    const x = Math.floor(c / D);
    const z = c % D;
    return (D - 1 - z) * W + x;
  }

  /** Fade the overlay + scene mute in/out. Call every frame. */
  update(dt: number): void {
    const target = this.enabled ? 1 : 0;
    this.fade += (target - this.fade) * Math.min(1, dt * 6);
    if (Math.abs(this.fade - target) < 0.01) this.fade = target;
    heatVisionUniform.value = this.fade;
    this.mesh.visible = this.fade > 0.02;
    const mat = this.mesh.material as THREE.ShaderMaterial;
    mat.uniforms.uOpacity.value = this.fade;
  }
}
