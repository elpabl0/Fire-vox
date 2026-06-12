import * as THREE from 'three';
import { PARTICLES } from '../../config';
import { Rng } from '../../core/rng';
import { Weather } from '../../sim/weather';
import { Wind } from '../../sim/wind';
import { GpuParticleSystem } from './particleSystem';

/** Rain streaks and drifting snowflakes, spawned in a volume around the camera target. */
export class WeatherFx {
  private rain: GpuParticleSystem;
  private snow: GpuParticleSystem;

  constructor(
    private weather: Weather,
    private wind: Wind,
    private rng: Rng,
    scene: THREE.Scene,
  ) {
    this.rain = new GpuParticleSystem({
      capacity: PARTICLES.RAIN_MAX,
      blending: THREE.NormalBlending,
      colorA: new THREE.Color(0xa8c8e8),
      colorB: new THREE.Color(0x88a8d0),
      sizeStart: 0.5,
      sizeEnd: 0.5,
      opacity: 0.4,
      buoyancy: 0,
      windFactor: 0.4,
      wobble: 0,
    });
    this.snow = new GpuParticleSystem({
      capacity: PARTICLES.SNOW_MAX,
      blending: THREE.NormalBlending,
      colorA: new THREE.Color(0xffffff),
      colorB: new THREE.Color(0xe8eef4),
      sizeStart: 0.55,
      sizeEnd: 0.5,
      opacity: 0.85,
      buoyancy: 0,
      windFactor: 0.8,
      wobble: 1.4,
    });
    scene.add(this.rain.points);
    scene.add(this.snow.points);
  }

  update(time: number, dt: number, focusX: number, focusZ: number): void {
    const raining = this.weather.kind === 'rain' || this.weather.kind === 'storm';
    if (raining && this.weather.intensity > 0.02) {
      const rate = (this.weather.kind === 'storm' ? 2200 : 1400) * this.weather.intensity;
      const n = Math.min(80, Math.round(rate * dt));
      for (let i = 0; i < n; i++) {
        const x = focusX + this.rng.range(-70, 70);
        const z = focusZ + this.rng.range(-70, 70);
        this.rain.spawn(time, x, 48, z, this.wind.dirX * this.wind.strength * 6, -34, this.wind.dirZ * this.wind.strength * 6, 1.45, 1, this.rng.next());
      }
    }
    if (this.weather.kind === 'snow' && this.weather.intensity > 0.02) {
      const n = Math.min(30, Math.round(260 * this.weather.intensity * dt));
      for (let i = 0; i < n; i++) {
        const x = focusX + this.rng.range(-70, 70);
        const z = focusZ + this.rng.range(-70, 70);
        this.snow.spawn(time, x, 44, z, this.wind.dirX * this.wind.strength * 3, this.rng.range(-4.5, -3), this.wind.dirZ * this.wind.strength * 3, 11, this.rng.range(0.7, 1.3), this.rng.next());
      }
    }
    this.rain.update(time, this.wind.dirX * this.wind.strength * 2, this.wind.dirZ * this.wind.strength * 2);
    this.snow.update(time, this.wind.dirX * this.wind.strength * 2, this.wind.dirZ * this.wind.strength * 2);
  }
}
