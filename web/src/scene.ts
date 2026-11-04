// 3D scene sources (config/scene.*.json, written by `uv run cf-scene build`).
// Delivery URLs, attribution and snapshot info live in the config so a provider change
// only needs a new config, not code changes.

export interface SceneTileset {
  id: string;
  name: string;
  url: string;
  lod: string;
  year: number;
}

export interface SceneConfig {
  terrain: { url: string; requestVertexNormals: boolean; attribution: string; version: string };
  buildings: { attribution: string; tilesets: SceneTileset[] };
}

export const TERRAIN_ATTRIBUTION = "PLATEAU | Mapterhorn | 国土地理院";

function fail(message: string): never {
  throw new Error(`Invalid scene config: ${message}`);
}

function httpsUrl(value: unknown, what: string): string {
  if (typeof value !== "string" || !value.startsWith("https://")) fail(`${what} must be an https URL`);
  return value;
}

export function parseScene(data: unknown): SceneConfig {
  const d = data as { schema?: unknown; terrain?: Record<string, unknown>; buildings?: Record<string, unknown> };
  if (d?.schema !== "circuitforge-scene") fail("schema must be circuitforge-scene");
  const t = d.terrain;
  const b = d.buildings;
  if (!t || !b) fail("terrain and buildings are required");
  // The terrain provider requires this exact attribution; refuse configs that drop it.
  if (typeof t.attribution !== "string" || !t.attribution.includes(TERRAIN_ATTRIBUTION)) {
    fail(`terrain attribution must include "${TERRAIN_ATTRIBUTION}"`);
  }
  if (typeof b.attribution !== "string" || b.attribution.length === 0) fail("buildings attribution is required");
  if (!Array.isArray(b.tilesets)) fail("buildings.tilesets must be an array");
  const snapshot = (t.snapshot ?? {}) as { version?: unknown };
  return {
    terrain: {
      url: httpsUrl(t.url, "terrain.url"),
      requestVertexNormals: t.request_vertex_normals === true,
      attribution: t.attribution,
      version: String(snapshot.version ?? "unknown"),
    },
    buildings: {
      attribution: b.attribution,
      tilesets: (b.tilesets as Record<string, unknown>[]).map((ts, i) => ({
        id: String(ts.id ?? fail(`tileset ${i} has no id`)),
        name: String(ts.name ?? ts.id),
        url: httpsUrl(ts.url, `tileset ${i} url`),
        lod: String(ts.lod ?? ""),
        year: Number(ts.year),
      })),
    },
  };
}

export interface HeightStats {
  n: number;
  mean: number;
  min: number;
  p10: number;
  median: number;
  p90: number;
  max: number;
  withinThreshold: number;
  thresholdM: number;
}

/** Summary of (building base - terrain) differences; the threshold is a provisional criterion. */
export function heightStats(diffs: number[], thresholdM = 2): HeightStats {
  if (diffs.length === 0) throw new Error("no height differences");
  const s = [...diffs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return {
    n: s.length,
    mean: s.reduce((a, b) => a + b, 0) / s.length,
    min: s[0],
    p10: q(0.1),
    median: q(0.5),
    p90: q(0.9),
    max: s[s.length - 1],
    withinThreshold: s.filter((d) => Math.abs(d) <= thresholdM).length,
    thresholdM,
  };
}
