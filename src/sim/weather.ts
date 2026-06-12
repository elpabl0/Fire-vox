import { WEATHER } from '../config';
import { Rng } from '../core/rng';
import { FireSim } from './fireSim';
import { Wind } from './wind';

export type WeatherKind = 'clear' | 'rain' | 'storm' | 'snow';

/**
 * Random weather: clear / rain / storm / snow with smooth intensity ramps.
 * Rain douses exposed fire and suppresses spread; storms force strong wind
 * (dangerous ember conditions); snow mildly suppresses spread and settles
 * visually. Also tracks ground wetness for the rendering sheen.
 */
export class Weather {
  kind: WeatherKind = 'clear';
  /** 0..1 ramped intensity of the current state. */
  intensity = 0;
  /** Ground wetness 0..1 (rises in rain, slowly dries). */
  wetness = 0;
  /** Settled snow 0..1. */
  snowCover = 0;
  private timer: number;

  constructor(private rng: Rng) {
    this.timer = rng.range(WEATHER.MIN_DURATION_S, WEATHER.MAX_DURATION_S);
  }

  update(dt: number, fire: FireSim, wind: Wind): void {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.kind = this.rollNext();
      this.timer = this.rng.range(WEATHER.MIN_DURATION_S, WEATHER.MAX_DURATION_S);
    }
    const target = this.kind === 'clear' ? 0 : 1;
    const ramp = dt / WEATHER.RAMP_S;
    this.intensity = target > this.intensity ? Math.min(target, this.intensity + ramp) : Math.max(target, this.intensity - ramp);

    const raining = this.kind === 'rain' || this.kind === 'storm';
    const rain = raining ? this.intensity : 0;
    const snow = this.kind === 'snow' ? this.intensity : 0;

    // fire effects
    fire.rainDouse = WEATHER.RAIN_DOUSE * rain * (this.kind === 'storm' ? 1.2 : 1);
    const rainMul = 1 - (1 - WEATHER.RAIN_SPREAD_MUL) * rain;
    const snowMul = 1 - (1 - WEATHER.SNOW_SPREAD_MUL) * snow;
    fire.environmentSpreadMul = rainMul * snowMul;

    // storm wind
    wind.strengthFloor = this.kind === 'storm' ? WEATHER.STORM_WIND_FLOOR * this.intensity : 0;

    // surface state
    if (rain > 0.1) this.wetness = Math.min(1, this.wetness + WEATHER.WETNESS_GAIN * rain * dt);
    else this.wetness = Math.max(0, this.wetness - WEATHER.WETNESS_DECAY * dt);
    if (snow > 0.1) this.snowCover = Math.min(1, this.snowCover + WEATHER.SNOW_GAIN * snow * dt);
    else this.snowCover = Math.max(0, this.snowCover - WEATHER.SNOW_MELT * dt);
  }

  private rollNext(): WeatherKind {
    const w = WEATHER.WEIGHTS;
    const total = w.clear + w.rain + w.storm + w.snow;
    let roll = this.rng.next() * total;
    for (const kind of ['clear', 'rain', 'storm', 'snow'] as const) {
      roll -= w[kind];
      if (roll <= 0) return kind === this.kind && kind !== 'clear' ? 'clear' : kind;
    }
    return 'clear';
  }

  label(): string {
    switch (this.kind) {
      case 'clear':
        return this.intensity > 0.3 ? 'clearing' : 'clear';
      case 'rain':
        return 'rain';
      case 'storm':
        return '⚠ storm';
      case 'snow':
        return 'snow';
    }
  }
}
