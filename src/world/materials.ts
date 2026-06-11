/** Material IDs stored per-voxel in a Uint8Array. */
export const enum Mat {
  AIR = 0,
  ASPHALT = 1,
  SIDEWALK = 2,
  GRASS = 3,
  DIRT = 4,
  WATER = 5,
  WOOD_WALL = 6,
  WOOD_ROOF = 7,
  BRICK = 8,
  CONCRETE = 9,
  GLASS = 10,
  METAL = 11,
  INTERIOR = 12, // flammable fill inside masonry buildings
  TREE_TRUNK = 13,
  LEAVES = 14,
  FUEL_TANK = 15,
  CAR = 16,
  STATION = 17, // fire station pad (inert)
}

export const MAT_COUNT = 18;

export interface MaterialDef {
  name: string;
  colorTop: number;
  colorSide: number;
  colorCharred: number;
  /** 0..1 multiplier on ignition probability. 0 = inert. */
  flammability: number;
  /** Heat threshold required before ignition rolls begin. */
  ignitionHeat: number;
  /** Sim ticks the voxel burns before exhausting. */
  fuelTicks: number;
  /** Heat emitted to each neighbour per tick while burning. */
  heatOutput: number;
  /** Relative smoke emission while burning. */
  smokeRate: number;
  /** Chance the voxel becomes AIR (destroyed) when it burns out. */
  destroyOnBurnout: number;
  /** Destroying this material can drop unsupported voxels above it. */
  structural: boolean;
}

const M = (d: MaterialDef) => d;

export const MATERIALS: MaterialDef[] = new Array(MAT_COUNT);

MATERIALS[Mat.AIR] = M({ name: 'air', colorTop: 0, colorSide: 0, colorCharred: 0, flammability: 0, ignitionHeat: 1e9, fuelTicks: 0, heatOutput: 0, smokeRate: 0, destroyOnBurnout: 0, structural: false });
MATERIALS[Mat.ASPHALT] = M({ name: 'asphalt', colorTop: 0x3d3f44, colorSide: 0x34363a, colorCharred: 0x232427, flammability: 0, ignitionHeat: 1e9, fuelTicks: 0, heatOutput: 0, smokeRate: 0, destroyOnBurnout: 0, structural: false });
MATERIALS[Mat.SIDEWALK] = M({ name: 'sidewalk', colorTop: 0x9b9c98, colorSide: 0x8a8b87, colorCharred: 0x4c4c4a, flammability: 0, ignitionHeat: 1e9, fuelTicks: 0, heatOutput: 0, smokeRate: 0, destroyOnBurnout: 0, structural: false });
MATERIALS[Mat.GRASS] = M({ name: 'grass', colorTop: 0x5d9c46, colorSide: 0x4f8540, colorCharred: 0x2e2a22, flammability: 0.75, ignitionHeat: 16, fuelTicks: 30, heatOutput: 6, smokeRate: 0.4, destroyOnBurnout: 0, structural: false });
MATERIALS[Mat.DIRT] = M({ name: 'dirt', colorTop: 0x8a6e4b, colorSide: 0x77603f, colorCharred: 0x4a3c28, flammability: 0, ignitionHeat: 1e9, fuelTicks: 0, heatOutput: 0, smokeRate: 0, destroyOnBurnout: 0, structural: false });
MATERIALS[Mat.WATER] = M({ name: 'water', colorTop: 0x3b7fc4, colorSide: 0x33699e, colorCharred: 0x3b7fc4, flammability: 0, ignitionHeat: 1e9, fuelTicks: 0, heatOutput: 0, smokeRate: 0, destroyOnBurnout: 0, structural: false });
MATERIALS[Mat.WOOD_WALL] = M({ name: 'wood wall', colorTop: 0xb08a5a, colorSide: 0xa1794a, colorCharred: 0x2b2320, flammability: 0.65, ignitionHeat: 26, fuelTicks: 100, heatOutput: 9, smokeRate: 1.0, destroyOnBurnout: 0.45, structural: true });
MATERIALS[Mat.WOOD_ROOF] = M({ name: 'wood roof', colorTop: 0x8a4a3a, colorSide: 0x7c4234, colorCharred: 0x261f1d, flammability: 0.7, ignitionHeat: 24, fuelTicks: 85, heatOutput: 9, smokeRate: 1.1, destroyOnBurnout: 0.55, structural: true });
MATERIALS[Mat.BRICK] = M({ name: 'brick', colorTop: 0xa4593f, colorSide: 0x995239, colorCharred: 0x4a3029, flammability: 0.06, ignitionHeat: 80, fuelTicks: 60, heatOutput: 4, smokeRate: 0.5, destroyOnBurnout: 0.18, structural: true });
MATERIALS[Mat.CONCRETE] = M({ name: 'concrete', colorTop: 0xb8b9b4, colorSide: 0xa8a9a4, colorCharred: 0x595955, flammability: 0.02, ignitionHeat: 120, fuelTicks: 45, heatOutput: 3, smokeRate: 0.4, destroyOnBurnout: 0.1, structural: true });
MATERIALS[Mat.GLASS] = M({ name: 'glass', colorTop: 0x9fd4e8, colorSide: 0x8ec4dc, colorCharred: 0x3a4a52, flammability: 0.12, ignitionHeat: 60, fuelTicks: 12, heatOutput: 2, smokeRate: 0.3, destroyOnBurnout: 0.8, structural: false });
MATERIALS[Mat.METAL] = M({ name: 'metal', colorTop: 0x7d858f, colorSide: 0x6e757e, colorCharred: 0x43474d, flammability: 0.01, ignitionHeat: 160, fuelTicks: 30, heatOutput: 3, smokeRate: 0.3, destroyOnBurnout: 0.05, structural: true });
MATERIALS[Mat.INTERIOR] = M({ name: 'interior', colorTop: 0xc9b89a, colorSide: 0xbfae90, colorCharred: 0x2d2824, flammability: 0.55, ignitionHeat: 22, fuelTicks: 120, heatOutput: 8, smokeRate: 1.3, destroyOnBurnout: 0.35, structural: false });
MATERIALS[Mat.TREE_TRUNK] = M({ name: 'tree trunk', colorTop: 0x6e4f30, colorSide: 0x61452a, colorCharred: 0x231d18, flammability: 0.45, ignitionHeat: 34, fuelTicks: 90, heatOutput: 8, smokeRate: 0.9, destroyOnBurnout: 0.3, structural: true });
MATERIALS[Mat.LEAVES] = M({ name: 'leaves', colorTop: 0x4d8c3c, colorSide: 0x447d36, colorCharred: 0x26221c, flammability: 0.9, ignitionHeat: 14, fuelTicks: 24, heatOutput: 7, smokeRate: 0.8, destroyOnBurnout: 0.85, structural: false });
MATERIALS[Mat.FUEL_TANK] = M({ name: 'fuel tank', colorTop: 0xd8d4cc, colorSide: 0xc8c4bc, colorCharred: 0x33302c, flammability: 0.5, ignitionHeat: 50, fuelTicks: 140, heatOutput: 26, smokeRate: 2.2, destroyOnBurnout: 0.6, structural: true });
MATERIALS[Mat.CAR] = M({ name: 'car', colorTop: 0xc05050, colorSide: 0xb04848, colorCharred: 0x35302e, flammability: 0.4, ignitionHeat: 42, fuelTicks: 70, heatOutput: 12, smokeRate: 1.6, destroyOnBurnout: 0.2, structural: false });
MATERIALS[Mat.STATION] = M({ name: 'fire station', colorTop: 0xc44848, colorSide: 0xb04040, colorCharred: 0x5a2a2a, flammability: 0, ignitionHeat: 1e9, fuelTicks: 0, heatOutput: 0, smokeRate: 0, destroyOnBurnout: 0, structural: true });

/** Voxel flag bits (flags Uint8Array). */
export const enum Flag {
  BURNING = 1,
  CHARRED = 2,
  DESTROYED = 4,
  WET = 8,
  SMOLDERING = 16,
}
