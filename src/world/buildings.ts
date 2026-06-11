import { Rng } from '../core/rng';
import { Mat } from './materials';
import { VoxelGrid } from './voxelGrid';

export type BuildingKind = 'house' | 'office' | 'tower' | 'industrial' | 'station';

export interface Building {
  id: number;
  kind: BuildingKind;
  /** Reward/penalty scale: house 1, office 2, tower/industrial 3. */
  lotValue: number;
  totalVoxels: number;
  /** Footprint bounds (inclusive). */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Set when fire first touches the building; cleared on settle. */
  hadFire: boolean;
  /** A building settles (saved/damaged/lost) once per run. */
  resolved: boolean;
  /** Live count of burning voxels owned by this building. */
  burningCount: number;
  /** Voxels charred or destroyed. */
  damagedVoxels: number;
}

function makeBuilding(id: number, kind: BuildingKind, lotValue: number, x0: number, z0: number, x1: number, z1: number): Building {
  return { id, kind, lotValue, totalVoxels: 0, x0, z0, x1, z1, hadFire: false, resolved: false, burningCount: 0, damagedVoxels: 0 };
}

function put(grid: VoxelGrid, b: Building, x: number, y: number, z: number, mat: Mat): void {
  grid.setVoxel(x, y, z, mat, b.id);
  b.totalVoxels++;
}

/** Small wooden house: 3-4 storeys of wall+interior, pitched-ish stepped roof, glass windows. */
export function stampHouse(grid: VoxelGrid, rng: Rng, b: Building): void {
  const { x0, z0, x1, z1 } = b;
  const height = rng.int(3, 4);
  for (let y = 1; y <= height; y++) {
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const isWall = x === x0 || x === x1 || z === z0 || z === z1;
        if (isWall) {
          const window = y >= 2 && (x + z + y) % 3 === 0 && rng.chance(0.5);
          put(grid, b, x, y, z, window ? Mat.GLASS : Mat.WOOD_WALL);
        } else {
          put(grid, b, x, y, z, Mat.INTERIOR);
        }
      }
    }
  }
  // stepped roof: shrink inward per layer
  let rx0 = x0;
  let rz0 = z0;
  let rx1 = x1;
  let rz1 = z1;
  let y = height + 1;
  while (rx0 <= rx1 && rz0 <= rz1) {
    for (let x = rx0; x <= rx1; x++) {
      for (let z = rz0; z <= rz1; z++) {
        put(grid, b, x, y, z, Mat.WOOD_ROOF);
      }
    }
    rx0++;
    rx1--;
    rz0++;
    rz1--;
    y++;
    if (y > height + 3) break;
  }
}

/** Brick or concrete mid-rise with window bands and a flammable interior. */
export function stampOffice(grid: VoxelGrid, rng: Rng, b: Building, tall: boolean): void {
  const { x0, z0, x1, z1 } = b;
  const shell = rng.chance(0.5) ? Mat.BRICK : Mat.CONCRETE;
  const height = tall ? rng.int(10, 15) : rng.int(5, 8);
  for (let y = 1; y <= height; y++) {
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const isWall = x === x0 || x === x1 || z === z0 || z === z1;
        if (isWall) {
          const window = y % 3 !== 0 && (x + z) % 2 === 0;
          put(grid, b, x, y, z, window ? Mat.GLASS : shell);
        } else {
          put(grid, b, x, y, z, Mat.INTERIOR);
        }
      }
    }
  }
  // flat roof
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      put(grid, b, x, height + 1, z, shell);
    }
  }
}

/** Metal warehouse plus exposed fuel tanks — high heat output hazard. */
export function stampIndustrial(grid: VoxelGrid, rng: Rng, b: Building): void {
  const { x0, z0, x1, z1 } = b;
  const height = rng.int(3, 5);
  // warehouse occupies most of the lot, tanks in the remaining strip
  const splitX = x0 + Math.floor((x1 - x0) * 0.6);
  for (let y = 1; y <= height; y++) {
    for (let x = x0; x <= splitX; x++) {
      for (let z = z0; z <= z1; z++) {
        const isWall = x === x0 || x === splitX || z === z0 || z === z1;
        put(grid, b, x, y, z, isWall ? Mat.METAL : Mat.INTERIOR);
      }
    }
  }
  for (let x = x0; x <= splitX; x++) {
    for (let z = z0; z <= z1; z++) {
      put(grid, b, x, height + 1, z, Mat.METAL);
    }
  }
  // fuel tanks: 2x2 columns
  let tx = splitX + 2;
  while (tx + 1 <= x1) {
    let tz = z0 + 1;
    while (tz + 1 <= z1) {
      const th = rng.int(2, 4);
      for (let y = 1; y <= th; y++) {
        for (let dx = 0; dx < 2; dx++) {
          for (let dz = 0; dz < 2; dz++) {
            put(grid, b, tx + dx, y, tz + dz, Mat.FUEL_TANK);
          }
        }
      }
      tz += 4;
    }
    tx += 4;
  }
}

/** Fire station: inert red building; units refill adjacent to it. */
export function stampStation(grid: VoxelGrid, b: Building): void {
  const { x0, z0, x1, z1 } = b;
  const height = 3;
  for (let y = 1; y <= height; y++) {
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const isWall = x === x0 || x === x1 || z === z0 || z === z1;
        if (isWall || y === height) put(grid, b, x, y, z, Mat.STATION);
      }
    }
  }
}

/** Tree: trunk column + leaf blob. Owned by the park lot (id may be 0). */
export function stampTree(grid: VoxelGrid, rng: Rng, x: number, z: number, owner = 0): void {
  const trunkH = rng.int(2, 4);
  for (let y = 1; y <= trunkH; y++) grid.setVoxel(x, y, z, Mat.TREE_TRUNK, owner);
  const r = rng.int(1, 2);
  for (let dx = -r; dx <= r; dx++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dy = 0; dy <= r; dy++) {
        if (Math.abs(dx) + Math.abs(dz) + dy > r + 1) continue;
        const lx = x + dx;
        const lz = z + dz;
        const ly = trunkH + 1 + dy;
        if (!grid.inBounds(lx, ly, lz)) continue;
        if (grid.material[grid.idx(lx, ly, lz)] === Mat.AIR) {
          grid.setVoxel(lx, ly, lz, Mat.LEAVES, owner);
        }
      }
    }
  }
}

export { makeBuilding };
