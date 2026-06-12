import { GRID, UNITS } from '../config';
import { Flag } from '../world/materials';
import { FireClusterizer } from '../sim/fireClusters';
import { RoadNetwork } from '../world/roadGraph';
import { VoxelGrid } from '../world/voxelGrid';
import { Engine } from './engine';
import { UnitBase, UnitContext } from './unit';

const { D, H } = GRID;

/**
 * Cooperation layer: assigns idle units to fire clusters (favouring uncovered
 * fires) and hands out distinct, spaced perimeter targets so units fighting the
 * same blaze fan out along its edge instead of cross-spraying one voxel.
 */
export class Coordinator {
  /** Claimed perimeter voxel -> unit id. */
  private claims = new Map<number, number>();
  private claimByUnit = new Map<number, number>();

  constructor(
    private grid: VoxelGrid,
    private roads: RoadNetwork,
    private clusters: FireClusterizer,
  ) {}

  /** Periodic re-plan (~1 Hz): refresh clusters, drop stale claims, auto-assign idle engines. */
  replan(units: UnitBase[], activeFire: ReadonlySet<number>, ctx: UnitContext, autoAssign: boolean): void {
    this.clusters.update(activeFire);

    // drop claims on voxels that stopped burning
    for (const [voxel, unitId] of this.claims) {
      if (!(this.grid.flags[voxel] & Flag.BURNING)) {
        this.claims.delete(voxel);
        this.claimByUnit.delete(unitId);
        const unit = units.find((u) => u.id === unitId);
        if (unit) unit.targetVoxel = -1;
      }
    }

    // clear assignments to extinct clusters
    const liveIds = new Set(this.clusters.clusters.map((c) => c.id));
    for (const unit of units) {
      if (unit.assignedCluster >= 0 && !liveIds.has(unit.assignedCluster)) {
        unit.assignedCluster = -1;
        this.releaseTarget(unit);
      }
    }

    if (!autoAssign) return;
    // auto-assign: idle engines pick the cluster with the best need/distance score
    const assignedCount = new Map<number, number>();
    for (const unit of units) {
      if (unit.assignedCluster >= 0) {
        assignedCount.set(unit.assignedCluster, (assignedCount.get(unit.assignedCluster) ?? 0) + 1);
      }
    }
    for (const unit of units) {
      if (unit.assignedCluster >= 0 || unit.state !== 'idle') continue;
      let best = null as { id: number; cx: number; cz: number } | null;
      let bestScore = 0;
      for (const c of this.clusters.clusters) {
        const covered = assignedCount.get(c.id) ?? 0;
        const dist = Math.hypot(c.cx - unit.x, c.cz - unit.z);
        const score = c.size / ((1 + covered) * (10 + dist));
        if (score > bestScore) {
          bestScore = score;
          best = { id: c.id, cx: c.cx, cz: c.cz };
        }
      }
      if (best) {
        assignedCount.set(best.id, (assignedCount.get(best.id) ?? 0) + 1);
        if (unit instanceof Engine) {
          unit.assignCluster(best.id, best.cx, best.cz, ctx);
        } else {
          unit.assignedCluster = best.id;
        }
      }
    }
  }

  /**
   * Hand the unit the best unclaimed perimeter voxel of its cluster within
   * `reach` of its current spot, keeping spacing from other claims. Without an
   * assigned cluster, only fires in close proximity are considered — dispatch
   * across the map is the player's job.
   */
  requestTarget(unit: UnitBase, reach = unit.stats.hoseRange): number {
    const cluster = this.clusters.byId(unit.assignedCluster);
    if (!cluster) {
      const near = this.clusters.nearestBurning(unit.x, unit.z);
      if (!near || near.dist > UNITS.ENGINE.engageRadius) return -1;
      unit.assignedCluster = near.cluster.id;
      return this.requestTarget(unit, reach);
    }
    this.releaseTarget(unit);
    let fallback = -1;
    for (const voxel of cluster.perimeter) {
      if (this.claims.has(voxel)) continue;
      if (!(this.grid.flags[voxel] & Flag.BURNING)) continue;
      const vx = Math.floor(voxel / (D * H));
      const vz = Math.floor(voxel / H) % D;
      if (Math.hypot(vx - unit.x, vz - unit.z) > reach) continue;
      if (this.tooCloseToOtherClaim(vx, vz, unit.id)) {
        if (fallback < 0) fallback = voxel;
        continue;
      }
      return this.claim(unit, voxel);
    }
    // spacing rule relaxed if nothing else is reachable
    if (fallback >= 0) return this.claim(unit, fallback);
    return -1;
  }

  /**
   * Like requestTarget, but searches the whole cluster perimeter for a voxel
   * with a road standing spot within hose range — used when nothing is
   * sprayable from the unit's current position, so it can drive to the fire's
   * far side instead of giving up.
   */
  requestEngagement(unit: UnitBase): { voxel: number; spotX: number; spotZ: number } | null {
    let cluster = this.clusters.byId(unit.assignedCluster);
    if (!cluster) {
      // no assignment: only fires in close proximity — never auto-dispatch across the map
      const near = this.clusters.nearestBurning(unit.x, unit.z);
      if (!near || near.dist > UNITS.ENGINE.engageRadius) return null;
      cluster = near.cluster;
    }
    unit.assignedCluster = cluster.id;
    this.releaseTarget(unit);
    let fallback: { voxel: number; spotX: number; spotZ: number } | null = null;
    for (const voxel of cluster.perimeter) {
      if (this.claims.has(voxel)) continue;
      if (!(this.grid.flags[voxel] & Flag.BURNING)) continue;
      const vx = Math.floor(voxel / (D * H));
      const vz = Math.floor(voxel / H) % D;
      const cell = this.roads.nearestRoadCell(vx, vz);
      if (!cell) continue;
      if (Math.hypot(cell.x - vx, cell.z - vz) > unit.stats.hoseRange * 0.9) continue;
      const result = { voxel, spotX: cell.x, spotZ: cell.z };
      if (this.tooCloseToOtherClaim(vx, vz, unit.id)) {
        if (!fallback) fallback = result;
        continue;
      }
      this.claim(unit, voxel);
      return result;
    }
    if (fallback) {
      this.claim(unit, fallback.voxel);
      return fallback;
    }
    return null;
  }

  private claim(unit: UnitBase, voxel: number): number {
    this.claims.set(voxel, unit.id);
    this.claimByUnit.set(unit.id, voxel);
    unit.targetVoxel = voxel;
    return voxel;
  }

  releaseTarget(unit: UnitBase): void {
    const voxel = this.claimByUnit.get(unit.id);
    if (voxel !== undefined) {
      this.claims.delete(voxel);
      this.claimByUnit.delete(unit.id);
    }
    unit.targetVoxel = -1;
  }

  private tooCloseToOtherClaim(x: number, z: number, unitId: number): boolean {
    for (const [voxel, owner] of this.claims) {
      if (owner === unitId) continue;
      const vx = Math.floor(voxel / (D * H));
      const vz = Math.floor(voxel / H) % D;
      if (Math.hypot(vx - x, vz - z) < UNITS.CLAIM_SPACING) return true;
    }
    return false;
  }

  /** Is there a road cell within hose range of this voxel? (engine reachability) */
  roadReachable(voxel: number, hoseRange: number): boolean {
    const vx = Math.floor(voxel / (D * H));
    const vz = Math.floor(voxel / H) % D;
    const cell = this.roads.nearestRoadCell(vx, vz);
    if (!cell) return false;
    return Math.hypot(cell.x - vx, cell.z - vz) <= hoseRange;
  }
}
