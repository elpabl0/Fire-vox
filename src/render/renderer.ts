import * as THREE from 'three';
import { GRID } from '../config';

/** Scene/camera/renderer setup. No shadow maps — depth is baked into voxel face shading. */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x88a7c4);
    this.scene.fog = new THREE.Fog(0x88a7c4, 180, 420);

    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 600);

    const hemi = new THREE.HemisphereLight(0xcfe5ff, 0x4a4438, 0.9);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.4);
    sun.position.set(GRID.W * 0.3, 80, GRID.D * 0.15);
    this.scene.add(sun);

    window.addEventListener('resize', () => this.onResize());
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  get drawCalls(): number {
    return this.renderer.info.render.calls;
  }
}
