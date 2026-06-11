import { describe, expect, it } from 'vitest';
import { findRoadPath } from '../src/units/pathfinding';
import { RoadNetwork } from '../src/world/roadGraph';
import { generateCity } from '../src/world/citygen';

describe('pathfinding', () => {
  it('finds a straight path on a straight road', () => {
    const roads = new RoadNetwork();
    for (let x = 10; x <= 50; x++) roads.setRoad(x, 20);
    roads.computeFields();
    const path = findRoadPath(roads, 10, 20, 50, 20);
    expect(path).not.toBeNull();
    expect(path![path!.length - 1]).toEqual({ x: 50, z: 20 });
    // collinear collapse: a straight line is just endpoints
    expect(path!.length).toBeLessThanOrEqual(3);
  });

  it('routes around an L corner', () => {
    const roads = new RoadNetwork();
    for (let x = 0; x <= 20; x++) roads.setRoad(x, 5);
    for (let z = 5; z <= 25; z++) roads.setRoad(20, z);
    roads.computeFields();
    const path = findRoadPath(roads, 0, 5, 20, 25);
    expect(path).not.toBeNull();
    expect(path![path!.length - 1]).toEqual({ x: 20, z: 25 });
    // path length (manhattan) should be exactly 20 + 20 cells
    let total = 0;
    for (let i = 1; i < path!.length; i++) {
      total += Math.abs(path![i].x - path![i - 1].x) + Math.abs(path![i].z - path![i - 1].z);
    }
    expect(total).toBe(40);
  });

  it('returns null for unreachable goals', () => {
    const roads = new RoadNetwork();
    for (let x = 0; x <= 5; x++) roads.setRoad(x, 5);
    for (let x = 20; x <= 25; x++) roads.setRoad(x, 5);
    roads.computeFields();
    expect(findRoadPath(roads, 0, 5, 25, 5)).toBeNull();
  });

  it('any two road cells in a generated city are connected', () => {
    const city = generateCity(9001);
    const cells: Array<{ x: number; z: number }> = [];
    for (let x = 0; x < 128 && cells.length < 2; x += 17) {
      for (let z = 0; z < 128 && cells.length < 2; z += 13) {
        const near = city.roads.nearestRoadCell(x, z);
        if (near && !cells.some((c) => c.x === near.x && c.z === near.z)) cells.push(near);
      }
    }
    expect(cells.length).toBe(2);
    const path = findRoadPath(city.roads, cells[0].x, cells[0].z, cells[1].x, cells[1].z);
    expect(path).not.toBeNull();
  });
});
