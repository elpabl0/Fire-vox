import * as THREE from 'three';
import { ChunkManager } from './chunkManager';
import { UnitMeshes } from './unitMeshes';
import { UnitBase } from '../units/unit';

export interface PickResult {
  unit: UnitBase | null;
  /** Point hit on the voxel world or ground plane (if no unit). */
  point: THREE.Vector3 | null;
  /** The solid voxel behind the hit face (chunk hits only). */
  voxel: { x: number; y: number; z: number } | null;
}

/** Raycast helper: clicks resolve to a unit, else a voxel/point on the world. */
export class Picking {
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1);
  private ndc = new THREE.Vector2();

  constructor(
    private camera: THREE.PerspectiveCamera,
    private chunks: ChunkManager,
    private units: UnitMeshes,
  ) {}

  pick(clientX: number, clientY: number, ignoreUnits = false): PickResult {
    this.ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);

    if (!ignoreUnits) {
      const unitHits = this.raycaster.intersectObjects(this.units.groups, true);
      if (unitHits.length > 0) {
        const unit = this.units.unitFromObject(unitHits[0].object);
        if (unit) return { unit, point: null, voxel: null };
      }
    }

    const hits = this.raycaster.intersectObjects(this.chunks.chunkMeshes, false);
    if (hits.length > 0) {
      const hit = hits[0];
      let voxel: PickResult['voxel'] = null;
      if (hit.face) {
        // step half a voxel against the face normal to land inside the solid voxel
        const inside = hit.point.clone().addScaledVector(hit.face.normal, -0.5);
        voxel = { x: Math.floor(inside.x), y: Math.floor(inside.y), z: Math.floor(inside.z) };
      }
      return { unit: null, point: hit.point, voxel };
    }

    const point = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.groundPlane, point)) {
      return { unit: null, point, voxel: null };
    }
    return { unit: null, point: null, voxel: null };
  }
}
