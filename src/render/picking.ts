import * as THREE from 'three';
import { ChunkManager } from './chunkManager';
import { UnitMeshes } from './unitMeshes';
import { UnitBase } from '../units/unit';

export interface PickResult {
  unit: UnitBase | null;
  /** Voxel/ground point hit (if no unit). */
  point: THREE.Vector3 | null;
}

/** Raycast helper: clicks resolve to a unit, else a point on the voxel world or ground plane. */
export class Picking {
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1);
  private ndc = new THREE.Vector2();

  constructor(
    private camera: THREE.PerspectiveCamera,
    private chunks: ChunkManager,
    private units: UnitMeshes,
  ) {}

  pick(clientX: number, clientY: number): PickResult {
    this.ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);

    const unitHits = this.raycaster.intersectObjects(this.units.groups, true);
    if (unitHits.length > 0) {
      const unit = this.units.unitFromObject(unitHits[0].object);
      if (unit) return { unit, point: null };
    }

    const hits = this.raycaster.intersectObjects(this.chunks.chunkMeshes, false);
    if (hits.length > 0) return { unit: null, point: hits[0].point };

    const point = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.groundPlane, point)) {
      return { unit: null, point };
    }
    return { unit: null, point: null };
  }
}
