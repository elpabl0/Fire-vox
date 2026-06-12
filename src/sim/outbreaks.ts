import { ECONOMY, GRID, WAVES } from '../config';
import { EventBus } from '../core/events';
import { Rng } from '../core/rng';
import { Building } from '../world/buildings';
import { Mat, MATERIALS } from '../world/materials';
import { VoxelGrid } from '../world/voxelGrid';
import { FireSim } from './fireSim';
import { Wind } from './wind';

const { W, D } = GRID;

/**
 * Wave director: schedules fire outbreaks with escalating count/frequency,
 * detects wave-clear (all scheduled ignitions done and no active fire), and
 * caps wind strength per wave.
 */
export class WaveDirector {
  wave = 1;
  private ignitionsLeft = 0;
  private nextIgnitionIn = 0;
  private graceLeft = 5; // initial calm before wave 1
  private waveActive = false;

  /** Early-wave outbreaks are biased near this point (the fire HQ). */
  origin = { x: GRID.W / 2, z: GRID.D / 2 };

  constructor(
    private grid: VoxelGrid,
    private buildings: Building[],
    private fire: FireSim,
    private wind: Wind,
    private rng: Rng,
    private events: EventBus,
  ) {
    this.wind.strengthCap = WAVES.windCap(1);
  }

  update(dt: number): void {
    if (!this.waveActive) {
      this.graceLeft -= dt;
      if (this.graceLeft <= 0) this.startWave();
      return;
    }
    if (this.ignitionsLeft > 0) {
      this.nextIgnitionIn -= dt;
      if (this.nextIgnitionIn <= 0) {
        this.spawnOutbreak();
        this.ignitionsLeft--;
        this.nextIgnitionIn = WAVES.ignitionInterval(this.wave) * this.rng.range(0.7, 1.3);
      }
    } else if (this.fire.activeFire.size === 0) {
      this.waveActive = false;
      this.graceLeft = WAVES.GRACE_S;
      this.events.emit('waveCleared', { wave: this.wave, bonus: ECONOMY.WAVE_CLEAR_BONUS(this.wave) });
      this.wave++;
    }
  }

  private startWave(): void {
    this.waveActive = true;
    this.ignitionsLeft = WAVES.ignitionCount(this.wave);
    this.nextIgnitionIn = 2;
    this.wind.strengthCap = WAVES.windCap(this.wave);
    this.events.emit('waveStarted', { wave: this.wave });
  }

  /** Pick a target and ignite a small cluster of voxels there. */
  private spawnOutbreak(): void {
    const target = this.pickTarget();
    if (!target) return;
    const { x, z } = target;
    let lit = 0;
    for (let attempt = 0; attempt < 12 && lit < 3; attempt++) {
      const tx = x + this.rng.int(-1, 1);
      const tz = z + this.rng.int(-1, 1);
      if (tx < 0 || tx >= W || tz < 0 || tz >= D) continue;
      const ty = this.grid.topY(tx, tz);
      if (ty < 0) continue;
      // try the top voxel and one below (walls)
      for (const y of [ty, Math.max(0, ty - 1)]) {
        const idx = this.grid.idx(tx, y, tz);
        if (this.grid.fuel[idx] > 0 && MATERIALS[this.grid.material[idx]].flammability > 0) {
          if (this.fire.ignite(idx)) lit++;
          break;
        }
      }
    }
    if (lit > 0) this.events.emit('outbreak', { x, z });
  }

  private pickTarget(): { x: number; z: number } | null {
    const allowIndustrial = this.wave >= WAVES.INDUSTRIAL_FROM_WAVE;
    const radius = WAVES.targetRadius(this.wave);
    // 75%: a building; 25%: vegetation (random grass/tree spot)
    if (this.rng.chance(0.75)) {
      const candidates: Building[] = [];
      for (let i = 1; i < this.buildings.length; i++) {
        const b = this.buildings[i];
        if (b.kind === 'station') continue;
        if (!allowIndustrial && (b.kind === 'industrial' || b.kind === 'tower')) continue;
        if (Math.hypot((b.x0 + b.x1) / 2 - this.origin.x, (b.z0 + b.z1) / 2 - this.origin.z) > radius) continue;
        candidates.push(b);
      }
      if (candidates.length > 0) {
        const b = this.rng.pick(candidates);
        return { x: this.rng.int(b.x0, b.x1), z: this.rng.int(b.z0, b.z1) };
      }
    }
    // vegetation: rejection-sample a flammable ground cell within the wave radius
    for (let attempt = 0; attempt < 30; attempt++) {
      const x = this.rng.int(0, W - 1);
      const z = this.rng.int(0, D - 1);
      if (Math.hypot(x - this.origin.x, z - this.origin.z) > radius) continue;
      const ty = this.grid.topY(x, z);
      if (ty < 0) continue;
      const mat = this.grid.material[this.grid.idx(x, ty, z)];
      if (mat === Mat.GRASS || mat === Mat.LEAVES || mat === Mat.TREE_TRUNK) return { x, z };
    }
    return null;
  }
}
