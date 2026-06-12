import { describe, expect, it } from 'vitest';
import { GRID, UNITS } from '../src/config';
import { EventBus } from '../src/core/events';
import { Rng } from '../src/core/rng';
import { repairBuilding, repairCost, canRepair } from '../src/meta/repair';
import { FireClusterizer } from '../src/sim/fireClusters';
import { FireSim } from '../src/sim/fireSim';
import { WaterSim } from '../src/sim/waterSim';
import { Weather } from '../src/sim/weather';
import { Wind } from '../src/sim/wind';
import { Helicopter } from '../src/units/helicopter';
import { UnitContext } from '../src/units/unit';
import { UnitManager } from '../src/units/unitManager';
import { Building, makeBuilding, stampHouse } from '../src/world/buildings';
import { Mat } from '../src/world/materials';
import { RoadNetwork } from '../src/world/roadGraph';
import { VoxelGrid } from '../src/world/voxelGrid';

function concretePlane(): VoxelGrid {
  const grid = new VoxelGrid();
  for (let x = 0; x < GRID.W; x++) {
    for (let z = 0; z < GRID.D; z++) {
      grid.setVoxel(x, 0, z, Mat.CONCRETE);
    }
  }
  return grid;
}

function makeSim(grid: VoxelGrid, buildings: Building[]) {
  const events = new EventBus();
  const wind = new Wind(new Rng(7));
  wind.strength = 0;
  return { sim: new FireSim(grid, buildings, wind, new Rng(11), events), wind, events };
}

describe('repair tool', () => {
  it('restores a burned building to pristine state and resets its ledger', () => {
    const grid = concretePlane();
    const b = makeBuilding(1, 'house', 1, 40, 40, 46, 46);
    const buildings = [makeBuilding(0, 'house', 0, 0, 0, 0, 0), b];
    stampHouse(grid, new Rng(5), b);
    grid.snapshotOriginal();
    const beforeHash = grid.stateHash();

    const { sim } = makeSim(grid, buildings);
    sim.ignite(grid.idx(43, 1, 43));
    for (let t = 0; t < 600 && sim.activeFire.size > 0; t++) sim.tick();
    expect(b.damagedVoxels).toBeGreaterThan(0);
    expect(grid.stateHash()).not.toBe(beforeHash);

    expect(canRepair(b).ok).toBe(true);
    const cost = repairCost(b);
    expect(cost).toBeGreaterThan(0);
    repairBuilding(grid, sim, b);
    expect(grid.stateHash()).toBe(beforeHash);
    expect(b.damagedVoxels).toBe(0);
    expect(b.hadFire).toBe(false);
    expect(b.resolved).toBe(false);
  });

  it('refuses to repair while the building burns', () => {
    const grid = concretePlane();
    const b = makeBuilding(1, 'house', 1, 40, 40, 46, 46);
    stampHouse(grid, new Rng(5), b);
    grid.snapshotOriginal();
    const { sim } = makeSim(grid, [makeBuilding(0, 'house', 0, 0, 0, 0, 0), b]);
    sim.ignite(grid.idx(43, 1, 43));
    sim.tick();
    b.damagedVoxels = 5; // pretend some damage already
    expect(canRepair(b).ok).toBe(false);
  });
});

describe('weather', () => {
  it('rain suppresses fire spread', () => {
    const burn = (rainy: boolean) => {
      const grid = new VoxelGrid();
      for (let x = 0; x < GRID.W; x++) {
        for (let z = 0; z < GRID.D; z++) {
          grid.setVoxel(x, 0, z, Mat.GRASS);
        }
      }
      const { sim } = makeSim(grid, [makeBuilding(0, 'house', 0, 0, 0, 0, 0)]);
      if (rainy) {
        sim.environmentSpreadMul = 0.45;
        sim.rainDouse = 2.2;
      }
      sim.ignite(grid.idx(100, 0, 100));
      for (let t = 0; t < 120; t++) sim.tick();
      return sim.totalBurnedOut + sim.activeFire.size;
    };
    const dry = burn(false);
    const wet = burn(true);
    expect(wet).toBeLessThan(dry);
  });

  it('storms force strong wind', () => {
    const rng = new Rng(3);
    const weather = new Weather(rng);
    const wind = new Wind(new Rng(4));
    const grid = concretePlane();
    const { sim } = makeSim(grid, [makeBuilding(0, 'house', 0, 0, 0, 0, 0)]);
    weather.kind = 'storm';
    weather.intensity = 1;
    // run a few updates so the floor applies
    for (let i = 0; i < 10; i++) {
      weather.update(0.1, sim, wind);
      wind.update(0.1);
    }
    expect(wind.strength).toBeGreaterThanOrEqual(0.8);
  });
});

describe('hydrants', () => {
  it('engines refill at the nearest water point', () => {
    const grid = concretePlane();
    const roads = new RoadNetwork();
    for (let x = 0; x < GRID.W; x++) roads.setRoad(x, 60);
    roads.computeFields();
    const { sim } = makeSim(grid, [makeBuilding(0, 'house', 0, 0, 0, 0, 0)]);
    const water = new WaterSim(grid, sim);
    const clusters = new FireClusterizer(grid, new Wind(new Rng(1)));
    const units = new UnitManager(grid, roads, water, sim, clusters, new Rng(2), { x: 10, z: 60 }, { x: 0, z: 0 });
    expect(units.nearestRefill(200, 60)).toEqual({ x: 10, z: 60 }); // only the station
    units.placeHydrant(190, 60);
    expect(units.nearestRefill(200, 60)).toEqual({ x: 190, z: 60 });
    expect(units.nearestRefill(15, 60)).toEqual({ x: 10, z: 60 });
  });
});

describe('helicopter', () => {
  it('returns to base and lands when there is nothing to fight', () => {
    const grid = concretePlane();
    const wind = new Wind(new Rng(1));
    const clusters = new FireClusterizer(grid, wind);
    const ctx: UnitContext = {
      grid,
      roads: new RoadNetwork(),
      water: null as never,
      clusters,
      rng: new Rng(9),
      stationDoor: { x: 50, z: 50 },
      pond: { x: 10, z: 10 },
      nearestRefill: () => ({ x: 50, z: 50 }),
      requestTarget: () => -1,
      requestEngagement: () => null,
      releaseTarget: () => undefined,
      obstacleAhead: () => false,
    };
    const heli = new Helicopter({
      speed: UNITS.HELICOPTER.speed,
      hoseRange: 0,
      hosePower: 0,
      waterMax: UNITS.HELICOPTER.waterMax,
      refillRate: UNITS.HELICOPTER.fillRate,
    });
    heli.x = 100;
    heli.z = 100;
    // send it airborne at a real fire, then put the fire out mid-flight
    grid.setVoxel(110, 0, 110, Mat.GRASS);
    const { sim } = makeSim(grid, [makeBuilding(0, 'house', 0, 0, 0, 0, 0)]);
    sim.ignite(grid.idx(110, 0, 110));
    clusters.update(sim.activeFire);
    heli.orderTo(110, 110, ctx);
    expect(heli.state).toBe('toFire');
    sim.coolVoxel(grid.idx(110, 0, 110), 10000);
    clusters.update(sim.activeFire);
    for (let t = 0; t < 600; t++) heli.update(0.1, ctx);
    expect(heli.state).toBe('landed');
    expect(Math.hypot(heli.x - 50, heli.z - 50)).toBeLessThan(1);
    expect(heli.y).toBeLessThan(2);
  });
});
