import { GRID } from '../config';
import { Flag, Mat, MATERIALS } from '../world/materials';
import { VoxelGrid } from '../world/voxelGrid';
import { Wind } from './wind';

const { W, D, H } = GRID;
const COARSE = 8; // coarse cell footprint in voxels
const CW = W / COARSE;
const CD = D / COARSE;

export interface FireCluster {
  id: number;
  /** Centroid in voxel coords. */
  cx: number;
  cz: number;
  /** Burning voxel count. */
  size: number;
  /** Perimeter voxels (burning, facing unburned fuel), sorted downwind-front-first. */
  perimeter: number[];
  /** Hottest voxel index — helicopter target. */
  coreIdx: number;
}

/**
 * Groups burning voxels into connected clusters on a coarse 2D grid (run ~1 Hz,
 * not per tick). Cluster ids are kept stable across runs by centroid matching so
 * unit assignments survive re-clustering.
 */
export class FireClusterizer {
  clusters: FireCluster[] = [];
  private nextId = 1;

  constructor(
    private grid: VoxelGrid,
    private wind: Wind,
  ) {}

  update(activeFire: ReadonlySet<number>): void {
    const prev = this.clusters;
    // 1. bucket burning voxels into coarse cells
    const cellFire = new Map<number, number[]>();
    for (const idx of activeFire) {
      const x = Math.floor(idx / (D * H));
      const z = Math.floor(idx / H) % D;
      const cell = Math.floor(x / COARSE) * CD + Math.floor(z / COARSE);
      let list = cellFire.get(cell);
      if (!list) {
        list = [];
        cellFire.set(cell, list);
      }
      list.push(idx);
    }
    // 2. flood-fill coarse cells (8-connected) into clusters
    const cellCluster = new Map<number, number>();
    const groups: number[][] = [];
    for (const cell of cellFire.keys()) {
      if (cellCluster.has(cell)) continue;
      const group: number[] = [];
      const stack = [cell];
      cellCluster.set(cell, groups.length);
      while (stack.length > 0) {
        const c = stack.pop()!;
        group.push(c);
        const cx = Math.floor(c / CD);
        const cz = c % CD;
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            if (dx === 0 && dz === 0) continue;
            const nx = cx + dx;
            const nz = cz + dz;
            if (nx < 0 || nx >= CW || nz < 0 || nz >= CD) continue;
            const nc = nx * CD + nz;
            if (cellFire.has(nc) && !cellCluster.has(nc)) {
              cellCluster.set(nc, groups.length);
              stack.push(nc);
            }
          }
        }
      }
      groups.push(group);
    }
    // 3. build cluster records
    const next: FireCluster[] = [];
    for (const group of groups) {
      let sx = 0;
      let sz = 0;
      let size = 0;
      let coreIdx = -1;
      let coreHeat = -1;
      const perimeter: Array<{ idx: number; score: number }> = [];
      for (const cell of group) {
        for (const idx of cellFire.get(cell)!) {
          const x = Math.floor(idx / (D * H));
          const z = Math.floor(idx / H) % D;
          sx += x;
          sz += z;
          size++;
          if (this.grid.heat[idx] > coreHeat) {
            coreHeat = this.grid.heat[idx];
            coreIdx = idx;
          }
          const score = this.perimeterScore(idx, x, z);
          if (score > -Infinity) perimeter.push({ idx, score });
        }
      }
      perimeter.sort((a, b) => b.score - a.score);
      next.push({
        id: 0,
        cx: sx / size,
        cz: sz / size,
        size,
        perimeter: perimeter.slice(0, 64).map((p) => p.idx),
        coreIdx,
      });
    }
    // 4. stable ids: match to previous clusters by nearest centroid
    const taken = new Set<number>();
    for (const c of next) {
      let bestId = 0;
      let bestD = 12; // max centroid drift (voxels) to keep an id
      for (const p of prev) {
        if (taken.has(p.id)) continue;
        const d = Math.hypot(p.cx - c.cx, p.cz - c.cz);
        if (d < bestD) {
          bestD = d;
          bestId = p.id;
        }
      }
      if (bestId !== 0) {
        c.id = bestId;
        taken.add(bestId);
      } else {
        c.id = this.nextId++;
      }
    }
    this.clusters = next;
  }

  /**
   * Perimeter score: -Infinity if not a perimeter voxel, otherwise higher for
   * voxels whose unburned-fuel direction points downwind (the spreading front).
   */
  private perimeterScore(idx: number, x: number, z: number): number {
    let fx = 0;
    let fz = 0;
    let hasFuelNeighbour = false;
    const check = (nIdx: number, dx: number, dz: number) => {
      const mat = this.grid.material[nIdx];
      if (mat === Mat.AIR || mat === Mat.WATER) return;
      if (this.grid.flags[nIdx] & Flag.BURNING) return;
      if (this.grid.fuel[nIdx] > 0 && MATERIALS[mat].flammability > 0) {
        hasFuelNeighbour = true;
        fx += dx;
        fz += dz;
      }
    };
    if (x > 0) check(idx - D * H, -1, 0);
    if (x < W - 1) check(idx + D * H, 1, 0);
    if (z > 0) check(idx - H, 0, -1);
    if (z < D - 1) check(idx + H, 0, 1);
    if (!hasFuelNeighbour) return -Infinity;
    const len = Math.hypot(fx, fz) || 1;
    return (fx / len) * this.wind.dirX + (fz / len) * this.wind.dirZ;
  }

  /**
   * Nearest cluster measured to its closest perimeter voxel (not the centroid,
   * which drifts away from bystanders as a fire grows). Used for the
   * close-proximity self-engagement radius.
   */
  nearestBurning(x: number, z: number): { cluster: FireCluster; dist: number } | null {
    let best: { cluster: FireCluster; dist: number } | null = null;
    for (const c of this.clusters) {
      let d = Math.hypot(c.cx - x, c.cz - z);
      for (const voxel of c.perimeter) {
        const vx = Math.floor(voxel / (D * H));
        const vz = Math.floor(voxel / H) % D;
        const vd = Math.hypot(vx - x, vz - z);
        if (vd < d) d = vd;
      }
      if (!best || d < best.dist) best = { cluster: c, dist: d };
    }
    return best;
  }

  nearestCluster(x: number, z: number): FireCluster | null {
    let best: FireCluster | null = null;
    let bestD = Infinity;
    for (const c of this.clusters) {
      const d = Math.hypot(c.cx - x, c.cz - z);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  byId(id: number): FireCluster | null {
    return this.clusters.find((c) => c.id === id) ?? null;
  }
}
