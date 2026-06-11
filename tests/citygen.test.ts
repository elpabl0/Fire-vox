import { describe, expect, it } from 'vitest';
import { generateCity } from '../src/world/citygen';
import { GRID } from '../src/config';
import { Mat } from '../src/world/materials';

describe('citygen', () => {
  it('is deterministic: same seed gives an identical grid', () => {
    const a = generateCity(1234);
    const b = generateCity(1234);
    expect(a.grid.stateHash()).toBe(b.grid.stateHash());
    expect(a.buildings.length).toBe(b.buildings.length);
  });

  it('different seeds give different cities', () => {
    expect(generateCity(1).grid.stateHash()).not.toBe(generateCity(2).grid.stateHash());
  });

  it('generates a connected road network', () => {
    const city = generateCity(555);
    expect(city.roads.isConnected()).toBe(true);
  });

  it('contains buildings, a pond and a fire station', () => {
    const city = generateCity(777);
    expect(city.buildings.length).toBeGreaterThan(10);
    expect(city.buildings.some((b) => b.kind === 'station')).toBe(true);
    let waterCells = 0;
    for (let x = 0; x < GRID.W; x++) {
      for (let z = 0; z < GRID.D; z++) {
        if (city.grid.material[city.grid.idx(x, 0, z)] === Mat.WATER) waterCells++;
      }
    }
    expect(waterCells).toBeGreaterThan(10);
  });

  it('every building is reachable from a road within hose distance', () => {
    const city = generateCity(31337);
    for (const b of city.buildings) {
      if (b.id === 0) continue;
      const cx = Math.round((b.x0 + b.x1) / 2);
      const cz = Math.round((b.z0 + b.z1) / 2);
      const dist = city.roads.distToRoad[cx * GRID.D + cz];
      expect(dist).toBeLessThan(20);
    }
  });

  it('station door is on a road', () => {
    const city = generateCity(42);
    const { x, z } = city.stationDoor;
    expect(city.roads.isRoad[x * GRID.D + z]).toBe(1);
  });
});
