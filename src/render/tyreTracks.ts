import * as THREE from 'three';

const CAPACITY = 512;
const LIFETIME = 9; // seconds before a mark fades out

/**
 * Pool of dark rubber marks dropped under drifting engines. Instanced quads
 * that shrink away as they age (cheaper than per-instance opacity).
 */
export class TyreTracks {
  private mesh: THREE.InstancedMesh;
  private ages = new Float32Array(CAPACITY).fill(Infinity);
  private states: Array<{ x: number; z: number; angle: number }> = new Array(CAPACITY);
  private head = 0;
  private dummy = new THREE.Object3D();

  constructor(scene: THREE.Scene) {
    const geo = new THREE.PlaneGeometry(0.65, 0.22);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x16171a,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, CAPACITY);
    this.mesh.frustumCulled = false;
    // park all instances at zero scale
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    for (let i = 0; i < CAPACITY; i++) this.mesh.setMatrixAt(i, this.dummy.matrix);
    this.dummy.scale.setScalar(1);
    scene.add(this.mesh);
  }

  /** Drop a pair of marks under the rear axle of a drifting vehicle. */
  addPair(x: number, z: number, heading: number, travelAngle: number): void {
    const backX = x - Math.cos(heading) * 0.8;
    const backZ = z - Math.sin(heading) * 0.8;
    const sideX = -Math.sin(heading) * 0.42;
    const sideZ = Math.cos(heading) * 0.42;
    this.add(backX + sideX, backZ + sideZ, travelAngle);
    this.add(backX - sideX, backZ - sideZ, travelAngle);
  }

  private add(x: number, z: number, angle: number): void {
    const i = this.head;
    this.head = (this.head + 1) % CAPACITY;
    this.ages[i] = 0;
    this.states[i] = { x, z, angle };
  }

  update(dt: number): void {
    let dirty = false;
    for (let i = 0; i < CAPACITY; i++) {
      if (this.ages[i] > LIFETIME) continue;
      this.ages[i] += dt;
      const s = this.states[i];
      const fade = Math.max(0, 1 - this.ages[i] / LIFETIME);
      this.dummy.position.set(s.x, 1.03, s.z);
      this.dummy.rotation.set(0, -s.angle, 0);
      this.dummy.scale.set(fade > 0 ? 1 : 0, 1, 0.4 + fade * 0.6);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      dirty = true;
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
