import { Wind } from '../sim/wind';

/**
 * Compass arrow showing where the wind blows TOWARD, relative to the camera
 * yaw so "up" on the compass matches "away" on screen.
 */
export class WindIndicator {
  private arrow = document.getElementById('wind-arrow')!;
  private label = document.getElementById('wind-strength')!;

  constructor(private wind: Wind) {}

  update(cameraYaw: number): void {
    // world angle -> clockwise screen rotation from "up": (angle - yaw + pi)
    const screenAngle = this.wind.angle - cameraYaw + Math.PI;
    const deg = (screenAngle * 180) / Math.PI;
    const scale = 0.6 + this.wind.strength * 0.7;
    this.arrow.setAttribute('transform', `rotate(${deg.toFixed(1)}) scale(${scale.toFixed(2)})`);
    this.label.textContent = this.wind.label();
  }
}
