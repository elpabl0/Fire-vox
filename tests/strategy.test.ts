import { describe, expect, it } from 'vitest';
import { BUDGET, GRID } from '../src/config';
import { EventBus } from '../src/core/events';
import { Rng } from '../src/core/rng';
import { Budget } from '../src/meta/budget';
import { Economy } from '../src/meta/economy';
import { UpgradeShop } from '../src/meta/upgrades';
import { CivilianManager } from '../src/sim/civilians';
import { DetectionSystem } from '../src/sim/detection';
import { FireClusterizer } from '../src/sim/fireClusters';
import { FireSim } from '../src/sim/fireSim';
import { WaterSim } from '../src/sim/waterSim';
import { Wind } from '../src/sim/wind';
import { UnitManager } from '../src/units/unitManager';
import { Building, makeBuilding } from '../src/world/buildings';
import { Mat } from '../src/world/materials';
import { RoadNetwork } from '../src/world/roadGraph';
import { VoxelGrid } from '../src/world/voxelGrid';

function grassPlane(): VoxelGrid {
  const grid = new VoxelGrid();
  for (let x = 0; x < GRID.W; x++) {
    for (let z = 0; z < GRID.D; z++) {
      grid.setVoxel(x, 0, z, Mat.GRASS);
    }
  }
  return grid;
}

function makeFire(grid: VoxelGrid, buildings: Building[] = [makeBuilding(0, 'house', 0, 0, 0, 0, 0)]) {
  const events = new EventBus();
  const wind = new Wind(new Rng(7));
  wind.strength = 0;
  return { fire: new FireSim(grid, buildings, wind, new Rng(11), events), wind, events };
}

describe('DetectionSystem', () => {
  it('reports a fire only after the delay; dispatch marks it known immediately', () => {
    const grid = grassPlane();
    const { fire, wind, events } = makeFire(grid);
    const clusters = new FireClusterizer(grid, wind);
    const detection = new DetectionSystem(clusters, null, events);
    let reported = 0;
    events.on('fireReported', () => reported++);

    fire.ignite(grid.idx(100, 0, 100));
    clusters.update(fire.activeFire);
    const id = clusters.clusters[0].id;

    detection.update(5);
    expect(detection.isReported(id)).toBe(false);
    expect(reported).toBe(0);
    detection.update(60); // well past the base delay
    expect(detection.isReported(id)).toBe(true);
    expect(reported).toBe(1);

    // a second fire, marked known by a player dispatch
    fire.ignite(grid.idx(40, 0, 40));
    clusters.update(fire.activeFire);
    const id2 = clusters.clusters.find((c) => c.id !== id)!.id;
    detection.update(0.1);
    expect(detection.isReported(id2)).toBe(false);
    detection.markKnown(id2);
    expect(detection.isReported(id2)).toBe(true);
  });

  it('larger fires are reported sooner', () => {
    const grid = grassPlane();
    const { fire, wind, events } = makeFire(grid);
    const clusters = new FireClusterizer(grid, wind);
    const detection = new DetectionSystem(clusters, null, events);
    // a 60-voxel blaze: delay = max(6, 40 - 60*0.4) = 16s
    for (let x = 90; x < 100; x++) {
      for (let z = 90; z < 96; z++) {
        fire.ignite(grid.idx(x, 0, z));
      }
    }
    clusters.update(fire.activeFire);
    const id = clusters.clusters[0].id;
    detection.update(17);
    expect(detection.isReported(id)).toBe(true);
  });
});

describe('Budget', () => {
  function setup() {
    const grid = grassPlane();
    const roads = new RoadNetwork();
    for (let x = 0; x < GRID.W; x++) roads.setRoad(x, 60);
    roads.computeFields();
    const buildings = [
      makeBuilding(0, 'house', 0, 0, 0, 0, 0),
      makeBuilding(1, 'house', 1, 10, 10, 14, 14),
      makeBuilding(2, 'office', 2, 20, 10, 24, 14),
      makeBuilding(3, 'tower', 3, 30, 10, 34, 14),
    ];
    for (const b of buildings) b.totalVoxels = 100;
    const events = new EventBus();
    const wind = new Wind(new Rng(1));
    const fire = new FireSim(grid, buildings, wind, new Rng(2), events);
    const water = new WaterSim(grid, fire);
    const clusters = new FireClusterizer(grid, wind);
    const detection = new DetectionSystem(clusters, null, events);
    const units = new UnitManager(grid, roads, water, fire, clusters, new Rng(3), { x: 10, z: 60 }, { x: 0, z: 0 });
    units.spawnEngine();
    const economy = new Economy(buildings, events, { wave: 1 });
    const shop = new UpgradeShop();
    const budget = new Budget(buildings, economy, units, shop, detection, events);
    return { budget, economy, units, buildings, detection };
  }

  it('collects tax minus upkeep at month end', () => {
    const { budget, economy } = setup();
    // lotValue total 6, integrity 100 -> tax = 6 * 1.2 * 1.0 * 1.0 = 7 (rounded)
    expect(budget.taxIncome()).toBe(Math.round(6 * BUDGET.TAX_PER_LOT_VALUE));
    const exp = budget.expenses();
    expect(exp.engineUpkeep).toBe(BUDGET.ENGINE_UPKEEP);
    const before = economy.cash;
    budget.update(BUDGET.MONTH_S + 0.001);
    expect(budget.month).toBe(2);
    expect(budget.lastReport).not.toBeNull();
    expect(economy.cash - before).toBe(budget.lastReport!.net >= 0 ? budget.lastReport!.net : -Math.min(before, -budget.lastReport!.net));
  });

  it('destroyed buildings stop paying tax', () => {
    const { budget, buildings } = setup();
    const base = budget.taxIncome();
    buildings[3].damagedVoxels = 90; // tower (lotValue 3) ruined
    expect(budget.taxIncome()).toBeLessThan(base);
  });

  it('savings focus cuts running costs; policy multipliers apply', () => {
    const { budget, units } = setup();
    const normal = budget.expenses().upkeep;
    budget.focus = 'savings';
    budget.applyPolicy();
    expect(budget.expenses().upkeep).toBeLessThan(normal);
    budget.focus = 'training';
    budget.applyPolicy();
    expect(units.policy.hosePowerMul).toBeCloseTo(BUDGET.FOCUS_POWER_MUL);
    budget.focus = 'maintenance';
    budget.applyPolicy();
    expect(units.policy.hosePowerMul).toBe(1);
    expect(units.policy.speedMul).toBeCloseTo(BUDGET.FOCUS_SPEED_MUL);
  });

  it('community focus speeds up detection', () => {
    const { budget, detection } = setup();
    budget.focus = 'community';
    budget.applyPolicy();
    expect(detection.delayMul).toBeCloseTo(BUDGET.FOCUS_DETECTION_MUL);
  });
});

describe('traffic & separation', () => {
  it('cars stop behind a blocking fire engine (jams propagate)', () => {
    const city = (() => {
      const grid = grassPlane();
      const roads = new RoadNetwork();
      for (let x = 0; x < GRID.W; x++) {
        roads.setRoad(x, 60);
        grid.setVoxel(x, 0, 60, Mat.ASPHALT);
      }
      roads.computeFields();
      return { grid, roads };
    })();
    const wind = new Wind(new Rng(1));
    const clusters = new FireClusterizer(city.grid, wind);
    const civ = new CivilianManager(city.grid, city.roads, clusters, new Rng(5));
    // craft a deterministic car heading +x toward a parked engine
    civ.cars.length = 0;
    civ.cars.push({ x: 50, z: 60, dirX: 1, dirZ: 0, speed: 4, heading: 0, state: 'drive', color: 0, cellX: 50, cellZ: 60, blockedFor: 0 });
    const blocker = { kind: 'engine', state: 'fighting', x: 53, z: 60 } as never;
    for (let t = 0; t < 3; t += 1 / 30) civ.update(1 / 30, [blocker]);
    const car = civ.cars[0];
    expect(car.speed).toBeLessThan(0.5);
    expect(car.x).toBeLessThan(52.5); // queued short of the engine
  });

  it('engines never occupy the same space', () => {
    const grid = grassPlane();
    const roads = new RoadNetwork();
    for (let x = 0; x < GRID.W; x++) roads.setRoad(x, 60);
    roads.computeFields();
    const { fire } = makeFire(grid);
    const water = new WaterSim(grid, fire);
    const clusters = new FireClusterizer(grid, new Wind(new Rng(1)));
    const units = new UnitManager(grid, roads, water, fire, clusters, new Rng(2), { x: 10, z: 60 }, { x: 0, z: 0 });
    const a = units.spawnEngine();
    const b = units.spawnEngine();
    a.x = b.x = 40;
    a.z = b.z = 60;
    for (let i = 0; i < 60; i++) units.update(1 / 30);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(1.5);
  });
});
