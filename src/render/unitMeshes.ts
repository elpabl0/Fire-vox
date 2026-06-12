import * as THREE from 'three';
import { Helicopter } from '../units/helicopter';
import { Firefighter } from '../units/firefighter';
import { UnitBase } from '../units/unit';
import { UnitManager } from '../units/unitManager';

function box(w: number, h: number, d: number, color: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  m.castShadow = true;
  return m;
}

function buildEngineMesh(accent: number): { group: THREE.Group; turret: THREE.Group } {
  const g = new THREE.Group();
  const chassis = box(2.6, 0.9, 1.2, 0xc0392b);
  chassis.position.y = 0.75;
  const cab = box(0.8, 0.7, 1.1, 0xe74c3c);
  cab.position.set(1.05, 1.45, 0);
  const tank = box(1.5, 0.6, 1.0, 0xd8d8d8);
  tank.position.set(-0.35, 1.45, 0);
  const ladder = box(1.8, 0.12, 0.3, 0x95a5a6);
  ladder.position.set(-0.3, 1.85, 0);
  const beacon = box(0.18, 0.14, 0.4, accent);
  beacon.position.set(1.05, 1.88, 0);
  for (const m of [chassis, cab, tank, ladder, beacon]) g.add(m);
  for (const wx of [-0.85, 0.85]) {
    for (const wz of [-0.55, 0.55]) {
      const wheel = box(0.5, 0.5, 0.18, 0x222222);
      wheel.position.set(wx, 0.25, wz);
      g.add(wheel);
    }
  }
  // roof monitor (deck gun) — swivels independently of the chassis
  const turret = new THREE.Group();
  const mount = box(0.3, 0.22, 0.3, 0x6a7480);
  const barrel = box(0.7, 0.12, 0.12, 0x95a5a6);
  barrel.position.set(0.4, 0.16, 0);
  turret.add(mount, barrel);
  turret.position.set(0.25, 1.96, 0);
  g.add(turret);
  return { group: g, turret };
}

function buildHelicopterMesh(accent: number): { group: THREE.Group; rotor: THREE.Mesh } {
  const g = new THREE.Group();
  const body = box(2.0, 0.9, 1.0, 0xe67e22);
  body.position.y = 0.5;
  const nose = box(0.6, 0.6, 0.8, accent);
  nose.position.set(1.2, 0.45, 0);
  const tail = box(1.6, 0.3, 0.3, 0xe67e22);
  tail.position.set(-1.6, 0.7, 0);
  const fin = box(0.3, 0.7, 0.12, accent);
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

function buildFirefighterMesh(): THREE.Group {
  const g = new THREE.Group();
  const body = box(0.34, 0.62, 0.4, 0x2b4a6b); // turnout gear blue
  body.position.y = 0.45;
  const stripe = box(0.36, 0.1, 0.42, 0xf0e040); // hi-vis band
  stripe.position.y = 0.55;
  const head = box(0.26, 0.22, 0.26, 0xd8a87a);
  head.position.y = 0.92;
  const helmet = box(0.32, 0.12, 0.34, 0xf0c030);
  helmet.position.y = 1.06;
  for (const m of [body, stripe, head, helmet]) g.add(m);
  return g;
}

function buildHydrantMesh(): THREE.Group {
  const g = new THREE.Group();
  const post = box(0.34, 0.7, 0.34, 0xd03030);
  post.position.y = 1.3;
  const cap = box(0.24, 0.16, 0.24, 0xf0c030);
  cap.position.y = 1.74;
  const armL = box(0.16, 0.16, 0.55, 0xd03030);
  armL.position.y = 1.42;
  for (const m of [post, cap, armL]) g.add(m);
  return g;
}

interface TrackedUnit {
  unit: UnitBase;
  group: THREE.Group;
  rotor: THREE.Mesh | null;
  turret: THREE.Group | null;
}

/** Syncs voxel-styled procedural unit models with sim unit positions; shows a selection ring. */
export class UnitMeshes {
  private tracked: TrackedUnit[] = [];
  private hydrantCount = 0;
  private ring: THREE.Mesh;
  private time = 0;
  private rotorAngle = 0;

  constructor(
    private manager: UnitManager,
    private scene: THREE.Scene,
  ) {
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(1.6, 2.0, 32),
      new THREE.MeshBasicMaterial({ color: 0xff8c3a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    scene.add(this.ring);
  }

  update(dt: number): void {
    this.time += dt;
    for (const unit of this.manager.allUnits) {
      if (!this.tracked.some((t) => t.unit === unit)) {
        if (unit.kind === 'engine') {
          const { group, turret } = buildEngineMesh(unit.accentColor);
          this.scene.add(group);
          this.tracked.push({ unit, group, rotor: null, turret });
        } else if (unit.kind === 'helicopter') {
          const { group, rotor } = buildHelicopterMesh(unit.accentColor);
          this.scene.add(group);
          this.tracked.push({ unit, group, rotor, turret: null });
        } else {
          const group = buildFirefighterMesh();
          this.scene.add(group);
          this.tracked.push({ unit, group, rotor: null, turret: null });
        }
      }
    }
    for (const t of this.tracked) {
      if (t.unit instanceof Firefighter) {
        t.group.visible = t.unit.deployed;
        if (!t.unit.deployed) continue;
      }
      t.group.position.set(t.unit.x, t.unit.y, t.unit.z);
      t.group.rotation.y = -t.unit.heading;
      // monitor turret tracks its target in world space, independent of the chassis
      if (t.turret) t.turret.rotation.y = t.unit.heading - t.unit.turretAngle;
      if (t.rotor) {
        const speed = t.unit instanceof Helicopter ? t.unit.rotorSpeed : 1;
        this.rotorAngle += dt * 18 * speed;
        t.rotor.rotation.y = this.rotorAngle;
      }
    }
    // hydrant models
    while (this.hydrantCount < this.manager.hydrants.length) {
      const h = this.manager.hydrants[this.hydrantCount++];
      const mesh = buildHydrantMesh();
      mesh.position.set(h.x, 0, h.z);
      this.scene.add(mesh);
    }
    const sel = this.manager.selected;
    if (sel) {
      this.ring.visible = true;
      this.ring.position.set(sel.x, sel.kind === 'helicopter' ? sel.y - 0.8 : 1.15, sel.z);
    } else {
      this.ring.visible = false;
    }
  }

  /** Map a raycast hit object back to its unit (crew excluded — select the engine instead). */
  unitFromObject(obj: THREE.Object3D): UnitBase | null {
    for (const t of this.tracked) {
      if (t.unit.kind === 'firefighter') continue;
      let o: THREE.Object3D | null = obj;
      while (o) {
        if (o === t.group) return t.unit;
        o = o.parent;
      }
    }
    return null;
  }

  get groups(): THREE.Group[] {
    return this.tracked.filter((t) => t.unit.kind !== 'firefighter').map((t) => t.group);
  }
}
