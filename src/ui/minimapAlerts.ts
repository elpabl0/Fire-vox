import * as THREE from 'three';
import { FireClusterizer } from '../sim/fireClusters';

/** Edge-of-screen arrows pointing at off-screen fire clusters. */
export class FireAlerts {
  private root = document.getElementById('ui')!;
  private arrows: HTMLElement[] = [];
  private vec = new THREE.Vector3();

  constructor(
    private clusters: FireClusterizer,
    private camera: THREE.PerspectiveCamera,
  ) {}

  update(): void {
    let used = 0;
    for (const cluster of this.clusters.clusters) {
      this.vec.set(cluster.cx, 4, cluster.cz);
      this.vec.project(this.camera);
      const onScreen = this.vec.x > -1 && this.vec.x < 1 && this.vec.y > -1 && this.vec.y < 1 && this.vec.z < 1;
      if (onScreen) continue;
      // behind the camera: flip
      if (this.vec.z > 1) {
        this.vec.x = -this.vec.x;
        this.vec.y = -this.vec.y;
      }
      const arrow = this.getArrow(used++);
      // clamp to screen edge with margin
      const margin = 36;
      const halfW = window.innerWidth / 2;
      const halfH = window.innerHeight / 2;
      let sx = this.vec.x * halfW;
      let sy = -this.vec.y * halfH;
      const scale = Math.max(Math.abs(sx) / (halfW - margin), Math.abs(sy) / (halfH - margin));
      if (scale > 1) {
        sx /= scale;
        sy /= scale;
      }
      const angle = Math.atan2(sy, sx) + Math.PI / 2;
      arrow.style.left = `${halfW + sx - 9}px`;
      arrow.style.top = `${halfH + sy - 8}px`;
      arrow.style.transform = `rotate(${(angle * 180) / Math.PI}deg)`;
      arrow.style.display = 'block';
    }
    for (let i = used; i < this.arrows.length; i++) this.arrows[i].style.display = 'none';
  }

  private getArrow(i: number): HTMLElement {
    while (this.arrows.length <= i) {
      const el = document.createElement('div');
      el.className = 'alert-arrow';
      this.root.appendChild(el);
      this.arrows.push(el);
    }
    return this.arrows[i];
  }
}
