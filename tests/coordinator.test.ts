import { describe, expect, it } from 'vitest';
import { GRID, UNITS } from '../src/config';
import { EventBus } from '../src/core/events';
import { Rng } from '../src/core/rng';
import { FireClusterizer } from '../src/sim/fireClusters';
import { FireSim } from '../src/sim/fireSim';
import { Wind } from '../src/sim/wind';
import { Coordinator } from '../src/units/coordinator';
import { Engine } from '../src/units/engine';
import { makeBuilding } from '../src/world/buildings';
import { Mat } from '../src/world/materials';
import { RoadNetwork } from '../src/world/roadGraph';
import { VoxelGrid } from '../src/world/voxelGrid';

function setup() {
  const grid = new VoxelGrid();
  for (let x = 0; x < GRID.W; x++) {
    for (let z = 0; z < GRID.D; z++) {
      grid.setVoxel(x, 0, z, Mat.GRASS);
    }
  }
  const roads = new RoadNetwork();
  for (let x = 0; x < GRID.W; x++) roads.setRoad(x, 60);
  roads.computeFields();
  const events = new EventBus();
  const wind = new Wind(new Rng(1));
  wind.strength = 0;
  const fire = new FireSim(grid, [makeBuilding(0, 'house', 0, 0, 0, 0, 0)], wind, new Rng(2), events);
  const clusters = new FireClusterizer(grid, wind);
  const coordinator = new Coordinator(grid, roads, clusters);
  return { grid, roads, fire, clusters, coordinator, wind };
}

describe('Coordinator', () => {
  it('gives two units distinct, spaced targets on the same cluster', () => {
    const { grid, fire, clusters, coordinator } = setup();
    // a line of fire near the road
    for (let x = 55; x <= 75; x++) fire.ignite(grid.idx(x, 0, 64));
    clusters.update(fire.activeFire);
    expect(clusters.clusters.length).toBe(1);

    const a = new Engine(UNITS.ENGINE, 1);
    a.x = 60;
    a.z = 60;
    a.assignedCluster = clusters.clusters[0].id;
    const b = new Engine(UNITS.ENGINE, 2);
    b.x = 70;
    b.z = 60;
    b.assignedCluster = clusters.clusters[0].id;

    const ta = coordinator.requestTarget(a);
    const tb = coordinator.requestTarget(b);
    expect(ta).toBeGreaterThanOrEqual(0);
    expect(tb).toBeGreaterThanOrEqual(0);
    expect(ta).not.toBe(tb);
    // spacing respected
    const ax = Math.floor(ta / (GRID.D * GRID.H));
    const az = Math.floor(ta / GRID.H) % GRID.D;
    const bx = Math.floor(tb / (GRID.D * GRID.H));
    const bz = Math.floor(tb / GRID.H) % GRID.D;
    expect(Math.hypot(ax - bx, az - bz)).toBeGreaterThanOrEqual(UNITS.CLAIM_SPACING);
  });

  it('releases claims when the voxel stops burning', () => {
    const { grid, fire, clusters, coordinator } = setup();
    fire.ignite(grid.idx(64, 0, 64));
    clusters.update(fire.activeFire);
    const unit = new Engine(UNITS.ENGINE, 1);
    unit.x = 64;
    unit.z = 60;
    unit.assignedCluster = clusters.clusters[0].id;
    const target = coordinator.requestTarget(unit);
    expect(target).toBeGreaterThanOrEqual(0);
    fire.coolVoxel(target, 10000); // extinguish
    coordinator.replan([unit], fire.activeFire, null as never, false);
    expect(unit.targetVoxel).toBe(-1);
  });

  it('respects hose range: far fires yield no claim', () => {
    const { grid, fire, clusters, coordinator } = setup();
    fire.ignite(grid.idx(64, 0, 120)); // 60 cells from the unit
    clusters.update(fire.activeFire);
    const unit = new Engine(UNITS.ENGINE, 1);
    unit.x = 64;
    unit.z = 60;
    unit.assignedCluster = clusters.clusters[0].id;
    expect(coordinator.requestTarget(unit)).toBe(-1);
  });
});
