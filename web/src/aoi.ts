// Shared AOI config (config/aoi.*.json). WGS84 (EPSG:4326), longitude/latitude order.
// Mirrors gis/src/circuitforge_gis/aoi.py so both sides reject the same mistakes.

export interface Aoi {
  id: string;
  name: string;
  lonMin: number;
  latMin: number;
  lonMax: number;
  latMax: number;
}

export function parseAoi(data: unknown): Aoi {
  const d = data as { id?: unknown; name?: unknown; bbox?: unknown; crs?: unknown };
  if (d.crs !== "EPSG:4326") {
    throw new Error(`AOI crs must be EPSG:4326, got ${String(d.crs)}`);
  }
  if (!Array.isArray(d.bbox) || d.bbox.length !== 4 || !d.bbox.every((v) => typeof v === "number")) {
    throw new Error("AOI bbox must be [lonMin, latMin, lonMax, latMax]");
  }
  const [lonMin, latMin, lonMax, latMax] = d.bbox as number[];
  if (!(-180 <= lonMin && lonMin < lonMax && lonMax <= 180)) {
    throw new Error(`AOI longitudes out of range or not increasing: ${lonMin}, ${lonMax}`);
  }
  if (!(-90 <= latMin && latMin < latMax && latMax <= 90)) {
    throw new Error(`AOI latitudes out of range or not increasing: ${latMin}, ${latMax}`);
  }
  return { id: String(d.id), name: String(d.name), lonMin, latMin, lonMax, latMax };
}
