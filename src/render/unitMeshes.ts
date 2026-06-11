import * as THREE from 'three';
import { UnitBase } from '../units/unit';
import { UnitManager } from '../units/unitManager';

function box(w: number, h: number, d: number, color: number): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
}

function buildEngineMesh(): THREE.Group {
  const g = new THREE.Group();
  const chassis = box(2.6, 0.9, 1.2, 0xc0392b);
  chassis.position.y = 0.75;
  const cab = box(0.8, 0.7, 1.1, 0xe74c3c);
  cab.position.set(1.05, 1.45, 0);
  const tank = box(1.5, 0.6, 1.0, 0xd8d8d8);
  tank.position.set(-0.35, 1.45, 0);
  const ladder = box(1.8, 0.12, 0.3, 0x95a5a6);
  ladder.position.set(-0.3, 1.85, 0);
  const beacon = box(0.18, 0.14, 0.4, 0x4db8ff);
  beacon.position.set(1.05, 1.88, 0);
  for (const m of [chassis, cab, tank, ladder, beacon]) g.add(m);
  for (const wx of [-0.85, 0.85]) {
    for (const wz of [-0.55, 0.55]) {
      const wheel = box(0.5, 0.5, 0.18, 0x222222);
      wheel.position.set(wx, 0.25, wz);
      g.add(wheel);
    }
  }
  return g;
}

function buildHelicopterMesh(): { group: THREE.Group; rotor: THREE.Mesh } {
  const g = new THREE.Group();
  const body = box(2.0, 0.9, 1.0, 0xe67e22);
  body.position.y = 0.5;
  const nose = box(0.6, 0.6, 0.8, 0xf39c12);
  nose.position.set(1.2, 0.45, 0);
  const tail = box(1.6, 0.3, 0.3, 0xe67e22);
  tail.position.set(-1.6, 0.7, 0);
  const fin = box(0.3, 0.7, 0.12, 0xf39c12);
  fin.position.set(-2.3, 1.0, 0);
  const skidL = box(2.0, 0.1, 0.15, 0x555555);
  skidL.position.set(0, -0.1, 0.45);
  const skidR = skidL.clone();
  skidR.position.z = -0.45;
  const rotor = box(3.6, 0.06, 0.25, 0x333333);
  rotor.position.set(0, 1.1, 0);
  const bucket = box(0.5, 0.4, 0.5, 0xc0392b);
  bucket.position.set(0, -0.9, 0);
  for (const m of [body, nose, tail, fin, skidL, skidR, rotor, bucket]) g.add(m);
  return { group: g, rotor };
}

interface TrackedUnit {
  unit: UnitBase;
  group: THREE.Group;
  rotor: THREE.Mesh | null;
}

/** Syncs voxel-styled procedural unit models with sim unit positions; shows a selection ring. */
export class UnitMeshes {
  private tracked: TrackedUnit[] = [];
  private ring: THREE.Mesh;
  private time = 0;

  constructor(
    private manager: UnitManager,
    private scene: THREE.Scene,
  ) {
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(1.6, 2.0, 32),
      new THREE.MeshBasicMaterial({ color: 0xff8c3a, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    scene.add(this.ring);
  }

  update(dt: number): void {
    this.time += dt;
    // add meshes for new units
    for (const unit of this.manager.units) {
      if (!this.tracked.some((t) => t.unit === unit)) {
        if (unit.kind === 'engine') {
          const group = buildEngineMesh();
          this.scene.add(group);
          this.tracked.push({ unit, group, rotor: null });
        } else {
          const { group, rotor } = buildHelicopterMesh();
          this.scene.add(group);
          this.tracked.push({ unit, group, rotor });
        }
      }
    }
    for (const t of this.tracked) {
      t.group.position.set(t.unit.x, t.unit.y, t.unit.z);
      t.group.rotation.y = -t.unit.heading;
      if (t.rotor) t.rotor.rotation.y = this.time * 18;
    }
    const sel = this.manager.selected;
    if (sel) {
      this.ring.visible = true;
      this.ring.position.set(sel.x, sel.kind === 'helicopter' ? sel.y - 0.8 : 1.15, sel.z);
    } else {
      this.ring.visible = false;
    }
  }

  /** Map a raycast hit object back to its unit. */
  unitFromObject(obj: THREE.Object3D): UnitBase | null {
    for (const t of this.tracked) {
      let o: THREE.Object3D | null = obj;
      while (o) {
        if (o === t.group) return t.unit;
        o = o.parent;
      }
    }
    return null;
  }

  get groups(): THREE.Group[] {
    return this.tracked.map((t) => t.group);
  }
}
