import * as THREE from 'three';
import { GRID, RENDER } from '../config';
import { clamp } from '../core/math';

/**
 * Constrained top-down orbit camera.
 * Desktop: WASD/arrow pan, left- or middle-drag pan, right-drag or Q/E rotate, wheel zoom.
 * Touch: one-finger drag pans, two-finger pinch zooms, twist rotates, two-finger vertical drag tilts.
 */
export class CameraRig {
  target = new THREE.Vector3(GRID.W / 2, 0, GRID.D / 2);
  yaw = -Math.PI / 2;
  polar = 0.7; // radians from vertical
  distance = 90;
  /** Game sets this false while a paint tool owns the primary pointer (brushes). */
  allowDragPan: () => boolean = () => true;

  private keys = new Set<string>();
  private rotating = false;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private pinchAngle = 0;
  private pinchMidY = 0;

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

    domElement.style.touchAction = 'none';
    domElement.addEventListener('contextmenu', (e) => e.preventDefault());
    domElement.addEventListener('pointerdown', (e) => {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (e.button === 2) this.rotating = true;
      if (this.pointers.size === 2) this.initPinch();
    });
    const release = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (e.button === 2) this.rotating = false;
      if (this.pointers.size === 2) this.initPinch();
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.pointers.size === 2) {
        this.handlePinch();
        return;
      }
      if (this.rotating) {
        this.yaw -= dx * 0.005;
        this.polar = clamp(this.polar + dy * 0.004, RENDER.CAM_MIN_POLAR, RENDER.CAM_MAX_POLAR);
      } else if ((e.buttons & 5) !== 0 && this.allowDragPan()) {
        // primary button or pen/touch contact, or middle button: grab-pan
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

  private initPinch(): void {
    const [a, b] = [...this.pointers.values()];
    this.pinchDist = Math.hypot(b.x - a.x, b.y - a.y);
    this.pinchAngle = Math.atan2(b.y - a.y, b.x - a.x);
    this.pinchMidY = (a.y + b.y) / 2;
  }

  private handlePinch(): void {
    const [a, b] = [...this.pointers.values()];
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const midY = (a.y + b.y) / 2;
    if (this.pinchDist > 0) {
      this.distance = clamp(this.distance * (this.pinchDist / dist), RENDER.CAM_MIN_DIST, RENDER.CAM_MAX_DIST);
    }
    let dAngle = angle - this.pinchAngle;
    if (dAngle > Math.PI) dAngle -= Math.PI * 2;
    if (dAngle < -Math.PI) dAngle += Math.PI * 2;
    this.yaw += dAngle;
    this.polar = clamp(this.polar + (midY - this.pinchMidY) * 0.005, RENDER.CAM_MIN_POLAR, RENDER.CAM_MAX_POLAR);
    this.pinchDist = dist;
    this.pinchAngle = angle;
    this.pinchMidY = midY;
  }

  private panBy(right: number, forward: number): void {
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // camera-relative pan on the ground plane: screen-up = -(cos,sin), screen-right = (sin,-cos)
    this.target.x += cos * forward + sin * right;
    this.target.z += sin * forward + -cos * right;
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
