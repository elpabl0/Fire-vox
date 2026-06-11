import { GRID } from '../config';

const { W, D } = GRID;

/**
 * Road network as a 2D cell mask over the map footprint, with a precomputed
 * BFS distance-to-road field. Vehicle pathfinding (units/pathfinding.ts) runs
 * A* directly over these cells.
 */
export class RoadNetwork {
  /** 1 where the column is drivable road. */
  readonly isRoad = new Uint8Array(W * D);
  /** BFS distance (in cells) from each column to the nearest road cell. */
  readonly distToRoad = new Uint16Array(W * D);
  /** Cell index (x*D+z) of the nearest road cell for each column. */
  readonly nearestRoad = new Int32Array(W * D);

  static cell(x: number, z: number): number {
    return x * D + z;
  }

  setRoad(x: number, z: number): void {
    this.isRoad[x * D + z] = 1;
  }

  /** Build distToRoad/nearestRoad via multi-source BFS. Call once after roads are laid. */
  computeFields(): void {
    this.distToRoad.fill(0xffff);
    this.nearestRoad.fill(-1);
    const queue = new Int32Array(W * D);
    let head = 0;
    let tail = 0;
    for (let c = 0; c < W * D; c++) {
      if (this.isRoad[c]) {
        this.distToRoad[c] = 0;
        this.nearestRoad[c] = c;
        queue[tail++] = c;
      }
    }
    while (head < tail) {
      const c = queue[head++];
      const x = Math.floor(c / D);
      const z = c % D;
      const d = this.distToRoad[c] + 1;
      // 4-neighbourhood
      if (x > 0 && this.distToRoad[c - D] === 0xffff) { this.distToRoad[c - D] = d; this.nearestRoad[c - D] = this.nearestRoad[c]; queue[tail++] = c - D; }
      if (x < W - 1 && this.distToRoad[c + D] === 0xffff) { this.distToRoad[c + D] = d; this.nearestRoad[c + D] = this.nearestRoad[c]; queue[tail++] = c + D; }
      if (z > 0 && this.distToRoad[c - 1] === 0xffff) { this.distToRoad[c - 1] = d; this.nearestRoad[c - 1] = this.nearestRoad[c]; queue[tail++] = c - 1; }
      if (z < D - 1 && this.distToRoad[c + 1] === 0xffff) { this.distToRoad[c + 1] = d; this.nearestRoad[c + 1] = this.nearestRoad[c]; queue[tail++] = c + 1; }
    }
  }

  /** Nearest road cell to an arbitrary position, as {x,z}, or null if no roads exist. */
  nearestRoadCell(x: number, z: number): { x: number; z: number } | null {
    const cx = Math.max(0, Math.min(W - 1, Math.round(x)));
    const cz = Math.max(0, Math.min(D - 1, Math.round(z)));
    const c = this.nearestRoad[cx * D + cz];
    if (c < 0) return null;
    return { x: Math.floor(c / D), z: c % D };
  }

  /** True if every road cell can reach every other (used by citygen tests). */
  isConnected(): boolean {
    let start = -1;
    let total = 0;
    for (let c = 0; c < W * D; c++) {
      if (this.isRoad[c]) {
        if (start < 0) start = c;
        total++;
      }
    }
    if (start < 0) return false;
    const seen = new Uint8Array(W * D);
    const queue = new Int32Array(total);
    let head = 0;
    let tail = 0;
    seen[start] = 1;
    queue[tail++] = start;
    let count = 0;
    while (head < tail) {
      const c = queue[head++];
      count++;
      const x = Math.floor(c / D);
      const z = c % D;
      if (x > 0 && this.isRoad[c - D] && !seen[c - D]) { seen[c - D] = 1; queue[tail++] = c - D; }
      if (x < W - 1 && this.isRoad[c + D] && !seen[c + D]) { seen[c + D] = 1; queue[tail++] = c + D; }
      if (z > 0 && this.isRoad[c - 1] && !seen[c - 1]) { seen[c - 1] = 1; queue[tail++] = c - 1; }
      if (z < D - 1 && this.isRoad[c + 1] && !seen[c + 1]) { seen[c + 1] = 1; queue[tail++] = c + 1; }
    }
    return count === total;
  }
}
