// Extra vehicle height over a stretch of the course, e.g. where the race presentation draws
// a road surface lifted above the terrain. Pure maths (no CesiumJS) so it can be unit-tested.

export interface GroundLift {
  /** start and end of the lifted stretch, as distance s along the course (m) */
  fromS: number;
  toS: number;
  /** full extra height inside [fromS, toS] (m) */
  liftM: number;
  /**
   * Length of the ease-in/out just outside the stretch (m). The ramp lies outside so the
   * vehicle is already at full height wherever the lifted surface exists.
   */
  rampM: number;
}

/** Default ramp: 0.10 m over 4 m is a 1.4 % grade, under a frame of motion at demo speed. */
export const DEFAULT_LIFT_RAMP_M = 4;

// distance from s to the stretch, 0 inside; on a closed loop the shorter way round counts
function gapToStretch(s: number, lift: GroundLift, length: number, closed: boolean): number {
  if (s >= lift.fromS && s <= lift.toS) return 0;
  const before = lift.fromS - s; // > 0 when s is before the stretch
  const after = s - lift.toS; // > 0 when s is after it
  if (!closed) return before > 0 ? before : after;
  const mod = (x: number) => ((x % length) + length) % length;
  return Math.min(mod(lift.fromS - s), mod(s - lift.toS));
}

/**
 * Extra height at course distance `s`: `liftM` inside the stretch, 0 beyond the ramps, and a
 * smoothstep in between (continuous in height and slope, so no jump at the entry or exit).
 */
export function liftAt(s: number, lift: GroundLift | null, length: number, closed: boolean): number {
  if (!lift || lift.liftM === 0) return 0;
  const gap = gapToStretch(s, lift, length, closed);
  if (gap === 0) return lift.liftM;
  if (lift.rampM <= 0 || gap >= lift.rampM) return 0;
  const t = 1 - gap / lift.rampM;
  return lift.liftM * t * t * (3 - 2 * t);
}
