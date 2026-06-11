import { GRID, SIM } from '../config';
import { EventBus } from '../core/events';
import { Rng } from '../core/rng';
import { Building } from '../world/buildings';
import { CollapseSim } from '../world/collapse';
import { Flag, Mat, MATERIALS } from '../world/materials';
import { VoxelGrid } from '../world/voxelGrid';
import { Wind } from './wind';

const { W, D, H } = GRID;

/** Neighbour offsets: 6 faces + 4 horizontal diagonals. [dx, dy, dz, distanceScale] */
const NEIGHBOURS: ReadonlyArray<readonly [number, number, number, number]> = [
  [1, 0, 0, 1],
  [-1, 0, 0, 1],
  [0, 0, 1, 1],
  [0, 0, -1, 1],
  [0, 1, 0, 1],
  [0, -1, 0, 1],
  [1, 0, 1, 0.7],
  [1, 0, -1, 0.7],
  [-1, 0, 1, 0.7],
  [-1, 0, -1, 0.7],
];
const INV_SQRT2 = 1 / Math.SQRT2;

/**
 * Discrete-tick fire simulation over sparse active sets — never scans the full grid.
 * Owns ignition, heat radiation (wind-biased), burnout/charring/destruction and
 * the per-building damage ledger.
 */
export class FireSim {
  readonly activeFire = new Set<number>();
  /** Heated but not burning; cooled each tick. */
  readonly hotCells = new Set<number>();
  private wetTicks = new Map<number, number>();
  private ignitionQueue: number[] = [];
  /** Buildings with no remaining fire, counting down to settlement. */
  private pendingSettle = new Map<number, number>();
  readonly collapse: CollapseSim;

  /** Rotating-slice cursor for the MAX_FIRE_PER_TICK safety valve. */
  private sliceCursor = 0;

  // run stats
  totalExtinguished = 0;
  totalBurnedOut = 0;
  lastTickMs = 0;

  constructor(
    private grid: VoxelGrid,
    private buildings: Building[],
    private wind: Wind,
    private rng: Rng,
    private events: EventBus,
  ) {
    this.collapse = new CollapseSim(grid);
  }

  /** Ignite a voxel directly (outbreaks, embers, debug tool). Returns true if it caught. */
  ignite(idx: number): boolean {
    const mat = this.grid.material[idx];
    if (mat === Mat.AIR) return false;
    if (this.grid.flags[idx] & Flag.BURNING) return false;
    if (this.grid.fuel[idx] === 0) return false;
    if (MATERIALS[mat].flammability <= 0) return false;
    this.grid.flags[idx] = (this.grid.flags[idx] | Flag.BURNING) & ~(Flag.WET | Flag.SMOLDERING);
    this.wetTicks.delete(idx);
    // fixed ignition heat (not accumulated) so water knockdown effort stays uniform
    this.grid.heat[idx] = MATERIALS[mat].ignitionHeat * 2;
    this.activeFire.add(idx);
    this.hotCells.delete(idx);
    this.grid.markDirtyIdx(idx);
    const b = this.buildings[this.grid.owner[idx]];
    if (b && b.id !== 0) {
      b.hadFire = true;
      b.burningCount++;
      this.pendingSettle.delete(b.id);
    }
    this.events.emit('ignited', { idx });
    return true;
  }

  /** Remove fire from a voxel without burning it out (water knockdown). */
  private extinguish(idx: number): void {
    this.grid.flags[idx] = (this.grid.flags[idx] & ~Flag.BURNING) | Flag.SMOLDERING;
    this.activeFire.delete(idx);
    if (this.grid.heat[idx] > 0) this.hotCells.add(idx);
    this.grid.markDirtyIdx(idx);
    this.totalExtinguished++;
    this.onFireLeftVoxel(idx);
    this.events.emit('extinguished', { idx });
  }

  /** Cool a voxel by `amount` heat (called by WaterSim). */
  coolVoxel(idx: number, amount: number): void {
    this.grid.heat[idx] = Math.max(0, this.grid.heat[idx] - amount);
    const wasWet = this.grid.flags[idx] & Flag.WET;
    this.grid.flags[idx] |= Flag.WET;
    this.wetTicks.set(idx, SIM.WET_TICKS);
    if (!wasWet && this.grid.material[idx] !== Mat.AIR) this.grid.markDirtyIdx(idx);
    if (this.grid.flags[idx] & Flag.BURNING) {
      const mat = this.grid.material[idx];
      if (this.grid.heat[idx] < MATERIALS[mat].ignitionHeat * SIM.EXTINGUISH_FRACTION) {
        this.extinguish(idx);
      }
    }
  }

  tick(): void {
    const t0 = performance.now();
    this.burnPhase();
    this.applyIgnitions();
    this.coolPhase();
    this.decayWet();
    const collapsed = this.collapse.tick();
    for (const idx of collapsed) this.onVoxelDestroyed(idx, true);
    this.settlePhase();
    this.lastTickMs = performance.now() - t0;
  }

  private burnPhase(): void {
    const { grid, wind } = this;
    const n = this.activeFire.size;
    if (n === 0) return;
    // Rotating slice: if the fire is huge, process a window per tick.
    const limit = Math.min(n, SIM.MAX_FIRE_PER_TICK);
    const skip = n > limit ? this.sliceCursor % n : 0;
    this.sliceCursor += limit;
    let i = -1;
    let processed = 0;
    for (const idx of this.activeFire) {
      i++;
      if (i < skip) continue;
      if (processed >= limit) break;
      processed++;
      this.burnVoxel(idx);
    }
    // wrap-around for the slice window
    if (processed < limit) {
      for (const idx of this.activeFire) {
        if (processed >= limit) break;
        processed++;
        this.burnVoxel(idx);
      }
    }
    void grid;
    void wind;
  }

  private burnVoxel(idx: number): void {
    const { grid } = this;
    const mat = grid.material[idx];
    const def = MATERIALS[mat];
    // fuel consumption
    if (grid.fuel[idx] > 0) grid.fuel[idx]--;
    if (grid.fuel[idx] === 0) {
      this.burnOut(idx, def.destroyOnBurnout);
      return;
    }
    this.radiate(idx, def.heatOutput);
    // ember spot fires from exposed (sky-open) burning voxels
    const y = idx % H;
    if (y + 1 < H && grid.material[idx + 1] === Mat.AIR && this.wind.strength > 0.2) {
      if (this.rng.chance(SIM.EMBER_CHANCE * this.wind.strength)) {
        this.throwEmber(idx);
      }
    }
  }

  private radiate(idx: number, heatOutput: number): void {
    const { grid, wind } = this;
    const x = Math.floor(idx / (D * H));
    const z = Math.floor(idx / H) % D;
    const y = idx % H;
    for (let k = 0; k < NEIGHBOURS.length; k++) {
      const [dx, dy, dz, distScale] = NEIGHBOURS[k];
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (nx < 0 || nx >= W || nz < 0 || nz >= D || ny < 0 || ny >= H) continue;
      const nIdx = idx + (dx * D + dz) * H + dy;
      const nMat = grid.material[nIdx];
      if (nMat === Mat.AIR || nMat === Mat.WATER) continue;
      const nFlags = grid.flags[nIdx];
      if (nFlags & Flag.BURNING) continue;

      // wind bias on the horizontal component
      let windMul = 1;
      if (dx !== 0 || dz !== 0) {
        const norm = dx !== 0 && dz !== 0 ? INV_SQRT2 : 1;
        const dot = (dx * wind.dirX + dz * wind.dirZ) * norm;
        windMul = Math.min(Math.max(1 + SIM.WIND_BIAS * dot * wind.strength, SIM.WIND_MUL_MIN), SIM.WIND_MUL_MAX);
      }
      const vertMul = dy > 0 ? SIM.VERT_MUL_UP : dy < 0 ? SIM.VERT_MUL_DOWN : 1;
      const wetMul = nFlags & Flag.WET ? SIM.WET_MUL : 1;
      const wasHot = grid.heat[nIdx] > 0;
      grid.heat[nIdx] = Math.min(SIM.HEAT_MAX, grid.heat[nIdx] + heatOutput * windMul * vertMul * wetMul * distScale);
      if (!wasHot && grid.heat[nIdx] > 0) this.hotCells.add(nIdx);

      // ignition roll — wind/vertical bias applies here too, so fronts lean downwind and climb
      if (grid.fuel[nIdx] > 0) {
        const nDef = MATERIALS[nMat];
        if (grid.heat[nIdx] > nDef.ignitionHeat) {
          if (this.rng.chance(nDef.flammability * SIM.SPREAD_RATE * wetMul * windMul * vertMul)) {
            this.ignitionQueue.push(nIdx);
          }
        }
      }
    }
  }

  private throwEmber(idx: number): void {
    const dist = this.rng.range(SIM.EMBER_MIN_DIST, SIM.EMBER_MAX_DIST);
    const jitter = this.rng.range(-1.5, 1.5);
    const x = Math.floor(idx / (D * H));
    const z = Math.floor(idx / H) % D;
    const tx = Math.round(x + this.wind.dirX * dist - this.wind.dirZ * jitter);
    const tz = Math.round(z + this.wind.dirZ * dist + this.wind.dirX * jitter);
    if (tx < 0 || tx >= W || tz < 0 || tz >= D) return;
    const ty = this.grid.topY(tx, tz);
    if (ty < 0) return;
    const tIdx = this.grid.idx(tx, ty, tz);
    const def = MATERIALS[this.grid.material[tIdx]];
    if (this.grid.fuel[tIdx] > 0 && this.rng.chance(def.flammability * 0.6)) {
      this.ignite(tIdx);
    }
  }

  private burnOut(idx: number, destroyChance: number): void {
    const { grid } = this;
    grid.flags[idx] = (grid.flags[idx] & ~Flag.BURNING) | Flag.CHARRED;
    this.activeFire.delete(idx);
    if (grid.heat[idx] > 0) this.hotCells.add(idx);
    this.totalBurnedOut++;
    const b = this.buildings[grid.owner[idx]];
    if (b && b.id !== 0) b.damagedVoxels++;
    this.onFireLeftVoxel(idx);
    if (this.rng.chance(destroyChance)) {
      const x = Math.floor(idx / (D * H));
      const z = Math.floor(idx / H) % D;
      const y = idx % H;
      grid.material[idx] = Mat.AIR;
      grid.fuel[idx] = 0;
      grid.flags[idx] |= Flag.DESTROYED;
      this.onVoxelDestroyed(idx, false);
      this.collapse.onDestroyed(x, y, z);
    }
    grid.markDirtyIdx(idx);
    this.events.emit('burnedOut', { idx });
  }

  /** Shared bookkeeping when a voxel stops burning for any reason. */
  private onFireLeftVoxel(idx: number): void {
    const b = this.buildings[this.grid.owner[idx]];
    if (b && b.id !== 0) {
      b.burningCount = Math.max(0, b.burningCount - 1);
      if (b.burningCount === 0 && b.hadFire && !b.resolved) {
        // settle after a short delay in case fire re-enters
        this.pendingSettle.set(b.id, 20);
      }
    }
  }

  /** countsAsDamage=true for collapse-destroyed voxels that never burned. */
  private onVoxelDestroyed(idx: number, countsAsDamage: boolean): void {
    if (this.grid.flags[idx] & Flag.BURNING) {
      this.activeFire.delete(idx);
      this.onFireLeftVoxel(idx);
    }
    this.hotCells.delete(idx);
    this.grid.heat[idx] = 0;
    if (countsAsDamage) {
      const b = this.buildings[this.grid.owner[idx]];
      if (b && b.id !== 0) b.damagedVoxels++;
    }
    this.events.emit('voxelDestroyed', { idx });
  }

  private applyIgnitions(): void {
    for (const idx of this.ignitionQueue) this.ignite(idx);
    this.ignitionQueue.length = 0;
  }

  private coolPhase(): void {
    const { grid } = this;
    const toRemove: number[] = [];
    for (const idx of this.hotCells) {
      grid.heat[idx] *= SIM.HEAT_DECAY;
      if (grid.heat[idx] < SIM.HEAT_EPSILON) {
        grid.heat[idx] = 0;
        grid.flags[idx] &= ~Flag.SMOLDERING;
        toRemove.push(idx);
      } else if (grid.fuel[idx] > 0 && grid.heat[idx] > MATERIALS[grid.material[idx]].ignitionHeat * 0.5) {
        grid.flags[idx] |= Flag.SMOLDERING;
      }
    }
    for (const idx of toRemove) this.hotCells.delete(idx);
  }

  private decayWet(): void {
    const expired: number[] = [];
    for (const [idx, t] of this.wetTicks) {
      if (t <= 1) expired.push(idx);
      else this.wetTicks.set(idx, t - 1);
    }
    for (const idx of expired) {
      this.wetTicks.delete(idx);
      this.grid.flags[idx] &= ~Flag.WET;
      if (this.grid.material[idx] !== Mat.AIR) this.grid.markDirtyIdx(idx);
    }
  }

  private settlePhase(): void {
    const settled: number[] = [];
    for (const [bid, t] of this.pendingSettle) {
      const b = this.buildings[bid];
      if (b.burningCount > 0) {
        settled.push(bid); // re-ignited; drop the timer (re-added on next clear)
        continue;
      }
      if (t <= 1) {
        settled.push(bid);
        if (!b.resolved) {
          b.resolved = true;
          const damageRatio = b.totalVoxels > 0 ? b.damagedVoxels / b.totalVoxels : 1;
          const outcome = damageRatio < 0.3 ? 'saved' : damageRatio > 0.7 ? 'lost' : 'damaged';
          this.events.emit('buildingSettled', { buildingId: bid, outcome, damageRatio });
        }
      } else {
        this.pendingSettle.set(bid, t - 1);
      }
    }
    for (const bid of settled) this.pendingSettle.delete(bid);
  }
}
