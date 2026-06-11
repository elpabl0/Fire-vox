// Every gameplay tunable lives here so balance iteration touches one file.

export const GRID = {
  W: 128, // x extent
  D: 128, // z extent
  H: 32, // y extent (height)
  CHUNK: 16, // chunk footprint in voxels (square)
} as const;

export const SIM = {
  TICK_HZ: 6,
  TICK_DT: 1 / 6,
  /** Max burning voxels processed per tick; beyond this the set is processed in rotating slices. */
  MAX_FIRE_PER_TICK: 4000,
  /** Global multiplier on ignition probability. */
  SPREAD_RATE: 0.02,
  /** Heat is clamped here so knockdown effort stays bounded. */
  HEAT_MAX: 300,
  /** Heat decays by this factor per tick for non-burning hot cells. */
  HEAT_DECAY: 0.92,
  /** Heat below this is snapped to zero. */
  HEAT_EPSILON: 0.5,
  /** Wind influence: windMul = clamp(1 + WIND_BIAS * dot * strength, min, max). */
  WIND_BIAS: 1.5,
  WIND_MUL_MIN: 0.25,
  WIND_MUL_MAX: 2.5,
  VERT_MUL_UP: 2.0,
  VERT_MUL_DOWN: 0.3,
  WET_MUL: 0.15,
  /** Ticks a voxel stays WET after a water hit. */
  WET_TICKS: 30,
  /** Heat removed per unit of water. */
  WATER_COOL: 20,
  /** Burning voxel is extinguished if its heat falls below this fraction of ignitionHeat. */
  EXTINGUISH_FRACTION: 0.35,
  /** Chance per tick that a burning roof-exposed voxel throws an ember downwind (scaled by wind strength). */
  EMBER_CHANCE: 0.003,
  EMBER_MIN_DIST: 2,
  EMBER_MAX_DIST: 6,
} as const;

export const WIND = {
  /** Seconds between retargeting the wind random walk. */
  RETARGET_MIN_S: 30,
  RETARGET_MAX_S: 60,
  /** Lerp rate per second toward target. */
  LERP_RATE: 0.05,
  MAX_ANGLE_STEP: Math.PI, // max retarget angular change
} as const;

export const UNITS = {
  ENGINE: {
    speed: 7, // voxels/sec on road
    hoseRange: 9,
    hosePower: 4.5, // water units/sec
    waterMax: 110,
    refillRate: 22, // units/sec at station
    cost: 0, // first engine free
  },
  HELICOPTER: {
    speed: 12,
    altitude: 22,
    dropRadius: 3.5,
    dropAmount: 90,
    waterMax: 90,
    fillRate: 30,
  },
  /** Re-plan clusters / assignments every this many seconds. */
  COORDINATE_INTERVAL_S: 1.0,
  /** Min spacing (voxels) between two units' claimed perimeter targets. */
  CLAIM_SPACING: 4,
} as const;

export const WAVES = {
  /** Grace period between waves, seconds. */
  GRACE_S: 12,
  ignitionCount: (wave: number) => 1 + Math.floor(wave / 2),
  /** Seconds between ignitions within a wave. */
  ignitionInterval: (wave: number) => Math.max(45 - 2 * wave, 15),
  /** Cap on wind strength (0..1) by wave, so early waves are gentle. */
  windCap: (wave: number) => Math.min(0.3 + wave * 0.08, 1),
  /** From this wave on, industrial/commercial targets are allowed. */
  INDUSTRIAL_FROM_WAVE: 3,
} as const;

export const ECONOMY = {
  STARTING_CASH: 120,
  CASH_PER_EXTINGUISHED_VOXEL: 0.6,
  /** Bonus per building saved, scaled by lot value (1..3). */
  SAVE_BONUS: 60,
  WAVE_CLEAR_BONUS: (wave: number) => 40 + wave * 18,
  /** Building damage ratio thresholds. */
  SAVED_BELOW: 0.3,
  LOST_ABOVE: 0.7,
  /** City integrity lost per building lost, scaled by lot value. */
  INTEGRITY_LOSS: 6,
  STARTING_INTEGRITY: 100,
} as const;

export const PARTICLES = {
  SMOKE_MAX: 6000,
  FLAME_MAX: 4000,
  EMBER_MAX: 800,
  WATER_MAX: 1500,
  SPLASH_MAX: 1200,
  /** Burning voxels sampled per frame for emission. */
  EMIT_SAMPLES: 90,
} as const;

export const RENDER = {
  MAX_CHUNK_REBUILDS_PER_FRAME: 2,
  CAM_MIN_DIST: 18,
  CAM_MAX_DIST: 160,
  CAM_MIN_POLAR: 0.25, // radians from vertical
  CAM_MAX_POLAR: 1.15,
} as const;
