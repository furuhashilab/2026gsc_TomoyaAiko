// CircuitForge course file (contracts/course.schema.json): one GeoJSON Feature, WGS84 lon/lat.
// This parser only checks what the viewer relies on. Full validation against the road graph
// (one-ways, access, AOI, snapshot) is done by `uv run cf-course validate` in gis/.

export interface CourseSegment {
  edge_uid: string;
  way_id: number;
  from_node: number;
  to_node: number;
}

export interface CourseIssue {
  code: string;
  message: string;
}

export interface Course {
  id: string;
  name: string;
  mode: "circuit" | "rally";
  coordinates: [number, number][];
  segments: CourseSegment[];
  lengthM: number;
  synthetic: boolean;
  attribution: string;
  disclaimer: string;
  // Copied from the file for display only; it is not re-checked here.
  validation?: { status: "valid" | "invalid"; errors: CourseIssue[]; warnings: CourseIssue[] };
}

const EDGE_UID = /^-?\d+:\d+:[fr]$/;

function fail(message: string): never {
  throw new Error(`Invalid course file: ${message}`);
}

export function parseCourse(data: unknown): Course {
  const f = data as { type?: unknown; geometry?: { type?: unknown; coordinates?: unknown }; properties?: Record<string, unknown> };
  if (f?.type !== "Feature") fail("not a GeoJSON Feature");
  if (f.geometry?.type !== "LineString" || !Array.isArray(f.geometry.coordinates)) fail("geometry must be a LineString");
  const p = f.properties;
  if (!p || p.schema !== "circuitforge-course") fail("properties.schema must be circuitforge-course");
  if (typeof p.schema_version !== "string" || !p.schema_version.startsWith("0.1.")) fail(`unsupported schema_version ${String(p.schema_version)}`);
  if (p.mode !== "circuit" && p.mode !== "rally") fail("mode must be circuit or rally");
  if (p.fictional !== true) fail("fictional must be true");

  const coordinates = (f.geometry.coordinates as unknown[]).map((c, i) => {
    if (!Array.isArray(c) || c.length < 2 || typeof c[0] !== "number" || typeof c[1] !== "number") fail(`coordinate ${i} is not [lon, lat]`);
    const [lon, lat] = c as number[];
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) fail(`coordinate ${i} out of range (expected lon, lat order)`);
    return [lon, lat] as [number, number];
  });
  if (coordinates.length < 2) fail("at least two coordinates are required");

  const segments = p.segments as CourseSegment[];
  if (!Array.isArray(segments) || segments.length !== coordinates.length - 1) fail("segments must have one entry per coordinate step");
  segments.forEach((s, i) => {
    if (typeof s?.edge_uid !== "string" || !EDGE_UID.test(s.edge_uid)) fail(`segment ${i} has an invalid edge_uid`);
    if (i > 0 && s.from_node !== segments[i - 1].to_node) fail(`segment ${i} does not continue from segment ${i - 1}`);
  });
  if (p.mode === "circuit") {
    const [a, b] = [coordinates[0], coordinates[coordinates.length - 1]];
    if (segments[0].from_node !== segments[segments.length - 1].to_node || a[0] !== b[0] || a[1] !== b[1]) fail("circuit is not closed");
  }
  if (typeof p.length_m !== "number" || p.length_m <= 0) fail("length_m must be a positive number");

  return {
    id: String(p.id),
    name: String(p.name),
    mode: p.mode,
    coordinates,
    segments,
    lengthM: p.length_m,
    synthetic: p.synthetic === true,
    attribution: String(p.attribution ?? ""),
    disclaimer: String(p.disclaimer ?? ""),
    validation: p.validation as Course["validation"],
  };
}

// Approximate distances, only used to place direction arrows along the line.
function haversineM([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]): number {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(a));
}

/** Index pairs (i, i + 1) of segments at roughly every `spacingM` metres along the course. */
export function arrowSegments(coordinates: [number, number][], spacingM: number): number[] {
  const out: number[] = [];
  let next = spacingM / 2;
  let walked = 0;
  for (let i = 0; i < coordinates.length - 1; i++) {
    const d = haversineM(coordinates[i], coordinates[i + 1]);
    if (walked + d >= next && d > 1) {
      out.push(i);
      next += spacingM;
    }
    walked += d;
  }
  return out;
}
