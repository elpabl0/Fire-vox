import * as THREE from 'three';
import { GRID, RENDER } from '../config';
import { clamp } from '../core/math';

/**
 * Constrained top-down orbit camera: WASD/arrow pan, wheel zoom, right-drag or
 * Q/E rotate, with the polar angle clamped so the view stays strategic.
 */
export class CameraRig {
  target = new THREE.Vector3(GRID.W / 2, 0, GRID.D / 2);
  yaw = -Math.PI / 2;
  polar = 0.7; // radians from vertical
  distance = 90;

  private keys = new Set<string>();
  private rotating = false;
  private panning = false;
  private lastX = 0;
  private lastY = 0;

  constructor(
    private camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
  ) {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    domElement.addEventListener('contextmenu', (e) => e.preventDefault());
    domElement.addEventListener('pointerdown', (e) => {
      if (e.button === 2) this.rotating = true;
      if (e.button === 1) this.panning = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    window.addEventListener('pointerup', () => {
      this.rotating = false;
      this.panning = false;
    });
    window.addEventListener('pointermove', (e) => {
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      if (this.rotating) {
        this.yaw -= dx * 0.005;
        this.polar = clamp(this.polar + dy * 0.004, RENDER.CAM_MIN_POLAR, RENDER.CAM_MAX_POLAR);
      } else if (this.panning) {
        this.panBy(-dx * this.distance * 0.0016, -dy * this.distance * 0.0016);
      }
    });
    domElement.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.distance = clamp(this.distance * (1 + Math.sign(e.deltaY) * 0.1), RENDER.CAM_MIN_DIST, RENDER.CAM_MAX_DIST);
      },
      { passive: false },
    );
    this.apply();
  }

  private panBy(right: number, forward: number): void {
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // camera-relative pan on the ground plane
    this.target.x += cos * forward + -sin * right;
    this.target.z += sin * forward + cos * right;
    this.target.x = clamp(this.target.x, 0, GRID.W);
    this.target.z = clamp(this.target.z, 0, GRID.D);
  }

  update(dt: number): void {
    const panSpeed = this.distance * 0.55 * dt;
    let f = 0;
    let r = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) f -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) f += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) r -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) r += 1;
    if (f !== 0 || r !== 0) this.panBy(r * panSpeed, f * panSpeed);
    if (this.keys.has('KeyQ')) this.yaw += dt * 1.6;
    if (this.keys.has('KeyE')) this.yaw -= dt * 1.6;
    this.apply();
  }

  private apply(): void {
    const horiz = Math.sin(this.polar) * this.distance;
    const y = Math.cos(this.polar) * this.distance;
    this.camera.position.set(
      this.target.x + Math.cos(this.yaw) * horiz,
      this.target.y + y,
      this.target.z + Math.sin(this.yaw) * horiz,
    );
    this.camera.lookAt(this.target);
  }
}
