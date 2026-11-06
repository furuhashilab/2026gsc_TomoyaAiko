// Base-map and building-style options for the viewer (Issue #26), read from
// config/basemaps.json. Tile URLs and attribution live in the config so adding or
// changing a source needs no code change.
import type { SceneConfig, SceneTileset } from "./scene";

export interface Basemap {
  id: string;
  name: string;
  /** XYZ template, or null for a plain globe colour (no external data). */
  url: string | null;
  maximumLevel: number;
  baseColor: string;
  attribution: string | null;
  attributionUrl: string | null;
  extraCredits: string[];
}

export type BuildingStyle = "untextured" | "textured";
export const BUILDING_STYLES: BuildingStyle[] = ["untextured", "textured"];

/** Look of untextured buildings: a flat colour and the image-based (ambient) light factor. */
export interface BuildingLook {
  color: string;
  imageBasedLightingFactor: number;
}

export interface BasemapConfig {
  basemaps: Basemap[];
  untexturedLook: BuildingLook | null;
  buildings: { id: BuildingStyle; name: string }[];
  defaultBasemap: string;
  defaultBuildings: BuildingStyle;
}

function fail(message: string): never {
  throw new Error(`Invalid basemap config: ${message}`);
}

export function parseBasemaps(data: unknown): BasemapConfig {
  const d = data as Record<string, unknown>;
  if (d?.schema !== "circuitforge-basemaps") fail("schema must be circuitforge-basemaps");
  if (!Array.isArray(d.basemaps) || d.basemaps.length === 0) fail("basemaps must be a non-empty array");
  const basemaps = (d.basemaps as Record<string, unknown>[]).map((b, i): Basemap => {
    const id = typeof b.id === "string" && b.id ? b.id : fail(`basemap ${i} has no id`);
    const url = b.url ?? null;
    if (url !== null && (typeof url !== "string" || !url.startsWith("https://") || !url.includes("{z}"))) {
      fail(`${id}: url must be an https XYZ template`);
    }
    // External tiles must carry their attribution; only the no-data option may omit it.
    if (url !== null && (typeof b.attribution !== "string" || !b.attribution || typeof b.attribution_url !== "string")) {
      fail(`${id}: attribution and attribution_url are required for external tiles`);
    }
    return {
      id,
      name: String(b.name ?? id),
      url: url as string | null,
      maximumLevel: Number(b.maximum_level ?? 18),
      baseColor: String(b.base_color ?? "#8a8f94"),
      attribution: url === null ? null : (b.attribution as string),
      attributionUrl: url === null ? null : (b.attribution_url as string),
      extraCredits: Array.isArray(b.extra_credits) ? b.extra_credits.map(String) : [],
    };
  });
  if (new Set(basemaps.map((b) => b.id)).size !== basemaps.length) fail("basemap ids must be unique");
  const buildings = (Array.isArray(d.buildings) ? d.buildings : []).map((b: Record<string, unknown>) => {
    if (!BUILDING_STYLES.includes(b.id as BuildingStyle)) fail(`unknown building style ${String(b.id)}`);
    return { id: b.id as BuildingStyle, name: String(b.name ?? b.id) };
  });
  const defaultBasemap = String(d.default_basemap);
  if (!basemaps.some((b) => b.id === defaultBasemap)) fail(`default_basemap ${defaultBasemap} is not defined`);
  const defaultBuildings = d.default_buildings as BuildingStyle;
  if (!BUILDING_STYLES.includes(defaultBuildings)) fail("default_buildings must be untextured or textured");
  return { basemaps, buildings, defaultBasemap, defaultBuildings, untexturedLook: parseLook(d.untextured_building_look) };
}

function parseLook(v: unknown): BuildingLook | null {
  if (v === undefined) return null;
  const l = v as Record<string, unknown>;
  if (typeof l.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(l.color)) fail("untextured_building_look.color must be #rrggbb");
  const f = l.image_based_lighting_factor ?? 1;
  if (typeof f !== "number" || !(f >= 0 && f <= 1)) fail("untextured_building_look.image_based_lighting_factor must be between 0 and 1");
  return { color: l.color, imageBasedLightingFactor: f };
}

/** The basemap named by `id` (e.g. a URL parameter), or the configured default. */
export function pickBasemap(cfg: BasemapConfig, id: string | null): Basemap {
  return cfg.basemaps.find((b) => b.id === id) ?? (cfg.basemaps.find((b) => b.id === cfg.defaultBasemap) as Basemap);
}

export function pickBuildingStyle(cfg: BasemapConfig, id: string | null): BuildingStyle {
  return BUILDING_STYLES.includes(id as BuildingStyle) ? (id as BuildingStyle) : cfg.defaultBuildings;
}

/**
 * Building tilesets to show for a style. A textured tileset takes the place of the one it
 * replaces (same ward), so no building is drawn twice; other wards stay untextured.
 */
export function tilesetsFor(scene: SceneConfig, style: BuildingStyle): SceneTileset[] {
  if (style === "untextured") return scene.buildings.tilesets;
  const byReplaced = new Map(scene.buildings.texturedTilesets.map((t) => [t.replaces, t]));
  return scene.buildings.tilesets.map((t) => byReplaced.get(t.id) ?? t);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** On-screen credit HTML for a basemap (null when it uses no external data). */
export function basemapCreditHtml(b: Basemap): string | null {
  if (!b.attribution || !b.attributionUrl) return null;
  const link = `<a href="${escapeHtml(b.attributionUrl)}" target="_blank" rel="noopener">${escapeHtml(b.attribution)}</a>`;
  return [link, ...b.extraCredits.map(escapeHtml)].join(" / ");
}
