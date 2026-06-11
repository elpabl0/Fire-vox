export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Shortest-path angular interpolation. */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function dist2d(ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Initial velocity for a ballistic arc from `from` to `to` under gravity g (positive),
 * peaking `apexAbove` units above the higher endpoint. Used for hose streams and aim previews.
 */
export function ballisticVelocity(
  fx: number,
  fy: number,
  fz: number,
  tx: number,
  ty: number,
  tz: number,
  g: number,
  apexAbove: number,
): { vx: number; vy: number; vz: number; flightTime: number } {
  const apexY = Math.max(fy, ty) + apexAbove;
  const upTime = Math.sqrt((2 * (apexY - fy)) / g);
  const downTime = Math.sqrt((2 * (apexY - ty)) / g);
  const flightTime = upTime + downTime;
  const vy = g * upTime;
  return {
    vx: (tx - fx) / flightTime,
    vy,
    vz: (tz - fz) / flightTime,
    flightTime,
  };
}
