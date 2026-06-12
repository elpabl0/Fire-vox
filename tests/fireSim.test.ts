import { beforeEach, describe, expect, it } from 'vitest';
import { GRID, SIM } from '../src/config';
import { EventBus } from '../src/core/events';
import { Rng } from '../src/core/rng';
import { FireSim } from '../src/sim/fireSim';
import { Wind } from '../src/sim/wind';
import { Building, makeBuilding } from '../src/world/buildings';
import { Flag, Mat } from '../src/world/materials';
import { VoxelGrid } from '../src/world/voxelGrid';
import { generateCity } from '../src/world/citygen';

function makeSim(grid: VoxelGrid, buildings: Building[] = [makeBuilding(0, 'house', 0, 0, 0, 0, 0)]) {
  const events = new EventBus();
  const wind = new Wind(new Rng(7));
  wind.strength = 0;
  const sim = new FireSim(grid, buildings, wind, new Rng(11), events);
  return { sim, wind, events };
}

function grassPlane(): VoxelGrid {
  const grid = new VoxelGrid();
  for (let x = 0; x < GRID.W; x++) {
    for (let z = 0; z < GRID.D; z++) {
      grid.setVoxel(x, 0, z, Mat.GRASS);
    }
  }
  return grid;
}

describe('FireSim', () => {
  let grid: VoxelGrid;

  beforeEach(() => {
    grid = grassPlane();
  });

  it('ignites flammable voxels and refuses inert ones', () => {
    const { sim } = makeSim(grid);
    grid.setVoxel(10, 0, 10, Mat.ASPHALT);
    expect(sim.ignite(grid.idx(5, 0, 5))).toBe(true);
    expect(sim.ignite(grid.idx(10, 0, 10))).toBe(false);
    expect(grid.flags[grid.idx(5, 0, 5)] & Flag.BURNING).toBeTruthy();
  });

  it('spreads to neighbouring fuel over time', () => {
    const { sim } = makeSim(grid);
    sim.ignite(grid.idx(64, 0, 64));
    for (let t = 0; t < 60; t++) sim.tick();
    expect(sim.activeFire.size).toBeGreaterThan(3);
  });

  it('burns out: fuel exhausts, voxel chars, fire eventually dies on limited fuel', () => {
    // single tree of fuel surrounded by concrete
    const small = new VoxelGrid();
    for (let x = 0; x < GRID.W; x++) {
      for (let z = 0; z < GRID.D; z++) {
        small.setVoxel(x, 0, z, Mat.CONCRETE);
      }
    }
    small.setVoxel(20, 0, 20, Mat.GRASS);
    const { sim } = makeSim(small);
    const idx = small.idx(20, 0, 20);
    sim.ignite(idx);
    for (let t = 0; t < 200 && sim.activeFire.size > 0; t++) sim.tick();
    expect(sim.activeFire.size).toBe(0);
    expect(small.flags[idx] & Flag.CHARRED).toBeTruthy();
  });

  it('no immortal fires: a bounded grass field eventually exhausts', () => {
    // 40x40 grass patch surrounded by concrete
    const field = new VoxelGrid();
    for (let x = 0; x < GRID.W; x++) {
      for (let z = 0; z < GRID.D; z++) {
        const inPatch = x >= 50 && x < 90 && z >= 50 && z < 90;
        field.setVoxel(x, 0, z, inPatch ? Mat.GRASS : Mat.CONCRETE);
      }
    }
    const { sim } = makeSim(field);
    sim.ignite(field.idx(70, 0, 70));
    for (let t = 0; t < 3000 && sim.activeFire.size > 0; t++) sim.tick();
    expect(sim.activeFire.size).toBe(0);
  });

  it('wind biases spread: burn centroid shifts downwind', () => {
    const { sim, wind } = makeSim(grid);
    wind.angle = 0; // blowing toward +x
    wind.strength = 0.9;
    wind.dirX = 1;
    wind.dirZ = 0;
    sim.ignite(grid.idx(64, 0, 64));
    for (let t = 0; t < 80; t++) sim.tick();
    // centroid of all burned/burning cells
    let sx = 0;
    let n = 0;
    for (let x = 0; x < GRID.W; x++) {
      for (let z = 0; z < GRID.D; z++) {
        const idx = grid.idx(x, 0, z);
        if (grid.flags[idx] & (Flag.BURNING | Flag.CHARRED)) {
          sx += x;
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(10);
    expect(sx / n).toBeGreaterThan(66); // displaced east of the ignition point
  });

  it('water extinguishes a burning voxel', () => {
    const { sim } = makeSim(grid);
    const idx = grid.idx(30, 0, 30);
    sim.ignite(idx);
    sim.coolVoxel(idx, 10000);
    expect(grid.flags[idx] & Flag.BURNING).toBeFalsy();
    expect(sim.activeFire.has(idx)).toBe(false);
    expect(sim.totalExtinguished).toBe(1);
  });

  it('wet voxels resist ignition spread', () => {
    const { sim } = makeSim(grid);
    // soak a ring around the ignition point
    for (let x = 60; x <= 68; x++) {
      for (let z = 60; z <= 68; z++) {
        if (x === 64 && z === 64) continue;
        sim.coolVoxel(grid.idx(x, 0, z), 0.01);
      }
    }
    sim.ignite(grid.idx(64, 0, 64));
    for (let t = 0; t < 8; t++) sim.tick();
    // with WET_MUL heat transfer the fire should still be tiny
    expect(sim.activeFire.size).toBeLessThan(6);
  });

  it('settles buildings: saved when barely damaged', () => {
    const small = new VoxelGrid();
    for (let x = 0; x < GRID.W; x++) {
      for (let z = 0; z < GRID.D; z++) {
        small.setVoxel(x, 0, z, Mat.CONCRETE);
      }
    }
    const b = makeBuilding(1, 'house', 1, 40, 40, 44, 44);
    const buildings = [makeBuilding(0, 'house', 0, 0, 0, 0, 0), b];
    // hand-stamp a small wood building
    for (let x = 40; x <= 44; x++) {
      for (let z = 40; z <= 44; z++) {
        small.setVoxel(x, 1, z, Mat.WOOD_WALL, 1);
        b.totalVoxels++;
      }
    }
    const { sim, events } = makeSim(small, buildings);
    let settled: string | null = null;
    events.on('buildingSettled', ({ outcome }) => (settled = outcome));
    const idx = small.idx(42, 1, 42);
    sim.ignite(idx);
    sim.tick();
    sim.coolVoxel(idx, 10000); // immediate knockdown
    for (let t = 0; t < 40; t++) sim.tick();
    expect(settled).toBe('saved');
    expect(b.resolved).toBe(true);
  });

  it('headless determinism: city + 200 ticks produces a stable hash', () => {
    const run = () => {
      const city = generateCity(2024);
      const events = new EventBus();
      const wind = new Wind(new Rng(3));
      const sim = new FireSim(city.grid, city.buildings, wind, new Rng(5), events);
      // ignite a deterministic spot
      const idx = city.grid.idx(40, 1, 40);
      const ty = city.grid.topY(40, 40);
      sim.ignite(city.grid.idx(40, Math.max(0, ty), 40));
      void idx;
      for (let t = 0; t < 200; t++) {
        wind.update(SIM.TICK_DT);
        sim.tick();
      }
      return city.grid.stateHash();
    };
    expect(run()).toBe(run());
  });
});
