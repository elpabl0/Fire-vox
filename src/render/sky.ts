import * as THREE from 'three';
import { GRID, WEATHER } from '../config';
import { lerp } from '../core/math';
import { Weather } from '../sim/weather';
import { snowUniform } from './chunkManager';
import { Renderer } from './renderer';

const { W, D } = GRID;

const SKY_DAY = new THREE.Color(0x88a7c4);
const SKY_NIGHT = new THREE.Color(0x0b1120);
const SKY_OVERCAST = new THREE.Color(0x5e6873);
const SKY_SNOW = new THREE.Color(0x9aa4ad);

/**
 * Day-night cycle + weather lighting: an orbiting shadow-casting sun, dim blue
 * moonlight at night, hemisphere ambience, sky/fog colour, ground wet sheen
 * (specular on the chunk material) and snow cover uniform.
 */
export class Sky {
  /** 0..1 time of day; 0.25 = sunrise, 0.5 = noon. Starts mid-morning. */
  timeOfDay = 0.35;
  private sun: THREE.DirectionalLight;
  private moon: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private skyColor = new THREE.Color();
  private shadowRefreshIn = 0;

  constructor(
    private renderer: Renderer,
    private chunkMaterial: THREE.MeshPhongMaterial,
  ) {
    const scene = renderer.scene;
    this.hemi = new THREE.HemisphereLight(0xcfe5ff, 0x4a4438, 0.8);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff2dd, 1.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const cam = this.sun.shadow.camera;
    cam.left = -W * 0.75;
    cam.right = W * 0.75;
    cam.top = D * 0.75;
    cam.bottom = -D * 0.75;
    cam.near = 10;
    cam.far = 700;
    this.sun.shadow.bias = -0.002;
    this.sun.target.position.set(W / 2, 0, D / 2);
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.moon = new THREE.DirectionalLight(0x6f86c0, 0.0);
    this.moon.position.set(W / 2 - 100, 120, D / 2 + 60);
    this.moon.target.position.set(W / 2, 0, D / 2);
    scene.add(this.moon);
    scene.add(this.moon.target);
  }

  update(dt: number, weather: Weather): void {
    this.timeOfDay = (this.timeOfDay + dt / WEATHER.DAY_LENGTH_S) % 1;
    const sunAngle = (this.timeOfDay - 0.25) * Math.PI * 2; // 0.25 = sunrise at horizon
    const elevation = Math.sin(sunAngle);
    const day = THREE.MathUtils.smoothstep(elevation, -0.08, 0.25);
    const overcast = weather.kind === 'storm' ? weather.intensity : weather.kind === 'rain' ? weather.intensity * 0.75 : weather.kind === 'snow' ? weather.intensity * 0.5 : 0;

    // sun orbit (east-west across the map)
    const r = 320;
    this.sun.position.set(W / 2 + Math.cos(sunAngle) * r, Math.max(8, elevation * r), D / 2 + Math.sin(sunAngle) * r * 0.35);
    this.sun.intensity = 1.5 * day * (1 - overcast * 0.75);
    // warm at low sun
    const warmth = 1 - Math.min(1, Math.max(0, elevation) * 2.2);
    this.sun.color.setRGB(1, lerp(1, 0.72, warmth * 0.7), lerp(0.92, 0.5, warmth * 0.8));

    this.moon.intensity = 0.28 * (1 - day) * (1 - overcast * 0.6);
    this.hemi.intensity = lerp(0.16, 0.8, day) * (1 - overcast * 0.35);

    // sky + fog
    this.skyColor.copy(SKY_NIGHT).lerp(SKY_DAY, day);
    if (overcast > 0) this.skyColor.lerp(weather.kind === 'snow' ? SKY_SNOW : SKY_OVERCAST, overcast * day);
    (this.renderer.scene.background as THREE.Color).copy(this.skyColor);
    const fog = this.renderer.scene.fog as THREE.Fog;
    fog.color.copy(this.skyColor);
    const visibility = 1 - Math.max(overcast * 0.5, weather.kind === 'snow' ? weather.intensity * 0.45 : 0);
    fog.near = 200 * visibility + 40;
    fog.far = 700 * visibility + 100;

    // wet sheen + snow cover on the voxel material
    const wet = weather.wetness;
    this.chunkMaterial.specular.setScalar(lerp(0.04, 0.45, wet));
    this.chunkMaterial.shininess = lerp(18, 80, wet);
    snowUniform.value = weather.snowCover;

    // budgeted shadow refresh (sun moves slowly; chunk edits are minor between refreshes)
    this.shadowRefreshIn -= dt;
    if (this.shadowRefreshIn <= 0 && this.sun.intensity > 0.05) {
      this.shadowRefreshIn = 0.35;
      this.renderer.renderer.shadowMap.needsUpdate = true;
    }
  }

  get isNight(): boolean {
    const elevation = Math.sin((this.timeOfDay - 0.25) * Math.PI * 2);
    return elevation < 0;
  }
}
