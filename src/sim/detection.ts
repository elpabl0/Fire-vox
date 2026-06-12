import { DETECTION } from '../config';
import { EventBus } from '../core/events';
import { CivilianManager } from './civilians';
import { FireClusterizer } from './fireClusters';

/**
 * Fires burn unnoticed until somebody calls them in. Alert arrows and toasts
 * only fire for *reported* clusters, so scanning the map (or buying heat
 * vision / the alarm network) is rewarded. Bigger fires and fires with nearby
 * witnesses get reported sooner; dispatching a unit marks a fire as known.
 */
export class DetectionSystem {
  /** Multiplier on the report delay (alarm-network upgrade + community policy). */
  delayMul = 1;
  private state = new Map<number, { age: number; reported: boolean }>();

  constructor(
    private clusters: FireClusterizer,
    private civilians: CivilianManager | null,
    private events: EventBus,
  ) {}

  update(dt: number): void {
    const live = new Set<number>();
    for (const cluster of this.clusters.clusters) {
      live.add(cluster.id);
      let s = this.state.get(cluster.id);
      if (!s) {
        s = { age: 0, reported: false };
        this.state.set(cluster.id, s);
      }
      if (s.reported) continue;
      s.age += dt;
      let delay = Math.max(DETECTION.MIN_DELAY_S, DETECTION.BASE_DELAY_S - cluster.size * DETECTION.PER_VOXEL_S) * this.delayMul;
      if (this.hasWitness(cluster.cx, cluster.cz)) delay *= DETECTION.WITNESS_MUL;
      if (s.age >= delay) {
        s.reported = true;
        this.events.emit('fireReported', { x: cluster.cx, z: cluster.cz });
      }
    }
    for (const id of this.state.keys()) {
      if (!live.has(id)) this.state.delete(id);
    }
  }

  isReported(clusterId: number): boolean {
    return this.state.get(clusterId)?.reported ?? false;
  }

  /** The player (or a unit on scene) already knows about this fire. */
  markKnown(clusterId: number): void {
    const s = this.state.get(clusterId);
    if (s) s.reported = true;
    else this.state.set(clusterId, { age: 0, reported: true });
  }

  private hasWitness(cx: number, cz: number): boolean {
    if (!this.civilians) return false;
    const r = DETECTION.WITNESS_RADIUS;
    for (const ped of this.civilians.peds) {
      if (Math.abs(ped.x - cx) < r && Math.abs(ped.z - cz) < r) return true;
    }
    for (const car of this.civilians.cars) {
      if (Math.abs(car.x - cx) < r && Math.abs(car.z - cz) < r) return true;
    }
    return false;
  }
}
