import { ECONOMY, GRID } from '../config';
import { FireSim } from '../sim/fireSim';
import { Building } from '../world/buildings';
import { Mat, MATERIALS } from '../world/materials';
import { VoxelGrid } from '../world/voxelGrid';

const { H } = GRID;

/** Cost scales with damage and lot value. */
export function repairCost(b: Building): number {
  return Math.ceil(b.damagedVoxels * ECONOMY.REPAIR_COST_PER_VOXEL * Math.max(1, b.lotValue));
}

export function canRepair(b: Building): { ok: boolean; reason?: string } {
  if (b.kind === 'station') return { ok: false, reason: 'The fire HQ maintains itself' };
  if (b.damagedVoxels === 0) return { ok: false, reason: 'No damage to repair' };
  if (b.burningCount > 0) return { ok: false, reason: 'Still on fire — extinguish it first' };
  return { ok: true };
}

/**
 * Restore a building to its pristine generated state: rebuilds destroyed and
 * charred voxels, clears rubble inside the footprint, and resets the damage
 * ledger so the building can be saved (or lost) again.
 */
export function repairBuilding(grid: VoxelGrid, fire: FireSim, b: Building): void {
  for (let x = b.x0; x <= b.x1; x++) {
    for (let z = b.z0; z <= b.z1; z++) {
      let touched = false;
      for (let y = 0; y < H; y++) {
        const idx = grid.idx(x, y, z);
        const mine = grid.originalOwner[idx] === b.id || grid.owner[idx] === b.id;
        const strayRubble = grid.material[idx] === Mat.RUBBLE;
        if (!mine && !strayRubble) continue;
        const orig = mine ? grid.originalMaterial[idx] : Mat.AIR;
        fire.clearVoxelState(idx);
        grid.material[idx] = orig;
        grid.fuel[idx] = MATERIALS[orig].fuelTicks;
        grid.flags[idx] = 0;
        grid.owner[idx] = mine ? grid.originalOwner[idx] : 0;
        touched = true;
      }
      if (touched) grid.markDirty(x, z);
    }
  }
  b.damagedVoxels = 0;
  b.hadFire = false;
  b.resolved = false;
  b.burningCount = 0;
}
