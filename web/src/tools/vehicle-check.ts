// Dev tool (served at /tools/vehicle-check.html by `npm run dev`): reproduces the Issue #9
// checks of the vehicle path. Save the JSON as docs/evidence/issue-9/vehicle-check.json.
import { Cartographic, CesiumTerrainProvider, sampleTerrainMostDetailed } from "cesium";
import cesiumPackage from "cesium/package.json";
import sceneConfig from "../../../config/scene.sapporo.json";
import vehicleConfig from "../../../config/vehicle.json";
import { parseCourse } from "../course";
import { heightStats, parseScene } from "../scene";
import { parseVehicleConfig } from "../vehicle/config";
import {
  angleDiff,
  buildTrack,
  headingAt,
  heightAt,
  lonLatAt,
  segmentHeadingAt,
  type Track,
  terrainSampleDistances,
} from "../vehicle/track";

const COURSE_URL = "/courses/sapporo-demo.course.geojson";
const DEG = 180 / Math.PI;
const round = (v: number) => Number(v.toFixed(3));

async function sample(provider: CesiumTerrainProvider, track: Track, ds: number[]): Promise<number[]> {
  const pts = ds.map((d) => {
    const [lon, lat] = lonLatAt(track, d);
    return Cartographic.fromDegrees(lon, lat);
  });
  await sampleTerrainMostDetailed(provider, pts);
  return pts.map((p) => p.height);
}

function terrainRequests(): number {
  return performance.getEntriesByType("resource").filter((e) => e.name.includes("tile.plateauview.mlit.go.jp/terrain")).length;
}

async function run(): Promise<unknown> {
  const scene = parseScene(sceneConfig);
  const cfg = parseVehicleConfig(vehicleConfig);
  const courseRaw = await (await fetch(COURSE_URL)).text();
  const course = parseCourse(JSON.parse(courseRaw));
  const track = buildTrack(course.coordinates, course.mode === "circuit");
  const newProvider = () => CesiumTerrainProvider.fromUrl(scene.terrain.url, { requestVertexNormals: scene.terrain.requestVertexNormals });

  // 1. terrain sampling step: cost and interpolation error against 2 m samples
  const steps = [2, 5, 10, 20];
  const ref = { ds: terrainSampleDistances(track, 2), hs: [] as number[] };
  const sampling = [];
  for (const step of steps) {
    const provider = await newProvider();
    const ds = terrainSampleDistances(track, step);
    const before = terrainRequests();
    const t0 = performance.now();
    const hs = await sample(provider, track, ds);
    const ms = performance.now() - t0;
    if (step === 2) ref.hs = hs;
    const errs = ref.ds.map((d, i) => Math.abs(heightAt(track, ds, hs, d) - ref.hs[i]));
    sampling.push({
      step_m: step,
      samples: ds.length,
      ms: Math.round(ms),
      terrain_requests: terrainRequests() - before,
      max_abs_error_vs_2m: round(Math.max(...errs)),
      mean_abs_error_vs_2m: round(errs.reduce((a, b) => a + b, 0) / errs.length),
    });
  }

  // 2. grounding: vehicle height (configured step, interpolated) vs terrain at the same point
  const provider = await newProvider();
  const ds = terrainSampleDistances(track, cfg.terrainStepM);
  const hs = await sample(provider, track, ds);
  const checkD = Array.from({ length: 300 }, (_, i) => ((i + 0.37) * track.length) / 300);
  const exact = await sample(provider, track, checkD);
  const grounding = checkD.map((d, i) => heightAt(track, ds, hs, d) + cfg.groundOffsetM - exact[i]);

  // 3. heading: deviation from the road direction and per-0.5 m change
  let maxFar = 0;
  let maxNear = 0;
  let maxStep = 0;
  let flips = 0;
  let prev = headingAt(track, 0, cfg.headingWindowM);
  for (let d = 0; d < track.length; d += 0.5) {
    const h = headingAt(track, d, cfg.headingWindowM);
    const dev = Math.abs(angleDiff(h, segmentHeadingAt(track, d))) * DEG;
    const near = track.s.some((v) => Math.abs(v - d) < cfg.headingWindowM / 2);
    if (near) maxNear = Math.max(maxNear, dev);
    else maxFar = Math.max(maxFar, dev);
    const step = Math.abs(angleDiff(h, prev)) * DEG;
    maxStep = Math.max(maxStep, step);
    if (step > 90) flips += 1;
    prev = h;
  }

  return {
    checked_utc: new Date().toISOString(),
    tool: "web/tools/vehicle-check.html (npm run dev), src/tools/vehicle-check.ts",
    cesiumjs_version: cesiumPackage.version,
    user_agent: navigator.userAgent,
    course: { url: COURSE_URL, id: course.id, length_m_file: course.lengthM, length_m_track: round(track.length) },
    terrain: { url: scene.terrain.url, config_version: scene.terrain.version },
    settings: {
      terrain_sample_step_m: cfg.terrainStepM,
      heading_window_m: cfg.headingWindowM,
      pitch_window_m: cfg.pitchWindowM,
      base_speed_kmh: round(cfg.baseSpeedMps * 3.6),
      ground_offset_m: cfg.groundOffsetM,
    },
    terrain_sampling: sampling,
    terrain_sampling_note: "Later steps reuse tiles cached by the browser, so ms and requests are only comparable for the first (2 m) run.",
    grounding: {
      criterion: "provisional |vehicle height - terrain| <= 0.3 m",
      stats: Object.fromEntries(Object.entries(heightStats(grounding, 0.3)).map(([k, v]) => [k, round(v)])),
    },
    heading: {
      max_deviation_away_from_vertices_deg: round(maxFar),
      max_deviation_within_half_window_of_vertex_deg: round(maxNear),
      max_change_per_half_metre_deg: round(maxStep),
      reversals: flips,
    },
  };
}

const state = document.getElementById("state") as HTMLParagraphElement;
const out = document.getElementById("out") as HTMLPreElement;
const button = document.getElementById("download") as HTMLButtonElement;
run()
  .then((result) => {
    const text = JSON.stringify(result, null, 1);
    out.textContent = text;
    const g = (result as { grounding: { stats: { n: number; withinThreshold: number } } }).grounding.stats;
    state.textContent = `完了：接地 ${g.withinThreshold}/${g.n} 地点が ±0.3 m 以内`;
    Object.assign(window, { __vehicleCheck: result, __vehicleCheckText: text });
    button.disabled = false;
    button.onclick = () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([text + "\n"], { type: "application/json" }));
      a.download = "vehicle-check.json";
      a.click();
    };
  })
  .catch((e) => {
    state.textContent = `失敗：${e instanceof Error ? e.message : String(e)}`;
  });
