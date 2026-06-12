import { WIND } from '../config';
import { Rng } from '../core/rng';
import { lerp, lerpAngle } from '../core/math';

/**
 * Global wind: an angle + strength pair following a slow random walk.
 * Strength is capped externally by the wave director so early waves stay gentle.
 */
export class Wind {
  angle: number; // radians; 0 = +x, pi/2 = +z
  strength = 0.2; // 0..1
  /** Unit direction, updated every frame for cheap reads by the sim and shaders. */
  dirX = 1;
  dirZ = 0;

  private targetAngle: number;
  private targetStrength: number;
  private retargetIn: number;
  strengthCap = 1;
  /** Minimum strength forced by storms. */
  strengthFloor = 0;

  constructor(private rng: Rng) {
    this.angle = rng.range(0, Math.PI * 2);
    this.targetAngle = this.angle;
    this.targetStrength = rng.range(0.1, 0.5);
    this.retargetIn = rng.range(WIND.RETARGET_MIN_S, WIND.RETARGET_MAX_S);
    this.updateDir();
  }

  update(dt: number): void {
    this.retargetIn -= dt;
    if (this.retargetIn <= 0) {
      this.retargetIn = this.rng.range(WIND.RETARGET_MIN_S, WIND.RETARGET_MAX_S);
      this.targetAngle = this.angle + this.rng.range(-WIND.MAX_ANGLE_STEP, WIND.MAX_ANGLE_STEP);
      this.targetStrength = this.rng.range(0.05, 1);
    }
    const t = 1 - Math.exp(-WIND.LERP_RATE * dt * 20);
    this.angle = lerpAngle(this.angle, this.targetAngle, t * 0.2);
    this.strength = lerp(this.strength, Math.min(this.targetStrength, this.strengthCap), t * 0.2);
    this.strength = Math.min(1, Math.max(this.strength, this.strengthFloor));
    this.updateDir();
  }

  private updateDir(): void {
    this.dirX = Math.cos(this.angle);
    this.dirZ = Math.sin(this.angle);
  }

  /** Human-readable strength label for the HUD. */
  label(): string {
    if (this.strength < 0.15) return 'calm';
    if (this.strength < 0.35) return 'light breeze';
    if (this.strength < 0.6) return 'windy';
    if (this.strength < 0.85) return 'strong wind';
    return 'gale';
  }
}
