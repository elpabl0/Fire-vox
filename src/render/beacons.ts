import * as THREE from 'three';
import { GRID } from '../config';
import { UnitBase } from '../units/unit';
import { VoxelGrid } from '../world/voxelGrid';

interface Beacon {
  group: THREE.Group;
  ring: THREE.Mesh;
  beam: THREE.Mesh;
}

/**
 * Destination beacons: while a unit is responding to a player order, a pulsing
 * ring + light beam in the unit's accent colour marks the clicked destination.
 */
export class Beacons {
  private byUnit = new Map<number, Beacon>();

  constructor(
    private scene: THREE.Scene,
    private grid: VoxelGrid,
  ) {}

  update(units: UnitBase[], time: number): void {
    const active = new Set<number>();
    for (const unit of units) {
      if (!unit.orderedTarget) continue;
      active.add(unit.id);
      let beacon = this.byUnit.get(unit.id);
      if (!beacon) {
        beacon = this.create(unit.accentColor);
        this.byUnit.set(unit.id, beacon);
      }
      beacon.group.visible = true;
      // sit on top of whatever occupies the destination so it never hides inside a building
      const tx = Math.max(0, Math.min(GRID.W - 1, Math.round(unit.orderedTarget.x)));
      const tz = Math.max(0, Math.min(GRID.D - 1, Math.round(unit.orderedTarget.z)));
      const top = this.grid.topY(tx, tz);
      beacon.group.position.set(unit.orderedTarget.x, Math.max(1.05, top + 1.1), unit.orderedTarget.z);
      const pulse = 1 + Math.sin(time * 5) * 0.18;
      beacon.ring.scale.setScalar(pulse);
      (beacon.beam.material as THREE.MeshBasicMaterial).opacity = 0.35 + Math.sin(time * 5) * 0.12;
    }
    for (const [id, beacon] of this.byUnit) {
      if (!active.has(id)) beacon.group.visible = false;
    }
  }

  private create(color: number): Beacon {
    const group = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.1, 1.6, 28),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.65, 26, 10, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    beam.position.y = 13;
    group.add(ring, beam);
    this.scene.add(group);
    return { group, ring, beam };
  }
}
