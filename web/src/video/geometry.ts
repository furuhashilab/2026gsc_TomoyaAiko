// Course geometry for the video: centre, radius and the partially drawn polyline.
//
// Self-contained on purpose (local equirectangular metres around the course centre, good
// enough for framing a city-scale course) so the PoC does not depend on PR #25's track.ts.
// Once #25 is merged these helpers can be replaced by its Track utilities.

export type LonLat = [number, number];

const M_PER_DEG_LAT = 111_132;

export interface Frame {
  centre: LonLat;
  /** Largest distance (m) from the centre to a course point. */
  radiusM: number;
  /** Cumulative planar distance (m) at each vertex. */
  cumulative: number[];
  lengthM: number;
}

export function toLocal([lon, lat]: LonLat, [clon, clat]: LonLat): [number, number] {
  return [(lon - clon) * M_PER_DEG_LAT * Math.cos((clat * Math.PI) / 180), (lat - clat) * M_PER_DEG_LAT];
}

export function courseFrame(coords: LonLat[]): Frame {
  const lons = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  const centre: LonLat = [(Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
  const local = coords.map((c) => toLocal(c, centre));
  const radiusM = Math.max(...local.map(([x, y]) => Math.hypot(x, y)));
  const cumulative = [0];
  for (let i = 1; i < local.length; i++) {
    cumulative.push(cumulative[i - 1] + Math.hypot(local[i][0] - local[i - 1][0], local[i][1] - local[i - 1][1]));
  }
  return { centre, radiusM, cumulative, lengthM: cumulative[cumulative.length - 1] };
}

/** The course from the start up to fraction p (0..1) of its length, ending exactly at that point. */
export function partialCourse(coords: LonLat[], frame: Frame, p: number): LonLat[] {
  const d = Math.min(1, Math.max(0, p)) * frame.lengthM;
  const out: LonLat[] = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const [a, b] = [frame.cumulative[i - 1], frame.cumulative[i]];
    if (b <= d) {
      out.push(coords[i]);
      continue;
    }
    const u = b > a ? (d - a) / (b - a) : 0;
    if (u > 0) out.push([coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * u, coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * u]);
    break;
  }
  return out;
}
