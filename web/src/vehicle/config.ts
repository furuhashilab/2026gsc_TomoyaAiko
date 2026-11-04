// Vehicle model and animation settings (config/vehicle.json). Licence and provenance fields
// are required so an unlicensed model cannot be dropped in silently.

export interface VehicleConfig {
  modelUri: string;
  license: string;
  attribution: string;
  scale: number;
  groundOffsetM: number;
  headingOffsetRad: number;
  headingWindowM: number;
  pitchWindowM: number;
  terrainStepM: number;
  baseSpeedMps: number;
  multipliers: number[];
  cameras: {
    chase: { rangeM: number; pitchRad: number; smoothing: number };
    onboardLike: { forwardM: number; heightM: number; pitchRad: number };
    aerial: { rangeM: number; pitchRad: number };
  };
}

const DEG = Math.PI / 180;

function fail(message: string): never {
  throw new Error(`Invalid vehicle config: ${message}`);
}

function num(v: unknown, what: string, min = -Infinity): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min) fail(`${what} must be a number >= ${min}`);
  return v;
}

export function parseVehicleConfig(data: unknown): VehicleConfig {
  const d = data as Record<string, Record<string, unknown>>;
  if (d?.schema as unknown !== "circuitforge-vehicle") fail("schema must be circuitforge-vehicle");
  const m = d.model ?? fail("model is required");
  for (const k of ["uri", "license", "license_url", "source", "author", "attribution"]) {
    if (typeof m[k] !== "string" || !(m[k] as string)) fail(`model.${k} is required`);
  }
  const files = m.files as Record<string, unknown> | undefined;
  if (!files || typeof files[m.uri as string] !== "string") fail("model.files must list the SHA-256 of model.uri");
  const g = d.geometry ?? fail("geometry is required");
  const a = d.animation ?? fail("animation is required");
  const c = (d.cameras ?? fail("cameras is required")) as Record<string, Record<string, unknown>>;
  const multipliers = a.playback_multipliers;
  if (!Array.isArray(multipliers) || multipliers.length === 0) fail("animation.playback_multipliers is required");
  return {
    modelUri: m.uri as string,
    license: m.license as string,
    attribution: m.attribution as string,
    scale: num(g.scale, "geometry.scale", 0),
    groundOffsetM: num(g.ground_offset_m, "geometry.ground_offset_m"),
    headingOffsetRad: num(g.heading_offset_deg, "geometry.heading_offset_deg") * DEG,
    headingWindowM: num(a.heading_window_m, "animation.heading_window_m", 0),
    pitchWindowM: num(a.pitch_window_m, "animation.pitch_window_m", 0),
    terrainStepM: num(a.terrain_sample_step_m, "animation.terrain_sample_step_m", 0.5),
    baseSpeedMps: num(a.base_speed_kmh, "animation.base_speed_kmh", 0) / 3.6,
    multipliers: multipliers.map((x, i) => num(x, `animation.playback_multipliers[${i}]`, 0)),
    cameras: {
      chase: {
        rangeM: num(c.chase?.range_m, "cameras.chase.range_m", 0),
        pitchRad: num(c.chase?.pitch_deg, "cameras.chase.pitch_deg") * DEG,
        smoothing: num(c.chase?.heading_smoothing, "cameras.chase.heading_smoothing", 0),
      },
      onboardLike: {
        forwardM: num(c.onboard_like?.forward_m, "cameras.onboard_like.forward_m"),
        heightM: num(c.onboard_like?.height_m, "cameras.onboard_like.height_m"),
        pitchRad: num(c.onboard_like?.pitch_deg, "cameras.onboard_like.pitch_deg") * DEG,
      },
      aerial: {
        rangeM: num(c.aerial?.range_m, "cameras.aerial.range_m", 0),
        pitchRad: num(c.aerial?.pitch_deg, "cameras.aerial.pitch_deg") * DEG,
      },
    },
  };
}
