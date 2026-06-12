// Every gameplay tunable lives here so balance iteration touches one file.

export const GRID = {
  W: 256, // x extent
  D: 256, // z extent
  H: 40, // y extent (height)
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
  /** Chance a destroyed voxel drops a rubble block onto the surface below. */
  RUBBLE_CHANCE: 0.45,
} as const;

export const WIND = {
  /** Seconds between retargeting the wind random walk. */
  RETARGET_MIN_S: 30,
  RETARGET_MAX_S: 60,
  /** Lerp rate per second toward target. */
  LERP_RATE: 0.05,
  MAX_ANGLE_STEP: Math.PI, // max retarget angular change
} as const;

export const WEATHER = {
  /** Seconds a weather state lasts before re-rolling. */
  MIN_DURATION_S: 50,
  MAX_DURATION_S: 120,
  /** Intensity ramp in/out time. */
  RAMP_S: 8,
  /** Weights for the next-state roll. */
  WEIGHTS: { clear: 0.5, rain: 0.22, storm: 0.13, snow: 0.15 },
  /** Heat removed per tick from every burning voxel at full rain. */
  RAIN_DOUSE: 2.2,
  /** Ignition probability multiplier at full rain / snow. */
  RAIN_SPREAD_MUL: 0.45,
  SNOW_SPREAD_MUL: 0.7,
  /** Wind strength floor during a storm. */
  STORM_WIND_FLOOR: 0.85,
  /** Ground wetness build/decay rates (per second). */
  WETNESS_GAIN: 0.12,
  WETNESS_DECAY: 0.02,
  SNOW_GAIN: 0.05,
  SNOW_MELT: 0.03,
  /** Full day-night cycle length in seconds. */
  DAY_LENGTH_S: 480,
} as const;

export const UNITS = {
  ENGINE: {
    speed: 10, // top speed, voxels/sec on road
    accel: 6, // voxels/sec^2
    brake: 11,
    /** Kinematic turning radius in voxels — lower = tighter corners. */
    turnRadius: 2.4,
    /** How quickly the travel direction catches up to the heading (grip). Drift when it lags. */
    grip: 5.0,
    hoseRange: 9,
    hosePower: 4.5, // water units/sec
    waterMax: 110,
    refillRate: 22, // units/sec at station or hydrant
    /** Idle engines self-engage fires within this radius (close-proximity intelligence). */
    engageRadius: 13,
  },
  FIREFIGHTER: {
    speed: 3.6,
    hoseRange: 6,
    hosePower: 1.8, // drawn from the parent engine's tank
    /** Max distance from the engine (hose length). */
    tether: 13,
  },
  HELICOPTER: {
    speed: 12,
    altitude: 26,
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

export const CIVILIANS = {
  CARS: 28,
  PEDESTRIANS: 90,
  CAR_SPEED: 4.5,
  CAR_ACCEL: 3,
  PED_SPEED: 1.3,
  PED_FLEE_SPEED: 3.4,
  /** Fire within this range makes civilians flee. */
  FLEE_RADIUS: 15,
  /** Fled pedestrians may stop and watch from outside this ring. */
  GAWK_RADIUS: 22,
  GAWK_CHANCE: 0.3,
  /** Cars pull over when an active engine is within this range. */
  PULLOVER_RADIUS: 9,
} as const;

export const WAVES = {
  /** Grace period between waves, seconds. */
  GRACE_S: 12,
  ignitionCount: (wave: number) => 1 + Math.floor(wave / 2),
  /** Seconds between ignitions within a wave (longer early: the map is big and engines are few). */
  ignitionInterval: (wave: number) => Math.max(60 - 3 * wave, 18),
  /** Early outbreaks stay near the HQ; later waves hit the whole city. */
  targetRadius: (wave: number) => (wave < 3 ? 75 : wave < 6 ? 130 : 10000),
  /** Cap on wind strength (0..1) by wave, so early waves are gentle. */
  windCap: (wave: number) => Math.min(0.3 + wave * 0.08, 1),
  /** From this wave on, industrial/commercial targets are allowed. */
  INDUSTRIAL_FROM_WAVE: 3,
} as const;

export const ECONOMY = {
  STARTING_CASH: 200,
  CASH_PER_EXTINGUISHED_VOXEL: 0.6,
  /** Bonus per building saved, scaled by lot value (1..3). */
  SAVE_BONUS: 70,
  WAVE_CLEAR_BONUS: (wave: number) => 40 + wave * 18,
  /** Building damage ratio thresholds. */
  SAVED_BELOW: 0.3,
  LOST_ABOVE: 0.7,
  /** City integrity lost per building lost, scaled by lot value. */
  INTEGRITY_LOSS: 6,
  STARTING_INTEGRITY: 100,
  /** Repair cost per damaged voxel, scaled by lot value. */
  REPAIR_COST_PER_VOXEL: 0.8,
} as const;

export const PARTICLES = {
  SMOKE_MAX: 6000,
  FLAME_MAX: 4000,
  EMBER_MAX: 800,
  WATER_MAX: 1500,
  SPLASH_MAX: 1200,
  RAIN_MAX: 4000,
  SNOW_MAX: 2500,
  /** Burning voxels sampled per frame for emission. */
  EMIT_SAMPLES: 90,
} as const;

export const RENDER = {
  MAX_CHUNK_REBUILDS_PER_FRAME: 2,
  CAM_MIN_DIST: 18,
  CAM_MAX_DIST: 260,
  CAM_MIN_POLAR: 0.25, // radians from vertical
  CAM_MAX_POLAR: 1.15,
} as const;
