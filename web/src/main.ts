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
import sceneConfig from "../../config/scene.sapporo.json";
import vehicleConfig from "../../config/vehicle.json";
import syntheticCourse from "../../contracts/examples/synthetic-loop.course.geojson?raw";
import { parseAoi } from "./aoi";
import { arrowSegments, bearingRad, type Course, parseCourse } from "./course";
import { LatestOnly } from "./latest";
import { parseScene } from "./scene";
import { type CameraMode, VehicleAnimation } from "./vehicle/animation";
import { parseVehicleConfig } from "./vehicle/config";

const aoi = parseAoi(aoiConfig);
const scene = parseScene(sceneConfig);
const params = new URLSearchParams(location.search);
// Generated locally by `uv run cf-course build --recipe ../contracts/examples/sapporo-demo.recipe.json ...`
const DEFAULT_COURSE_URL = "courses/sapporo-demo.course.geojson";

// GSI standard map tiles: no access token needed; attribution is required.
const gsiStandard = new UrlTemplateImageryProvider({
  url: "https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png",
  maximumLevel: 18,
  credit: new Credit(
    '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>',
    true,
  ),
});

// No Cesium ion services: ellipsoid terrain and widgets that would call ion are disabled.
const viewer = new Viewer("cesiumContainer", {
  baseLayer: new ImageryLayer(gsiStandard),
  baseLayerPicker: false,
  geocoder: false,
  animation: false,
  timeline: false,
  sceneModePicker: false,
  navigationHelpButton: false,
});

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

const tilesets: Cesium3DTileset[] = [];
let sceneDisabled = false;
// Resolves with the PLATEAU terrain once it passed the checks, or null without terrain.
let resolveTerrain: (t: TerrainProvider | null) => void = () => {};
const terrainReady = new Promise<TerrainProvider | null>((r) => (resolveTerrain = r));

// Fall back to map + course only: never leave buildings standing on a missing terrain.
function disableScene(reason: string): void {
  if (sceneDisabled) return;
  sceneDisabled = true;
  for (const t of tilesets.splice(0)) viewer.scene.primitives.remove(t);
  viewer.terrainProvider = new EllipsoidTerrainProvider();
  viewer.scene.globe.depthTestAgainstTerrain = false;
  viewer.creditDisplay.removeStaticCredit(terrainCredit);
  vehicle.useEllipsoidHeights();
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
  viewer.creditDisplay.addStaticCredit(new Credit(`建物：${scene.buildings.attribution}`, true));
  const total = scene.buildings.tilesets.length;
  const pending = new Map<string, number>();
  let ready = 0;
  const failed: string[] = [];
  const refresh = () => {
    const tiles = [...pending.values()].reduce((a, b) => a + b, 0);
    const parts = [`建物：${ready}/${total} タイルセット`, tiles > 0 ? `読み込み中 ${tiles} タイル` : "読み込み完了"];
    if (failed.length) parts.push(`失敗 ${failed.join(", ")}`);
    setStatus("buildings", parts.join(" / "));
  };
  await Promise.all(
    scene.buildings.tilesets.map(async (t) => {
      try {
        const tileset = await Cesium3DTileset.fromUrl(t.url, { maximumScreenSpaceError: 16 });
        tileset.loadProgress.addEventListener((requests: number, processing: number) => {
          pending.set(t.id, requests + processing);
          refresh();
        });
        tileset.tileFailed.addEventListener(() => {
          if (!failed.includes(t.id)) failed.push(t.id);
          refresh();
        });
        if (sceneDisabled) return;
        tilesets.push(viewer.scene.primitives.add(tileset));
        ready += 1;
      } catch {
        failed.push(t.id);
      }
      refresh();
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

document.getElementById("vehiclePlay")?.addEventListener("click", () => vehicle.play());
document.getElementById("vehiclePause")?.addEventListener("click", () => vehicle.pause());
document.getElementById("vehicleReset")?.addEventListener("click", () => vehicle.reset());
speedSelect.addEventListener("change", () => vehicle.setMultiplier(Number(speedSelect.value)));
document.getElementById("vehicleCamera")?.addEventListener("change", (ev) => {
  vehicle.setCamera((ev.target as HTMLSelectElement).value as CameraMode);
});

function showCourse(course: Course, source: string, note = ""): void {
  void loadVehicle(course);
  courseLayer.entities.removeAll();
  const positions = course.coordinates.map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat));
  // Everything is draped on the terrain (not on building roofs).
  courseLayer.entities.add({
    name: course.name,
    polyline: {
      positions,
      width: 6,
      material: Color.fromCssColorString("#ff7a00"),
      clampToGround: true,
      classificationType: ClassificationType.TERRAIN,
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
if (import.meta.env.DEV) (window as unknown as { __cf: unknown }).__cf = { viewer, scene, status, vehicle, vehicleCfg };
