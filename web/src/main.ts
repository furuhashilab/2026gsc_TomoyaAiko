import {
  Cartesian2,
  Cartesian3,
  Cesium3DTileset,
  CesiumTerrainProvider,
  ClassificationType,
  Color,
  Credit,
  Cartographic,
  CustomDataSource,
  EllipsoidTerrainProvider,
  HeightReference,
  ImageryLayer,
  LabelStyle,
  Rectangle,
  type TerrainProvider,
  UrlTemplateImageryProvider,
  VerticalOrigin,
  Viewer,
  sampleTerrainMostDetailed,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import aoiConfig from "../../config/aoi.sapporo.json";
import basemapConfig from "../../config/basemaps.json";
import sceneConfig from "../../config/scene.sapporo.json";
import presentationConfig from "../../config/presentation/sapporo-demo.json";
import vehicleConfig from "../../config/vehicle.json";
import syntheticCourse from "../../contracts/examples/synthetic-loop.course.geojson?raw";
import { parseAoi } from "./aoi";
import { type Basemap, type BuildingStyle, basemapCreditHtml, parseBasemaps, pickBasemap, pickBuildingStyle, tilesetsFor } from "./basemaps";
import { arrowSegments, bearingRad, type Course, parseCourse } from "./course";
import { LatestOnly } from "./latest";
import { Minimap } from "./minimap";
import { parsePresentation } from "./presentation/config";
import { RacePresentation } from "./presentation/layer";
import { parseScene } from "./scene";
import { type CameraMode, VehicleAnimation } from "./vehicle/animation";
import { parseVehicleConfig } from "./vehicle/config";

const aoi = parseAoi(aoiConfig);
const scene = parseScene(sceneConfig);
const params = new URLSearchParams(location.search);
// Generated locally by `uv run cf-course build --recipe ../contracts/examples/sapporo-demo.recipe.json ...`
const DEFAULT_COURSE_URL = "courses/sapporo-demo.course.geojson";

// Base map and building style (Issue #26): options, tile URLs and attribution come from
// config/basemaps.json; ?basemap=<id>&buildingStyle=untextured|textured pick one by URL.
const basemaps = parseBasemaps(basemapConfig);
let basemap = pickBasemap(basemaps, params.get("basemap"));
let buildingStyle = pickBuildingStyle(basemaps, params.get("buildingStyle"));

// No Cesium ion services: ellipsoid terrain and widgets that would call ion are disabled.
const viewer = new Viewer("cesiumContainer", {
  baseLayer: false,
  baseLayerPicker: false,
  geocoder: false,
  animation: false,
  timeline: false,
  sceneModePicker: false,
  navigationHelpButton: false,
});

// GSI tiles need no access token; their credit is attached to the layer, so it is shown
// only while that layer is displayed.
function setBasemap(b: Basemap): void {
  basemap = b;
  viewer.imageryLayers.removeAll();
  viewer.scene.globe.baseColor = Color.fromCssColorString(b.baseColor);
  const credit = basemapCreditHtml(b);
  if (b.url && credit) {
    const provider = new UrlTemplateImageryProvider({ url: b.url, maximumLevel: b.maximumLevel, credit: new Credit(credit, true) });
    viewer.imageryLayers.add(new ImageryLayer(provider));
  }
}
setBasemap(basemap);

// Terrain and buildings (Issue #8). Buildings are only shown on top of the PLATEAU
// terrain: their heights are ellipsoidal, so without terrain they would float ~50 m.
const statusBox = document.getElementById("sceneStatus") as HTMLDivElement;
const status: Record<string, string> = { terrain: "地形：読み込み中…", buildings: "建物：地形の読み込み待ち" };
function setStatus(key: string, text: string): void {
  status[key] = text;
  statusBox.textContent = Object.values(status).join("\n");
}
setStatus("terrain", status.terrain);
const terrainCredit = new Credit(`地形：${scene.terrain.attribution}`, true);
viewer.creditDisplay.addStaticCredit(terrainCredit);

// Building tilesets currently in the scene, by config id.
const tilesets = new Map<string, Cesium3DTileset>();
let sceneDisabled = false;
// Resolves with the PLATEAU terrain once it passed the checks, or null without terrain.
let resolveTerrain: (t: TerrainProvider | null) => void = () => {};
const terrainReady = new Promise<TerrainProvider | null>((r) => (resolveTerrain = r));

// Fall back to map + course only: never leave buildings standing on a missing terrain.
function disableScene(reason: string): void {
  if (sceneDisabled) return;
  sceneDisabled = true;
  for (const t of tilesets.values()) viewer.scene.primitives.remove(t);
  tilesets.clear();
  viewer.terrainProvider = new EllipsoidTerrainProvider();
  viewer.scene.globe.depthTestAgainstTerrain = false;
  viewer.creditDisplay.removeStaticCredit(terrainCredit);
  vehicle.useEllipsoidHeights();
  // the presentation's heights came from the terrain that is now gone
  if (raceToggle.checked) {
    raceToggle.checked = false;
    void refreshRace();
  }
  resolveTerrain(null);
  setStatus("terrain", `地形：読み込み失敗（${reason}）`);
  setStatus("buildings", "建物：地形がないため非表示（地図とコースのみ表示）");
}

// CesiumJS treats a missing layer.json as a legacy heightmap server and keeps going, so
// check the metadata and one sampled height before trusting the provider.
async function loadTerrain(url: string): Promise<string> {
  const res = await fetch(`${url}/layer.json`);
  if (!res.ok) throw new Error(`layer.json HTTP ${res.status}`);
  const layer = (await res.json()) as { format?: string; version?: string };
  if (layer.format !== "quantized-mesh-1.0") throw new Error(`想定外の形式 ${layer.format}`);
  const provider = await CesiumTerrainProvider.fromUrl(url, { requestVertexNormals: scene.terrain.requestVertexNormals });
  const [probe] = await sampleTerrainMostDetailed(provider, [
    Cartographic.fromDegrees((aoi.lonMin + aoi.lonMax) / 2, (aoi.latMin + aoi.latMax) / 2),
  ]);
  if (!Number.isFinite(probe.height)) throw new Error("地形の高さを取得できません");
  provider.errorEvent.addEventListener((err: { message?: string }) => disableScene(`地形タイルの取得エラー：${err.message ?? ""}`));
  viewer.terrainProvider = provider;
  viewer.scene.globe.depthTestAgainstTerrain = true;
  return String(layer.version);
}

async function loadScene(): Promise<void> {
  // ?terrain=off or ?terrainUrl=... let the failure path be checked by hand.
  const terrainUrl = params.get("terrain") === "off" ? null : (params.get("terrainUrl") ?? scene.terrain.url);
  try {
    if (!terrainUrl) throw new Error("無効化されています（?terrain=off）");
    const version = await loadTerrain(terrainUrl);
    const note = version === scene.terrain.version ? "" : `／設定の版 ${scene.terrain.version} と異なるため再検証が必要`;
    setStatus("terrain", `地形：PLATEAU-Terrain（${version}${note}）`);
    resolveTerrain(viewer.terrainProvider);
  } catch (e) {
    disableScene(e instanceof Error ? e.message : String(e));
    return;
  }
  if (params.get("buildings") === "off") {
    setStatus("buildings", "建物：無効化されています（?buildings=off）");
    return;
  }
  // Untextured and textured tilesets share one dataset (same city and year), so one credit.
  viewer.creditDisplay.addStaticCredit(new Credit(`建物：${scene.buildings.attribution}`, true));
  buildingsEnabled = true;
  await showBuildings(buildingStyle);
}

let buildingsEnabled = false;
const buildingLoads = new LatestOnly();
const pending = new Map<string, number>();
// tileset.json requests in flight per id (a superseded request may overlap a newer one)
const fetching = new Map<string, number>();
const failed = new Set<string>();

function refreshBuildingStatus(): void {
  const wanted = tilesetsFor(scene, buildingStyle);
  const ready = wanted.filter((t) => tilesets.has(t.id)).length;
  const tiles = wanted.reduce((a, t) => a + (pending.get(t.id) ?? 0), 0);
  const style = basemaps.buildings.find((b) => b.id === buildingStyle)?.name ?? buildingStyle;
  const bad = wanted.filter((t) => failed.has(t.id)).map((t) => t.id);
  // "complete" only when every wanted tileset is in the scene and no tile is pending
  // a freshly added tileset reports no pending tiles until its first update, so also wait for tilesLoaded
  const loading = tiles > 0 || wanted.some((t) => tilesets.get(t.id)?.tilesLoaded === false);
  const busy = wanted.some((t) => (fetching.get(t.id) ?? 0) > 0) ? "タイルセットを取得中" : loading ? (tiles > 0 ? `読み込み中 ${tiles} タイル` : "読み込み中") : null;
  const parts = [`建物：${style} ${ready}/${wanted.length} タイルセット`, busy ?? (bad.length ? "一部未表示" : "読み込み完了")];
  if (bad.length) {
    parts.push(`失敗 ${bad.join(", ")}`);
    if (buildingStyle === "textured") parts.push("「建物」でテクスチャなしに戻せます");
  }
  setStatus("buildings", parts.join(" / "));
}

// Swap tilesets for a style: a textured tileset replaces its ward's untextured one, so
// the old one is removed before the new one is added and no building is drawn twice.
async function showBuildings(style: BuildingStyle): Promise<void> {
  buildingStyle = style;
  if (!buildingsEnabled || sceneDisabled) return;
  const generation = buildingLoads.begin();
  const wanted = tilesetsFor(scene, style);
  const wantedIds = new Set(wanted.map((t) => t.id));
  for (const [id, t] of tilesets) {
    if (!wantedIds.has(id)) {
      viewer.scene.primitives.remove(t);
      tilesets.delete(id);
      pending.delete(id);
    }
  }
  refreshBuildingStatus();
  await Promise.all(
    wanted
      .filter((t) => !tilesets.has(t.id))
      .map(async (t) => {
        failed.delete(t.id);
        fetching.set(t.id, (fetching.get(t.id) ?? 0) + 1);
        refreshBuildingStatus();
        try {
          const tileset = await Cesium3DTileset.fromUrl(t.url, { maximumScreenSpaceError: 16 }).finally(() => fetching.set(t.id, (fetching.get(t.id) ?? 1) - 1));
          // a newer style was picked, or the terrain failed, while this one was loading
          if (sceneDisabled || !buildingLoads.isCurrent(generation) || tilesets.has(t.id)) {
            tileset.destroy();
            return;
          }
          tileset.loadProgress.addEventListener((requests: number, processing: number) => {
            pending.set(t.id, requests + processing);
            refreshBuildingStatus();
          });
          tileset.allTilesLoaded.addEventListener(refreshBuildingStatus);
          tileset.tileFailed.addEventListener(() => {
            failed.add(t.id);
            refreshBuildingStatus();
          });
          tilesets.set(t.id, viewer.scene.primitives.add(tileset));
        } catch {
          failed.add(t.id);
        }
        refreshBuildingStatus();
      }),
  );
}

const ring = [
  aoi.lonMin, aoi.latMin,
  aoi.lonMax, aoi.latMin,
  aoi.lonMax, aoi.latMax,
  aoi.lonMin, aoi.latMax,
  aoi.lonMin, aoi.latMin,
];
viewer.entities.add({
  name: aoi.name,
  polyline: {
    positions: Cartesian3.fromDegreesArray(ring),
    width: 3,
    material: Color.RED,
    clampToGround: true,
  },
});

// Upward-pointing arrow; billboards rotate it to the travel bearing.
const ARROW_IMAGE = (() => {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  g.beginPath();
  g.moveTo(16, 2);
  g.lineTo(29, 28);
  g.lineTo(16, 21);
  g.lineTo(3, 28);
  g.closePath();
  g.fillStyle = "#ffd400";
  g.strokeStyle = "#000";
  g.lineWidth = 2;
  g.fill();
  g.stroke();
  return c;
})();

const courseLayer = new CustomDataSource("course");
viewer.dataSources.add(courseLayer);
const info = document.getElementById("courseInfo") as HTMLDivElement;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// Vehicle animation (Issue #9): visualises the route; not a physics simulation.
const vehicleCfg = parseVehicleConfig(vehicleConfig);
const vehicle = new VehicleAnimation(viewer, vehicleCfg);
const vehicleInfo = document.getElementById("vehicleInfo") as HTMLDivElement;
const speedSelect = document.getElementById("vehicleSpeed") as HTMLSelectElement;
for (const m of vehicleCfg.multipliers) speedSelect.add(new Option(`${m}×`, String(m), m === 1, m === 1));

// ?vehicleModel=... lets the model-failure fallback be checked by hand.
const vehicleModelUri = params.get("vehicleModel") ?? vehicleCfg.modelUri;

async function loadVehicle(course: Course): Promise<void> {
  vehicleInfo.textContent = "車両：準備中（地形の高さを取得しています）";
  try {
    // false = a newer course was picked meanwhile; its own load updates the panel
    if (await vehicle.load(course, await terrainReady, vehicleModelUri)) {
      vehicle.setMultiplier(Number(speedSelect.value));
    }
  } catch (e) {
    vehicleInfo.textContent = `車両：準備に失敗（${e instanceof Error ? e.message : String(e)}）`;
  }
}

function refreshVehicleInfo(): void {
  const s = vehicle.current();
  if (!s) return;
  const pct = ((s.distance / vehicle.length) * 100).toFixed(0);
  const base = (vehicleCfg.baseSpeedMps * 3.6).toFixed(0);
  const source = vehicle.terrainInfo?.source === "terrain" ? "地形に追従" : "地形なし（楕円体上）";
  const v = vehicle.visual;
  const model =
    v?.kind === "fallback"
      ? `\n車両：簡易形状で表示中（モデルの読み込みに失敗：${v.reason}）`
      : v?.kind === "loading"
        ? "\n車両：モデルを読み込み中"
        : "";
  vehicleInfo.textContent =
    `${s.lap} 周目 / ${(s.distance / 1000).toFixed(2)} km（${pct}%） / ` +
    `再生 ${speedSelect.value}×（基準の表示速度 ${base} km/h 相当） / ${source}${model}`;
}
setInterval(refreshVehicleInfo, 250);

// Minimap: same vehicle state as the 3D model, updated every rendered frame.
const minimap = new Minimap(document.getElementById("minimap") as HTMLDivElement, 200, 200, vehicleCfg.headingWindowM);
let minimapTrack: unknown = null;
viewer.scene.postRender.addEventListener(() => {
  const track = vehicle.currentTrack;
  const s = vehicle.current();
  if (!track || !s) return;
  if (track !== minimapTrack) {
    minimap.setTrack(track);
    minimapTrack = track;
  }
  minimap.update(s.distance, s.lap);
});

document.getElementById("vehiclePlay")?.addEventListener("click", () => vehicle.play());
document.getElementById("vehiclePause")?.addEventListener("click", () => vehicle.pause());
document.getElementById("vehicleReset")?.addEventListener("click", () => vehicle.reset());
speedSelect.addEventListener("change", () => vehicle.setMultiplier(Number(speedSelect.value)));

const basemapSelect = document.getElementById("basemap") as HTMLSelectElement;
for (const b of basemaps.basemaps) basemapSelect.add(new Option(b.name, b.id, false, b.id === basemap.id));
basemapSelect.addEventListener("change", () => setBasemap(pickBasemap(basemaps, basemapSelect.value)));
const buildingSelect = document.getElementById("buildingStyle") as HTMLSelectElement;
for (const b of basemaps.buildings) buildingSelect.add(new Option(b.name, b.id, false, b.id === buildingStyle));
buildingSelect.addEventListener("change", () => void showBuildings(pickBuildingStyle(basemaps, buildingSelect.value)));
document.getElementById("vehicleCamera")?.addEventListener("change", (ev) => {
  vehicle.setCamera((ev.target as HTMLSelectElement).value as CameraMode);
});

// Race presentation (Street Race Visual PoC, Phase 1): fictional road surface, barriers,
// catch fence and sponsor boards on a hand-picked part of a course (config/presentation/).
// Off = the plain GIS view. Kept apart from the GIS layers; it only reads the course.
const presentations = [parsePresentation(presentationConfig)];
const race = new RacePresentation(viewer);
const raceToggle = document.getElementById("racePresentation") as HTMLInputElement;
const raceNotice = document.getElementById("raceNotice") as HTMLDivElement;
let currentCourse: Course | null = null;
raceToggle.checked = params.get("race") === "on";

function setRaceNotice(disclaimer: string | null, line: string): void {
  raceNotice.hidden = false;
  raceNotice.innerHTML = `${disclaimer ? `<b>${escapeHtml(disclaimer)}</b>\n` : ""}${escapeHtml(line)}`;
}

async function refreshRace(): Promise<void> {
  const course = currentCourse;
  const cfg = course ? presentations.find((p) => p.courseId === course.id) : undefined;
  if (!raceToggle.checked || !course || !cfg) {
    race.hide();
    vehicle.setGroundLift(0);
    raceNotice.hidden = true;
    if (raceToggle.checked && course) setRaceNotice(null, "レース演出：このコースには演出の設定がありません（config/presentation/）");
    return;
  }
  setRaceNotice(cfg.disclaimer, "レース演出：準備中（地形の高さを取得しています）");
  try {
    const terrain = await terrainReady;
    // toggled off or another course picked while waiting
    if (!raceToggle.checked || currentCourse !== course) return;
    if (!(await race.show(course, cfg, terrain))) return;
  } catch (e) {
    setRaceNotice(cfg.disclaimer, `レース演出：表示に失敗（${e instanceof Error ? e.message : String(e)}）`);
    return;
  }
  vehicle.setGroundLift(cfg.road.liftM);
  const { fromS, toS, widthM } = cfg.road;
  setRaceNotice(cfg.disclaimer, `レース演出：s = ${fromS}–${toS} m の約 ${toS - fromS} m のみ／路面の幅 ${widthM} m は表示用の仮の値`);
}
raceToggle.addEventListener("change", () => void refreshRace());

function showCourse(course: Course, source: string, note = ""): void {
  void loadVehicle(course);
  currentCourse = course;
  void refreshRace();
  courseLayer.entities.removeAll();
  const positions = course.coordinates.map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat));
  // Everything is draped on the terrain (not on building roofs). A wider dark line under
  // the orange one acts as an outline against the light base map.
  courseLayer.entities.add({
    polyline: {
      positions,
      width: 14,
      material: Color.fromCssColorString("#1b1f24").withAlpha(0.75),
      clampToGround: true,
      classificationType: ClassificationType.TERRAIN,
      zIndex: 0,
    },
  });
  courseLayer.entities.add({
    name: course.name,
    polyline: {
      positions,
      width: 8,
      material: Color.fromCssColorString("#ff7a00"),
      clampToGround: true,
      classificationType: ClassificationType.TERRAIN,
      zIndex: 1,
    },
  });
  // Direction arrows roughly every 250 m: ground-clamped billboards rotated to the travel
  // bearing (arrow materials are not drawn on ground-clamped polylines).
  for (const i of arrowSegments(course.coordinates, 250)) {
    const [a, b] = [course.coordinates[i], course.coordinates[i + 1]];
    courseLayer.entities.add({
      position: Cartesian3.fromDegrees((a[0] + b[0]) / 2, (a[1] + b[1]) / 2),
      billboard: {
        image: ARROW_IMAGE,
        width: 22,
        height: 22,
        rotation: -bearingRad(a, b),
        alignedAxis: Cartesian3.UNIT_Z,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }
  const [lon0, lat0] = course.coordinates[0];
  courseLayer.entities.add({
    position: Cartesian3.fromDegrees(lon0, lat0),
    point: {
      pixelSize: 12,
      color: Color.WHITE,
      outlineColor: Color.BLACK,
      outlineWidth: 2,
      heightReference: HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    label: {
      heightReference: HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      text: course.mode === "circuit" ? "START / FINISH" : "START",
      font: "bold 14px system-ui",
      style: LabelStyle.FILL_AND_OUTLINE,
      outlineWidth: 3,
      verticalOrigin: VerticalOrigin.BOTTOM,
      pixelOffset: new Cartesian2(0, -12),
    },
  });

  const lons = course.coordinates.map((c) => c[0]);
  const lats = course.coordinates.map((c) => c[1]);
  const pad = 0.002;
  viewer.camera.flyTo({
    destination: Rectangle.fromDegrees(Math.min(...lons) - pad, Math.min(...lats) - pad, Math.max(...lons) + pad, Math.max(...lats) + pad),
    duration: 0,
  });

  const v = course.validation;
  const status = v
    ? `<span class="${v.status === "valid" ? "ok" : "ng"}">${v.status}</span>（エラー ${v.errors.length} / 警告 ${v.warnings.length}）`
    : "検証結果なし";
  const issues = v ? [...v.errors, ...v.warnings].map((i) => `<li>${escapeHtml(i.code)}</li>`).join("") : "";
  info.innerHTML = `
    <h2>${escapeHtml(course.name)}</h2>
    ${course.synthetic ? "<div><b>合成テストデータ（実在の道路ではありません）</b></div>" : ""}
    <div>${course.mode === "circuit" ? "周回" : "ラリー"} / ${(course.lengthM / 1000).toFixed(2)} km / ${course.segments.length} 区間</div>
    <div>ファイル内の検証結果（参考）：${status}</div>
    ${issues ? `<ul>${issues}</ul>` : ""}
    <small>${escapeHtml(course.attribution)}<br />${escapeHtml(source)}${note ? `<br />${escapeHtml(note)}` : ""}</small>`;
}

function showError(message: string): void {
  courseLayer.entities.removeAll();
  info.innerHTML = `<span class="ng">${escapeHtml(message)}</span>`;
}

// Course sources (initial URL, file picker) can overlap; only the latest one is shown.
const courseLoads = new LatestOnly();

async function loadInitialCourse(): Promise<void> {
  const url = params.get("course") ?? DEFAULT_COURSE_URL;
  await courseLoads.run(
    async () => {
      try {
        const res = await fetch(url);
        // The dev server answers unknown paths with index.html, so check the content type too.
        if (!res.ok || !/json/.test(res.headers.get("content-type") ?? "")) {
          throw new Error(res.ok ? "ファイルが見つかりません" : `ファイルが見つかりません（HTTP ${res.status}）`);
        }
        return { course: parseCourse(await res.json()), source: url, note: "" };
      } catch (e) {
        return {
          course: parseCourse(JSON.parse(syntheticCourse)),
          source: "contracts/examples/synthetic-loop.course.geojson",
          note: `${url} を読み込めなかったため合成サンプルを表示しています（${e instanceof Error ? e.message : String(e)}）。`,
        };
      }
    },
    (r) => showCourse(r.course, r.source, r.note),
  );
}

document.getElementById("courseFile")?.addEventListener("change", async (ev) => {
  const file = (ev.target as HTMLInputElement).files?.[0];
  if (!file) return;
  await courseLoads.run(
    async () => {
      try {
        return { course: parseCourse(JSON.parse(await file.text())), source: file.name, error: "" };
      } catch (e) {
        return { course: null, source: file.name, error: e instanceof Error ? e.message : String(e) };
      }
    },
    (r) => (r.course ? showCourse(r.course, r.source) : showError(r.error)),
  );
});

void loadInitialCourse();
void loadScene();

// Dev builds only: expose the viewer for manual checks in the browser console.
if (import.meta.env.DEV) (window as unknown as { __cf: unknown }).__cf = { viewer, scene, status, vehicle, vehicleCfg, basemaps, setBasemap, showBuildings, tilesets, race };
