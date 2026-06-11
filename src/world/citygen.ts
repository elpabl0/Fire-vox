import { GRID } from '../config';
import { Rng } from '../core/rng';
import { Mat } from './materials';
import { VoxelGrid } from './voxelGrid';
import { RoadNetwork } from './roadGraph';
import { Building, makeBuilding, stampHouse, stampOffice, stampIndustrial, stampStation, stampTree } from './buildings';

const { W, D } = GRID;

export interface City {
  grid: VoxelGrid;
  roads: RoadNetwork;
  /** Indexed by building id (entry 0 is a placeholder). */
  buildings: Building[];
  /** Fire station door position (road cell where engines refill). */
  stationDoor: { x: number; z: number };
  /** Centre of the pond (helicopter refill). */
  pond: { x: number; z: number };
}

type BlockKind = 'houses' | 'offices' | 'towers' | 'industrial' | 'park' | 'pond';

interface Block {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  kind: BlockKind;
}

/** Lay out road lines along one axis with jittered spacing; returns start coords of 3-wide roads. */
function roadLines(rng: Rng, extent: number): number[] {
  const lines: number[] = [];
  let p = rng.int(1, 4);
  while (p + 3 < extent - 4) {
    lines.push(p);
    p += rng.int(15, 23);
  }
  return lines;
}

export function generateCity(seed: number): City {
  const rng = new Rng(seed);
  const grid = new VoxelGrid();
  const roads = new RoadNetwork();
  const buildings: Building[] = [makeBuilding(0, 'house', 0, 0, 0, 0, 0)]; // id 0 placeholder

  // 1. Ground: grass everywhere.
  for (let x = 0; x < W; x++) {
    for (let z = 0; z < D; z++) {
      grid.setVoxel(x, 0, z, Mat.GRASS);
    }
  }

  // 2. Roads: jittered grid of 3-wide asphalt strips (full lines keep the network connected).
  const xLines = roadLines(rng, W);
  const zLines = roadLines(rng, D);
  for (const lx of xLines) {
    for (let dx = 0; dx < 3; dx++) {
      for (let z = 0; z < D; z++) {
        grid.setVoxel(lx + dx, 0, z, Mat.ASPHALT);
        roads.setRoad(lx + dx, z);
      }
    }
  }
  for (const lz of zLines) {
    for (let dz = 0; dz < 3; dz++) {
      for (let x = 0; x < W; x++) {
        grid.setVoxel(x, 0, lz + dz, Mat.ASPHALT);
        roads.setRoad(x, lz + dz);
      }
    }
  }
  roads.computeFields();

  // 3. Blocks between roads.
  const xSpans = spansBetween(xLines, W);
  const zSpans = spansBetween(zLines, D);
  const blocks: Block[] = [];
  const cx = W / 2;
  const cz = D / 2;
  for (const sx of xSpans) {
    for (const sz of zSpans) {
      if (sx[1] - sx[0] < 6 || sz[1] - sz[0] < 6) continue;
      const bx = (sx[0] + sx[1]) / 2;
      const bz = (sz[0] + sz[1]) / 2;
      const distC = Math.hypot(bx - cx, bz - cz) / Math.hypot(cx, cz);
      let kind: BlockKind;
      if (distC < 0.28) kind = rng.chance(0.55) ? 'towers' : 'offices';
      else if (distC < 0.55) kind = rng.chance(0.5) ? 'offices' : 'houses';
      else kind = rng.chance(0.2) ? 'industrial' : 'houses';
      if (rng.chance(0.1)) kind = 'park';
      blocks.push({ x0: sx[0], z0: sz[0], x1: sx[1], z1: sz[1], kind });
    }
  }
  // Guarantee one pond, one park, one industrial.
  ensureKind(rng, blocks, 'pond');
  ensureKind(rng, blocks, 'park');
  ensureKind(rng, blocks, 'industrial');

  // 4. Fill blocks.
  let pond = { x: 10, z: 10 };
  for (const block of blocks) {
    // sidewalk ring
    for (let x = block.x0; x <= block.x1; x++) {
      for (let z = block.z0; z <= block.z1; z++) {
        const onRing = x === block.x0 || x === block.x1 || z === block.z0 || z === block.z1;
        if (onRing && block.kind !== 'pond' && block.kind !== 'park') {
          grid.setVoxel(x, 0, z, Mat.SIDEWALK);
        }
      }
    }
    switch (block.kind) {
      case 'pond':
        pond = stampPond(grid, block);
        break;
      case 'park':
        stampPark(grid, rng, block);
        break;
      default:
        stampBlockLots(grid, rng, block, buildings);
        break;
    }
  }

  // 5. Fire station: replace a building near the centre with the station.
  const stationDoor = placeStation(grid, rng, roads, buildings, blocks);

  // 6. Parked cars on sidewalk rings near houses.
  for (const block of blocks) {
    if (block.kind === 'park' || block.kind === 'pond') continue;
    for (let x = block.x0; x <= block.x1; x++) {
      for (let z = block.z0; z <= block.z1; z++) {
        const onRing = x === block.x0 || x === block.x1 || z === block.z0 || z === block.z1;
        if (onRing && rng.chance(0.012) && grid.material[grid.idx(x, 1, z)] === Mat.AIR) {
          grid.setVoxel(x, 1, z, Mat.CAR);
        }
      }
    }
  }

  grid.markAllDirty();
  return { grid, roads, buildings, stationDoor, pond };
}

function spansBetween(lines: number[], extent: number): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let prev = 0;
  for (const l of lines) {
    if (l - 1 >= prev) spans.push([prev, l - 1]);
    prev = l + 3;
  }
  if (extent - 1 >= prev) spans.push([prev, extent - 1]);
  return spans;
}

function ensureKind(rng: Rng, blocks: Block[], kind: BlockKind): void {
  if (blocks.some((b) => b.kind === kind)) return;
  const candidates = blocks.filter((b) => b.kind === 'houses' || b.kind === 'offices');
  if (candidates.length > 0) rng.pick(candidates).kind = kind;
}

function stampPond(grid: VoxelGrid, block: Block): { x: number; z: number } {
  const cx = (block.x0 + block.x1) / 2;
  const cz = (block.z0 + block.z1) / 2;
  const rx = (block.x1 - block.x0) / 2 - 1;
  const rz = (block.z1 - block.z0) / 2 - 1;
  for (let x = block.x0; x <= block.x1; x++) {
    for (let z = block.z0; z <= block.z1; z++) {
      const nx = (x - cx) / rx;
      const nz = (z - cz) / rz;
      const d = nx * nx + nz * nz;
      if (d <= 1) grid.setVoxel(x, 0, z, Mat.WATER);
      else if (d <= 1.45) grid.setVoxel(x, 0, z, Mat.DIRT);
    }
  }
  return { x: cx, z: cz };
}

function stampPark(grid: VoxelGrid, rng: Rng, block: Block): void {
  for (let x = block.x0 + 1; x <= block.x1 - 1; x++) {
    for (let z = block.z0 + 1; z <= block.z1 - 1; z++) {
      if (rng.chance(0.05)) stampTree(grid, rng, x, z);
      else if (rng.chance(0.02)) grid.setVoxel(x, 0, z, Mat.DIRT); // bare patches
    }
  }
}

function stampBlockLots(grid: VoxelGrid, rng: Rng, block: Block, buildings: Building[]): void {
  const lotSize = block.kind === 'houses' ? 7 : block.kind === 'industrial' ? 12 : 9;
  // interior region inside the sidewalk ring
  const ix0 = block.x0 + 1;
  const iz0 = block.z0 + 1;
  const ix1 = block.x1 - 1;
  const iz1 = block.z1 - 1;
  const nx = Math.max(1, Math.floor((ix1 - ix0 + 1) / lotSize));
  const nz = Math.max(1, Math.floor((iz1 - iz0 + 1) / lotSize));
  const lw = (ix1 - ix0 + 1) / nx;
  const ld = (iz1 - iz0 + 1) / nz;
  for (let gx = 0; gx < nx; gx++) {
    for (let gz = 0; gz < nz; gz++) {
      const lx0 = Math.round(ix0 + gx * lw);
      const lz0 = Math.round(iz0 + gz * ld);
      const lx1 = Math.round(ix0 + (gx + 1) * lw) - 1;
      const lz1 = Math.round(iz0 + (gz + 1) * ld) - 1;
      // building footprint: lot shrunk by a 1-cell grass margin
      const fx0 = lx0 + 1;
      const fz0 = lz0 + 1;
      const fx1 = lx1 - 1;
      const fz1 = lz1 - 1;
      if (fx1 - fx0 < 2 || fz1 - fz0 < 2) continue;
      if (rng.chance(0.08)) {
        // vacant lot with a tree or two
        if (rng.chance(0.6)) stampTree(grid, rng, rng.int(fx0, fx1), rng.int(fz0, fz1));
        continue;
      }
      const id = buildings.length;
      let kind: Building['kind'];
      let lotValue: number;
      switch (block.kind) {
        case 'houses':
          kind = 'house';
          lotValue = 1;
          break;
        case 'offices':
          kind = 'office';
          lotValue = 2;
          break;
        case 'towers':
          kind = 'tower';
          lotValue = 3;
          break;
        default:
          kind = 'industrial';
          lotValue = 3;
          break;
      }
      const b = makeBuilding(id, kind, lotValue, fx0, fz0, fx1, fz1);
      buildings.push(b);
      switch (kind) {
        case 'house':
          stampHouse(grid, rng, b);
          if (rng.chance(0.5)) stampTree(grid, rng, rng.chance(0.5) ? lx0 : lx1, rng.chance(0.5) ? lz0 : lz1);
          break;
        case 'office':
          stampOffice(grid, rng, b, false);
          break;
        case 'tower':
          stampOffice(grid, rng, b, true);
          break;
        case 'industrial':
          stampIndustrial(grid, rng, b);
          break;
      }
    }
  }
}

function placeStation(
  grid: VoxelGrid,
  rng: Rng,
  roads: RoadNetwork,
  buildings: Building[],
  blocks: Block[],
): { x: number; z: number } {
  // Pick the house/office building closest to the map centre and rebuild it as the station.
  const cx = W / 2;
  const cz = D / 2;
  let best: Building | null = null;
  let bestD = Infinity;
  for (let i = 1; i < buildings.length; i++) {
    const b = buildings[i];
    if (b.kind !== 'house' && b.kind !== 'office') continue;
    const d = Math.hypot((b.x0 + b.x1) / 2 - cx, (b.z0 + b.z1) / 2 - cz);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  if (!best) {
    // degenerate map: drop a pad in the first block
    const bl = blocks[0];
    best = makeBuilding(buildings.length, 'station', 0, bl.x0 + 2, bl.z0 + 2, bl.x0 + 6, bl.z0 + 6);
    buildings.push(best);
  } else {
    // clear the old building voxels
    for (let x = best.x0; x <= best.x1; x++) {
      for (let z = best.z0; z <= best.z1; z++) {
        for (let y = 1; y < GRID.H; y++) {
          if (grid.material[grid.idx(x, y, z)] !== Mat.AIR) grid.setVoxel(x, y, z, Mat.AIR);
        }
      }
    }
  }
  best.kind = 'station';
  best.lotValue = 0;
  best.totalVoxels = 0;
  stampStation(grid, best);
  void rng;
  const mid = roads.nearestRoadCell((best.x0 + best.x1) / 2, (best.z0 + best.z1) / 2);
  return mid ?? { x: best.x0, z: best.z0 };
}
