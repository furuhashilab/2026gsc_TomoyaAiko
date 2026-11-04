// Dev tool (served at /tools/height-check.html by `npm run dev`): compares building-base
// heights from `uv run cf-scene sample-buildings` with terrain heights sampled by CesiumJS.
// Save the JSON as docs/evidence/issue-8/height-check.json to record a run.
import { Cartographic, CesiumTerrainProvider, sampleTerrainMostDetailed } from "cesium";
import cesiumPackage from "cesium/package.json";
import sceneConfig from "../../../config/scene.sapporo.json";
import samplesRaw from "../../../docs/evidence/issue-8/buildings-base.json?raw";
import { heightStats, parseScene } from "../scene";

interface Sample {
  gml_id: string;
  lon: number;
  lat: number;
  base_ellipsoidal_m: number;
  zmin_attr: number;
  lod: number;
  tileset: string;
}

async function sha256Hex(data: ArrayBuffer | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function run(): Promise<unknown> {
  const scene = parseScene(sceneConfig);
  const samples = JSON.parse(samplesRaw) as { buildings: Sample[]; sampled_utc: string; method: unknown };
  const layerBody = await (await fetch(`${scene.terrain.url}/layer.json`)).arrayBuffer();
  const layer = JSON.parse(new TextDecoder().decode(layerBody)) as { version?: string };
  const provider = await CesiumTerrainProvider.fromUrl(scene.terrain.url, { requestVertexNormals: scene.terrain.requestVertexNormals });
  const points = samples.buildings.map((b) => Cartographic.fromDegrees(b.lon, b.lat));
  await sampleTerrainMostDetailed(provider, points);
  const rows = samples.buildings.map((b, i) => ({
    gml_id: b.gml_id,
    lon: b.lon,
    lat: b.lat,
    lod: b.lod,
    base_ellipsoidal_m: b.base_ellipsoidal_m,
    terrain_m: Number(points[i].height.toFixed(3)),
    diff_m: Number((b.base_ellipsoidal_m - points[i].height).toFixed(3)),
    implied_geoid_m: Number((points[i].height - b.zmin_attr).toFixed(3)),
  }));
  return {
    checked_utc: new Date().toISOString(),
    criterion: "provisional: |building base - terrain| <= 2 m; not a claim that every building matches",
    comparison: "diff = lowest vertex height of the building geometry (ellipsoidal) - terrain height sampled at the building centroid with sampleTerrainMostDetailed",
    cesiumjs_version: cesiumPackage.version,
    user_agent: navigator.userAgent,
    terrain: {
      url: scene.terrain.url,
      config_version: scene.terrain.version,
      live_version: layer.version,
      live_layer_json_sha256: await sha256Hex(layerBody),
    },
    buildings_sample: {
      file: "docs/evidence/issue-8/buildings-base.json",
      sha256: await sha256Hex(samplesRaw),
      sampled_utc: samples.sampled_utc,
      method: samples.method,
    },
    stats: heightStats(rows.map((r) => r.diff_m)),
    implied_geoid_stats: heightStats(rows.map((r) => r.implied_geoid_m), Number.POSITIVE_INFINITY),
    rows,
  };
}

const state = document.getElementById("state") as HTMLParagraphElement;
const out = document.getElementById("out") as HTMLPreElement;
const button = document.getElementById("download") as HTMLButtonElement;
run()
  .then((result) => {
    const text = JSON.stringify(result, null, 1);
    out.textContent = text;
    const s = (result as { stats: { n: number; withinThreshold: number; median: number } }).stats;
    state.textContent = `完了：${s.withinThreshold}/${s.n} 棟が ±2 m 以内（中央値 ${s.median.toFixed(2)} m）`;
    (window as unknown as { __heightCheck: unknown }).__heightCheck = result;
    button.disabled = false;
    button.onclick = () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([text + "\n"], { type: "application/json" }));
      a.download = "height-check.json";
      a.click();
    };
  })
  .catch((e) => {
    state.textContent = `失敗：${e instanceof Error ? e.message : String(e)}`;
  });
