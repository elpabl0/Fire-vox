import * as THREE from 'three';
import { CivilianManager } from '../sim/civilians';

/** Instanced rendering for civilian cars and pedestrians (2 draw calls total). */
export class CivilianMeshes {
  private carMesh: THREE.InstancedMesh;
  private pedMesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();

  constructor(
    private civilians: CivilianManager,
    scene: THREE.Scene,
  ) {
    const carGeo = new THREE.BoxGeometry(1.7, 0.6, 0.85);
    carGeo.translate(0, 0.45, 0);
    this.carMesh = new THREE.InstancedMesh(carGeo, new THREE.MeshLambertMaterial(), Math.max(1, civilians.cars.length));
    const pedGeo = new THREE.BoxGeometry(0.36, 0.85, 0.36);
    pedGeo.translate(0, 0.55, 0);
    this.pedMesh = new THREE.InstancedMesh(pedGeo, new THREE.MeshLambertMaterial(), Math.max(1, civilians.peds.length));
    for (let i = 0; i < civilians.cars.length; i++) {
      this.carMesh.setColorAt(i, new THREE.Color(civilians.cars[i].color));
    }
    for (let i = 0; i < civilians.peds.length; i++) {
      this.pedMesh.setColorAt(i, new THREE.Color(civilians.peds[i].color));
    }
    this.carMesh.castShadow = true;
    this.pedMesh.castShadow = true;
    scene.add(this.carMesh);
    scene.add(this.pedMesh);
  }

  update(): void {
    const { cars, peds } = this.civilians;
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      // pulled-over cars hug the kerb
      const kerb = car.state === 'pullover' ? 0.9 : 0.45;
      this.dummy.position.set(car.x - Math.sin(car.heading) * kerb, 1, car.z + Math.cos(car.heading) * kerb);
      this.dummy.rotation.set(0, -car.heading, 0);
      this.dummy.updateMatrix();
      this.carMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.carMesh.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < peds.length; i++) {
      const ped = peds[i];
      this.dummy.position.set(ped.x, 1, ped.z);
      this.dummy.rotation.set(0, -ped.heading, 0);
      this.dummy.updateMatrix();
      this.pedMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.pedMesh.instanceMatrix.needsUpdate = true;
  }
}
