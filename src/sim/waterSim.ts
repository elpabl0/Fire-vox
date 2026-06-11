import { GRID, SIM } from '../config';
import { Mat } from '../world/materials';
import { VoxelGrid } from '../world/voxelGrid';
import { FireSim } from './fireSim';

const { W, D, H } = GRID;

/**
 * Buffers water impacts (from hose particles and helicopter drops) between sim
 * ticks and applies them as cooling + wetting, with light splash spillover to
 * neighbouring columns.
 */
export class WaterSim {
  /** voxel idx -> accumulated water units since last tick */
  private hits = new Map<number, number>();

  constructor(
    private grid: VoxelGrid,
    private fire: FireSim,
  ) {}

  /** Register a water impact at world position (from CPU water particles). */
  hitAt(x: number, y: number, z: number, amount: number): void {
    const vx = Math.round(x);
    const vz = Math.round(z);
    if (vx < 0 || vx >= W || vz < 0 || vz >= D) return;
    let vy = Math.max(0, Math.min(H - 1, Math.round(y)));
    // snap to the nearest solid voxel at or below the impact point
    while (vy > 0 && this.grid.material[this.grid.idx(vx, vy, vz)] === Mat.AIR) vy--;
    const idx = this.grid.idx(vx, vy, vz);
    this.hits.set(idx, (this.hits.get(idx) ?? 0) + amount);
  }

  /** Helicopter drop: douse the top voxels of every column within radius. */
  dropArea(cx: number, cz: number, radius: number, totalAmount: number): void {
    const r = Math.ceil(radius);
    const cells: number[] = [];
    for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(W - 1, Math.ceil(cx + r)); x++) {
      for (let z = Math.max(0, Math.floor(cz - r)); z <= Math.min(D - 1, Math.ceil(cz + r)); z++) {
        const dx = x - cx;
        const dz = z - cz;
        if (dx * dx + dz * dz > radius * radius) continue;
        const ty = this.grid.topY(x, z);
        if (ty >= 0) cells.push(this.grid.idx(x, ty, z));
        // also douse one layer below the top (burning walls under a roof edge)
        if (ty > 0) cells.push(this.grid.idx(x, ty - 1, z));
      }
    }
    if (cells.length === 0) return;
    const per = totalAmount / cells.length;
    for (const idx of cells) this.hits.set(idx, (this.hits.get(idx) ?? 0) + per);
  }

  /** Drain the hit buffer into the fire sim. Called once per sim tick. */
  tick(): void {
    if (this.hits.size === 0) return;
    for (const [idx, amount] of this.hits) {
      this.fire.coolVoxel(idx, amount * SIM.WATER_COOL);
      // splash spillover to 4 horizontal neighbours and the voxel below
      const x = Math.floor(idx / (D * H));
      const z = Math.floor(idx / H) % D;
      const y = idx % H;
      const spill = amount * SIM.WATER_COOL * 0.5;
      if (x > 0) this.spill(idx - D * H, spill);
      if (x < W - 1) this.spill(idx + D * H, spill);
      if (z > 0) this.spill(idx - H, spill);
      if (z < D - 1) this.spill(idx + H, spill);
      if (y > 0) this.spill(idx - 1, spill);
    }
    this.hits.clear();
  }

  private spill(idx: number, amount: number): void {
    if (this.grid.material[idx] !== Mat.AIR) this.fire.coolVoxel(idx, amount);
  }
}
