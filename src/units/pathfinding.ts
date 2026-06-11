import { GRID } from '../config';
import { RoadNetwork } from '../world/roadGraph';

const { W, D } = GRID;

interface Heap {
  cells: number[];
  costs: number[];
}

function heapPush(h: Heap, cell: number, cost: number): void {
  h.cells.push(cell);
  h.costs.push(cost);
  let i = h.cells.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h.costs[p] <= h.costs[i]) break;
    swap(h, i, p);
    i = p;
  }
}

function heapPop(h: Heap): number {
  const top = h.cells[0];
  const lastCell = h.cells.pop()!;
  const lastCost = h.costs.pop()!;
  if (h.cells.length > 0) {
    h.cells[0] = lastCell;
    h.costs[0] = lastCost;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      if (l < h.cells.length && h.costs[l] < h.costs[m]) m = l;
      if (r < h.cells.length && h.costs[r] < h.costs[m]) m = r;
      if (m === i) break;
      swap(h, i, m);
      i = m;
    }
  }
  return top;
}

function swap(h: Heap, a: number, b: number): void {
  const tc = h.cells[a];
  h.cells[a] = h.cells[b];
  h.cells[b] = tc;
  const tk = h.costs[a];
  h.costs[a] = h.costs[b];
  h.costs[b] = tk;
}

export interface PathPoint {
  x: number;
  z: number;
}

/**
 * A* over road cells (4-connected). Roads are a small fraction of the 128x128
 * footprint and dispatches are rare, so cell-level search is plenty fast.
 * Returns waypoints with collinear runs collapsed, or null if unreachable.
 */
export function findRoadPath(roads: RoadNetwork, sx: number, sz: number, gx: number, gz: number): PathPoint[] | null {
  const start = sx * D + sz;
  const goal = gx * D + gz;
  if (!roads.isRoad[start] || !roads.isRoad[goal]) return null;
  if (start === goal) return [{ x: gx, z: gz }];

  const gScore = new Map<number, number>();
  const cameFrom = new Map<number, number>();
  const open: Heap = { cells: [], costs: [] };
  gScore.set(start, 0);
  heapPush(open, start, 0);
  const closed = new Set<number>();

  while (open.cells.length > 0) {
    const current = heapPop(open);
    if (current === goal) return reconstruct(cameFrom, current);
    if (closed.has(current)) continue;
    closed.add(current);
    const cx = Math.floor(current / D);
    const cz = current % D;
    const g = gScore.get(current)!;
    const tryNeighbour = (nx: number, nz: number) => {
      if (nx < 0 || nx >= W || nz < 0 || nz >= D) return;
      const n = nx * D + nz;
      if (!roads.isRoad[n] || closed.has(n)) return;
      const ng = g + 1;
      const existing = gScore.get(n);
      if (existing !== undefined && existing <= ng) return;
      gScore.set(n, ng);
      cameFrom.set(n, current);
      const h = Math.abs(nx - gx) + Math.abs(nz - gz);
      heapPush(open, n, ng + h);
    };
    tryNeighbour(cx - 1, cz);
    tryNeighbour(cx + 1, cz);
    tryNeighbour(cx, cz - 1);
    tryNeighbour(cx, cz + 1);
  }
  return null;
}

function reconstruct(cameFrom: Map<number, number>, end: number): PathPoint[] {
  const cells: number[] = [end];
  let c = end;
  while (cameFrom.has(c)) {
    c = cameFrom.get(c)!;
    cells.push(c);
  }
  cells.reverse();
  // collapse collinear runs so movement code follows long straight segments
  const points: PathPoint[] = [];
  for (let i = 0; i < cells.length; i++) {
    const x = Math.floor(cells[i] / D);
    const z = cells[i] % D;
    if (i > 0 && i < cells.length - 1) {
      const px = Math.floor(cells[i - 1] / D);
      const pz = cells[i - 1] % D;
      const nx = Math.floor(cells[i + 1] / D);
      const nz = cells[i + 1] % D;
      if ((x - px === nx - x && z - pz === nz - z)) continue;
    }
    points.push({ x, z });
  }
  return points;
}
