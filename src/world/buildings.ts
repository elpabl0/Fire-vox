import { GRID } from '../config';
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
  /** A building settles (saved/damaged/lost) once per fire episode (reset by repair). */
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

/**
 * Wooden house: walls + flammable interior with a structural floor slab,
 * stepped roof, chimney, door and scattered windows.
 */
export function stampHouse(grid: VoxelGrid, rng: Rng, b: Building): void {
  const { x0, z0, x1, z1 } = b;
  const height = rng.int(3, 5);
  const floorY = height >= 4 ? Math.ceil(height / 2) : -1;
  const doorSide = rng.int(0, 3);
  const doorPos = rng.int(0, 1); // offset along the wall
  for (let y = 1; y <= height; y++) {
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const isWall = x === x0 || x === x1 || z === z0 || z === z1;
        if (isWall) {
          // door: 1 wide x 2 high opening of dark wood on the chosen side
          const onDoorSide =
            (doorSide === 0 && x === x1 && z === z0 + 1 + doorPos) ||
            (doorSide === 1 && x === x0 && z === z0 + 1 + doorPos) ||
            (doorSide === 2 && z === z1 && x === x0 + 1 + doorPos) ||
            (doorSide === 3 && z === z0 && x === x0 + 1 + doorPos);
          if (onDoorSide && y <= 2) {
            put(grid, b, x, y, z, Mat.TREE_TRUNK);
            continue;
          }
          const window = y >= 2 && (x + z + y) % 3 === 0 && rng.chance(0.5);
          put(grid, b, x, y, z, window ? Mat.GLASS : Mat.WOOD_WALL);
        } else if (y === floorY) {
          put(grid, b, x, y, z, Mat.WOOD_WALL); // structural floor slab
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
  // brick chimney on a corner of the roof
  if (rng.chance(0.7)) {
    const cx = rng.chance(0.5) ? x0 + 1 : x1 - 1;
    const cz = rng.chance(0.5) ? z0 + 1 : z1 - 1;
    const top = grid.topY(cx, cz);
    for (let cy = top + 1; cy <= top + 2 && cy < GRID.H; cy++) put(grid, b, cx, cy, cz, Mat.BRICK);
  }
}

/**
 * Brick/concrete mid-rise or tower: window-banded shell, concrete floor slabs
 * every third storey, interior partition walls, parapet, rooftop AC boxes.
 */
export function stampOffice(grid: VoxelGrid, rng: Rng, b: Building, tall: boolean): void {
  const { x0, z0, x1, z1 } = b;
  const shell = rng.chance(0.5) ? Mat.BRICK : Mat.CONCRETE;
  const height = tall ? rng.int(14, Math.min(22, GRID.H - 6)) : rng.int(6, 9);
  for (let y = 1; y <= height; y++) {
    const isSlab = y % 3 === 0;
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const isWall = x === x0 || x === x1 || z === z0 || z === z1;
        if (isWall) {
          const window = !isSlab && (x + z) % 2 === 0;
          put(grid, b, x, y, z, window ? Mat.GLASS : shell);
        } else if (isSlab) {
          put(grid, b, x, y, z, shell); // structural floor slab
        } else {
          // interior partition walls add density and burn structure
          const partition = (x - x0) % 4 === 0 || (z - z0) % 4 === 0;
          put(grid, b, x, y, z, partition && rng.chance(0.6) ? shell : Mat.INTERIOR);
        }
      }
    }
  }
  // flat roof with parapet ring
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      put(grid, b, x, height + 1, z, shell);
      const onEdge = x === x0 || x === x1 || z === z0 || z === z1;
      if (onEdge) put(grid, b, x, height + 2, z, shell);
    }
  }
  // rooftop clutter: AC boxes / water tank
  const clutter = rng.int(1, 3);
  for (let i = 0; i < clutter; i++) {
    const cx = rng.int(x0 + 1, Math.max(x0 + 1, x1 - 2));
    const cz = rng.int(z0 + 1, Math.max(z0 + 1, z1 - 2));
    const ch = rng.chance(0.3) ? 2 : 1;
    for (let dy = 1; dy <= ch; dy++) {
      put(grid, b, cx, height + 1 + dy, cz, Mat.METAL);
      if (rng.chance(0.5)) put(grid, b, cx + 1, height + 1 + dy, cz, Mat.METAL);
    }
  }
}

/** Metal warehouse with interior racking, fuel tank farm, pipework and a brick stack. */
export function stampIndustrial(grid: VoxelGrid, rng: Rng, b: Building): void {
  const { x0, z0, x1, z1 } = b;
  const height = rng.int(4, 6);
  const splitX = x0 + Math.floor((x1 - x0) * 0.6);
  for (let y = 1; y <= height; y++) {
    for (let x = x0; x <= splitX; x++) {
      for (let z = z0; z <= z1; z++) {
        const isWall = x === x0 || x === splitX || z === z0 || z === z1;
        if (isWall) {
          put(grid, b, x, y, z, Mat.METAL);
        } else {
          // storage racking rows inside — dense flammable stock
          const rack = (z - z0) % 3 === 1 && y <= height - 2;
          put(grid, b, x, y, z, rack ? Mat.WOOD_WALL : Mat.INTERIOR);
        }
      }
    }
  }
  for (let x = x0; x <= splitX; x++) {
    for (let z = z0; z <= z1; z++) {
      put(grid, b, x, height + 1, z, Mat.METAL);
    }
  }
  // brick chimney stack
  const stackX = Math.max(x0 + 1, splitX - 1);
  for (let y = 1; y <= height + 7 && y < GRID.H; y++) put(grid, b, stackX, y, z1 - 1, Mat.BRICK);
  // fuel tanks: 2x2 columns with connecting pipework
  let prevTank: { x: number; z: number } | null = null;
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
      if (prevTank) {
        // straight pipe between tank pads at y=1
        const px = prevTank.x;
        for (let z = Math.min(prevTank.z, tz) + 1; z < Math.max(prevTank.z, tz); z++) {
          if (grid.material[grid.idx(px, 1, z)] === Mat.AIR) put(grid, b, px, 1, z, Mat.METAL);
        }
      }
      prevTank = { x: tx, z: tz };
      tz += 4;
    }
    tx += 4;
  }
}

/**
 * Fire HQ: red-brick two-storey hall with white trim band and roof, garage
 * bays facing the road, a corner watchtower, and rooftop helipads (one per
 * purchasable helicopter). `facing`: 0 +x, 1 -x, 2 +z, 3 -z.
 * Returns the helipad landing points.
 */
export function stampStation(grid: VoxelGrid, b: Building, facing: number): Array<{ x: number; z: number; y: number }> {
  const { x0, z0, x1, z1 } = b;
  const height = 4;
  for (let y = 1; y <= height; y++) {
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const isWall = x === x0 || x === x1 || z === z0 || z === z1;
        if (!isWall) {
          if (y === height) put(grid, b, x, y, z, Mat.STATION); // ceiling fill below roof
          continue;
        }
        // garage bays: 2-wide, 3-high dark doors along the road-facing wall
        const onFacing =
          (facing === 0 && x === x1) || (facing === 1 && x === x0) || (facing === 2 && z === z1) || (facing === 3 && z === z0);
        const along = facing <= 1 ? z - z0 : x - x0;
        const extent = facing <= 1 ? z1 - z0 : x1 - x0;
        const isBay = onFacing && y <= 3 && along >= 1 && along <= extent - 1 && (along - 1) % 3 !== 2;
        if (isBay) {
          put(grid, b, x, y, z, Mat.STATION_DOOR);
        } else if (y === height) {
          put(grid, b, x, y, z, Mat.STATION_TRIM); // white band under the roofline
        } else {
          put(grid, b, x, y, z, Mat.STATION);
        }
      }
    }
  }
  // white flat roof
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      put(grid, b, x, height + 1, z, Mat.STATION_TRIM);
    }
  }
  // two rooftop helipads: dark 3x3 squares with a white "H"
  const pads: Array<{ x: number; z: number; y: number }> = [];
  const roofY = height + 1;
  const longAxisZ = z1 - z0 >= x1 - x0;
  const midX = Math.floor((x0 + x1) / 2);
  const midZ = Math.floor((z0 + z1) / 2);
  const padCentres = longAxisZ
    ? [
        { x: midX, z: z0 + 2 },
        { x: midX, z: z1 - 2 },
      ]
    : [
        { x: x0 + 2, z: midZ },
        { x: x1 - 2, z: midZ },
      ];
  for (const c of padCentres) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const px = c.x + dx;
        const pz = c.z + dz;
        if (px < x0 || px > x1 || pz < z0 || pz > z1) continue;
        const isH = Math.abs(dx) === 1 || dz === 0;
        put(grid, b, px, roofY, pz, isH ? Mat.STATION_TRIM : Mat.STATION_DOOR);
      }
    }
    pads.push({ x: c.x, z: c.z, y: roofY + 1 });
  }
  // corner watchtower with glazed top
  const twX = facing === 1 ? x1 - 1 : x0;
  const twZ = facing === 3 ? z1 - 1 : z0;
  for (let y = 1; y <= 9 && y < GRID.H; y++) {
    for (let dx = 0; dx < 2; dx++) {
      for (let dz = 0; dz < 2; dz++) {
        const mat = y >= 7 && y <= 8 ? Mat.GLASS : y === 9 ? Mat.STATION_TRIM : Mat.STATION;
        put(grid, b, twX + dx, y, twZ + dz, mat);
      }
    }
  }
  return pads;
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
