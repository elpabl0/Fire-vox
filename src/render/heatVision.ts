import * as THREE from 'three';
import { GRID } from '../config';
import { VoxelGrid } from '../world/voxelGrid';
import { FireSim } from '../sim/fireSim';

const { W, D, H } = GRID;

/** Shared uniform: 0 = normal view, 1 = heat vision. Patched into scene materials. */
export const heatVisionUniform = { value: 0 };
/** Per-column max-heat texture, sampled by the chunk shader to glow heat onto the voxels. */
export const heatTextureUniform: { value: THREE.DataTexture | null } = { value: null };

/**
 * Heat-vision state: maintains a per-column max-heat DataTexture that the
 * chunk material projects onto the world (see chunkManager shader patch), and
 * fades the scene mute in/out. Reveals smouldering interiors before visible flame.
 */
export class HeatVisionOverlay {
  unlocked = false;
  enabled = false;
  private texture: THREE.DataTexture;
  private data: Uint8Array<ArrayBuffer>;
  private colMax = new Float32Array(W * D);
  private fade = 0;

  constructor(
    private grid: VoxelGrid,
    private fire: FireSim,
  ) {
    this.data = new Uint8Array(W * D);
    this.texture = new THREE.DataTexture(this.data, W, D, THREE.RedFormat, THREE.UnsignedByteType);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.needsUpdate = true;
    heatTextureUniform.value = this.texture;
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
      const x = Math.floor(c / D);
      const z = c % D;
      // texture v matches shader uv: row z, normalize ~120 heat = white hot
      this.data[z * W + x] = Math.min(255, (this.colMax[c] / 120) * 255);
    }
    this.texture.needsUpdate = true;
  }

  /** Fade the overlay + scene mute in/out. Call every frame. */
  update(dt: number): void {
    const target = this.enabled ? 1 : 0;
    this.fade += (target - this.fade) * Math.min(1, dt * 6);
    if (Math.abs(this.fade - target) < 0.01) this.fade = target;
    heatVisionUniform.value = this.fade;
  }
}
