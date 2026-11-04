// Vehicle path along a course, independent of CesiumJS (unit-tested).
//
// - Position: linear interpolation on the course polyline itself (OSM node to node), so
//   the vehicle always stays on the road centre line; geometry is never smoothed.
// - Heading: bearing of the chord between s - w/2 and s + w/2 (w = heading window). This
//   only softens the orientation at polyline corners.
// - Height: terrain heights sampled every `terrainStepM` (independent of the position
//   interpolation) and linearly interpolated.
// Distances use a local tangent plane with WGS84 meridian / prime-vertical radii at the
// course's mean latitude (sub-0.01 % error over a few km); this is for animation timing,
// not for course metrics (those use the course file's length_m).
//
// This is a visualisation of a route, not a vehicle dynamics model.

const A = 6378137.0;
const E2 = 0.00669437999014;
const RAD = Math.PI / 180;

export interface Track {
  closed: boolean;
  length: number;
  /** cumulative distance at each polyline vertex */
  s: number[];
  x: number[];
  y: number[];
  lon0: number;
  lat0: number;
  mPerDegLon: number;
  mPerDegLat: number;
}

export function buildTrack(coordinates: [number, number][], closed: boolean): Track {
  if (coordinates.length < 2) throw new Error("a track needs at least two coordinates");
  const lat0 = coordinates.reduce((a, c) => a + c[1], 0) / coordinates.length;
  const lon0 = coordinates[0][0];
  const sin = Math.sin(lat0 * RAD);
  const w = Math.sqrt(1 - E2 * sin * sin);
  const mPerDegLat = ((A * (1 - E2)) / (w * w * w)) * RAD; // meridian radius M
  const mPerDegLon = (A / w) * Math.cos(lat0 * RAD) * RAD; // prime vertical radius N * cos
  const x = coordinates.map((c) => (c[0] - lon0) * mPerDegLon);
  const y = coordinates.map((c) => (c[1] - lat0) * mPerDegLat);
  const s = [0];
  for (let i = 1; i < x.length; i++) s.push(s[i - 1] + Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1]));
  return { closed, length: s[s.length - 1], s, x, y, lon0, lat0, mPerDegLon, mPerDegLat };
}

/** Wrap (circuit) or clamp (rally) a distance onto [0, length]. */
export function normalise(track: Track, d: number): number {
  if (track.closed) return ((d % track.length) + track.length) % track.length;
  return Math.min(Math.max(d, 0), track.length);
}

function segmentIndex(track: Track, d: number): number {
  let lo = 0;
  let hi = track.s.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (track.s[mid] <= d) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Planar position (m) at distance d along the polyline. */
export function xyAt(track: Track, distance: number): [number, number] {
  const d = normalise(track, distance);
  const i = segmentIndex(track, d);
  const len = track.s[i + 1] - track.s[i];
  const t = len > 0 ? (d - track.s[i]) / len : 0;
  return [track.x[i] + t * (track.x[i + 1] - track.x[i]), track.y[i] + t * (track.y[i + 1] - track.y[i])];
}

export function lonLatAt(track: Track, distance: number): [number, number] {
  const [x, y] = xyAt(track, distance);
  return [track.lon0 + x / track.mPerDegLon, track.lat0 + y / track.mPerDegLat];
}

/** Heading (radians clockwise from north) of the chord over a window centred on d. */
export function headingAt(track: Track, distance: number, windowM: number): number {
  const half = windowM / 2;
  let a = distance - half;
  let b = distance + half;
  if (!track.closed) {
    // keep the full window inside the route near its ends
    if (a < 0) [a, b] = [0, Math.min(windowM, track.length)];
    if (b > track.length) [a, b] = [Math.max(track.length - windowM, 0), track.length];
  }
  const [x1, y1] = xyAt(track, a);
  const [x2, y2] = xyAt(track, b);
  return Math.atan2(x2 - x1, y2 - y1);
}

/** Heading of the polyline segment that contains d (no smoothing), for comparison. */
export function segmentHeadingAt(track: Track, distance: number): number {
  const i = segmentIndex(track, normalise(track, distance));
  return Math.atan2(track.x[i + 1] - track.x[i], track.y[i + 1] - track.y[i]);
}

/** Smallest signed difference a - b of two angles, in (-pi, pi]. */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

/** Distances at which terrain heights are sampled (every stepM, plus the end of a rally). */
export function terrainSampleDistances(track: Track, stepM: number): number[] {
  const n = Math.max(1, Math.ceil(track.length / stepM));
  const out: number[] = [];
  for (let k = 0; k < n; k++) out.push(k * (track.length / n));
  if (!track.closed) out.push(track.length);
  return out;
}

/** Linear interpolation of heights sampled at `terrainSampleDistances` (wraps for circuits). */
export function heightAt(track: Track, sampleDistances: number[], heights: number[], distance: number): number {
  const d = normalise(track, distance);
  const n = sampleDistances.length;
  if (n === 1) return heights[0];
  const step = track.closed ? track.length / n : track.length / (n - 1);
  const k = Math.min(Math.floor(d / step), track.closed ? n - 1 : n - 2);
  const t = (d - sampleDistances[k]) / step;
  const next = track.closed ? (k + 1) % n : k + 1;
  return heights[k] + t * (heights[next] - heights[k]);
}

/** Pitch (radians, nose up positive) from the height difference over a window. */
export function pitchAt(
  track: Track,
  sampleDistances: number[],
  heights: number[],
  distance: number,
  windowM: number,
): number {
  const h1 = heightAt(track, sampleDistances, heights, distance - windowM / 2);
  const h2 = heightAt(track, sampleDistances, heights, distance + windowM / 2);
  return Math.atan2(h2 - h1, windowM);
}

/** Distance travelled after `seconds` at `speedMps` (loops for circuits, stops for rallies). */
export function distanceAtTime(track: Track, seconds: number, speedMps: number): number {
  return normalise(track, seconds * speedMps);
}
