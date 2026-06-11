import { GRID } from '../config';
import { Flag, Mat } from './materials';
import { VoxelGrid } from './voxelGrid';

/**
 * Structural collapse: when a voxel is destroyed, solid voxels stacked above it
 * lose support and crumble. The cascade advances one layer per sim tick so
 * buildings visibly crumble rather than vanish.
 */
export class CollapseSim {
  /** Columns with pending unsupported voxels: cell index (x*D+z) -> lowest unsupported y. */
  private pending = new Map<number, number>();

  constructor(private grid: VoxelGrid) {}

  /** Call when (x,y,z) has just been destroyed. Queues the voxel above if unsupported. */
  onDestroyed(x: number, y: number, z: number): void {
    if (y + 1 >= GRID.H) return;
    const above = this.grid.idx(x, y + 1, z);
    if (this.grid.material[above] !== Mat.AIR && !this.hasLateralSupport(x, y + 1, z)) {
      const cell = x * GRID.D + z;
      const existing = this.pending.get(cell);
      if (existing === undefined || y + 1 < existing) this.pending.set(cell, y + 1);
    }
  }

  /** A voxel survives losing floor support if two or more lateral neighbours are solid (wall integrity). */
  private hasLateralSupport(x: number, y: number, z: number): boolean {
    let n = 0;
    if (x > 0 && this.grid.material[this.grid.idx(x - 1, y, z)] !== Mat.AIR) n++;
    if (x < GRID.W - 1 && this.grid.material[this.grid.idx(x + 1, y, z)] !== Mat.AIR) n++;
    if (z > 0 && this.grid.material[this.grid.idx(x, y, z - 1)] !== Mat.AIR) n++;
    if (z < GRID.D - 1 && this.grid.material[this.grid.idx(x, y, z + 1)] !== Mat.AIR) n++;
    return n >= 2;
  }

  /** Advance every pending column by one destroyed layer. Returns destroyed voxel indices (for FX/scoring). */
  tick(): number[] {
    if (this.pending.size === 0) return [];
    const destroyed: number[] = [];
    const next = new Map<number, number>();
    for (const [cell, y] of this.pending) {
      const x = Math.floor(cell / GRID.D);
      const z = cell % GRID.D;
      const idx = this.grid.idx(x, y, z);
      if (this.grid.material[idx] === Mat.AIR) continue;
      // re-check support: firefighting may not save it, but adjacent walls can
      if (this.hasLateralSupport(x, y, z)) continue;
      this.grid.material[idx] = Mat.AIR;
      this.grid.fuel[idx] = 0;
      this.grid.heat[idx] = 0;
      this.grid.flags[idx] = Flag.DESTROYED;
      this.grid.markDirty(x, z);
      destroyed.push(idx);
      if (y + 1 < GRID.H && this.grid.material[this.grid.idx(x, y + 1, z)] !== Mat.AIR) {
        next.set(cell, y + 1);
      }
    }
    this.pending = next;
    return destroyed;
  }
}
