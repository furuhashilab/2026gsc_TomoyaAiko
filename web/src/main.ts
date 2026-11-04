import {
  Cartesian2,
  Cartesian3,
  Color,
  Credit,
  CustomDataSource,
  ImageryLayer,
  LabelStyle,
  PolylineArrowMaterialProperty,
  Rectangle,
  UrlTemplateImageryProvider,
  VerticalOrigin,
  Viewer,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import aoiConfig from "../../config/aoi.sapporo.json";
import syntheticCourse from "../../contracts/examples/synthetic-loop.course.geojson?raw";
import { parseAoi } from "./aoi";
import { arrowSegments, type Course, parseCourse } from "./course";

const aoi = parseAoi(aoiConfig);
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

const courseLayer = new CustomDataSource("course");
viewer.dataSources.add(courseLayer);
const info = document.getElementById("courseInfo") as HTMLDivElement;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function showCourse(course: Course, source: string, note = ""): void {
  courseLayer.entities.removeAll();
  const positions = course.coordinates.map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat));
  courseLayer.entities.add({
    name: course.name,
    polyline: { positions, width: 6, material: Color.fromCssColorString("#ff7a00"), clampToGround: true },
  });
  // Direction arrows roughly every 250 m (ellipsoid terrain, so a small height is enough).
  for (const i of arrowSegments(course.coordinates, 250)) {
    const [a, b] = [course.coordinates[i], course.coordinates[i + 1]];
    courseLayer.entities.add({
      polyline: {
        positions: Cartesian3.fromDegreesArrayHeights([a[0], a[1], 2, b[0], b[1], 2]),
        width: 18,
        material: new PolylineArrowMaterialProperty(Color.fromCssColorString("#ffd400")),
      },
    });
  }
  const [lon0, lat0] = course.coordinates[0];
  courseLayer.entities.add({
    position: Cartesian3.fromDegrees(lon0, lat0, 2),
    point: { pixelSize: 12, color: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 2 },
    label: {
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

async function loadInitialCourse(): Promise<void> {
  const url = new URLSearchParams(location.search).get("course") ?? DEFAULT_COURSE_URL;
  try {
    const res = await fetch(url);
    // The dev server answers unknown paths with index.html, so check the content type too.
    if (!res.ok || !/json/.test(res.headers.get("content-type") ?? "")) {
      throw new Error(res.ok ? "ファイルが見つかりません" : `ファイルが見つかりません（HTTP ${res.status}）`);
    }
    showCourse(parseCourse(await res.json()), url);
  } catch (e) {
    showCourse(
      parseCourse(JSON.parse(syntheticCourse)),
      "contracts/examples/synthetic-loop.course.geojson",
      `${url} を読み込めなかったため合成サンプルを表示しています（${e instanceof Error ? e.message : String(e)}）。`,
    );
  }
}

document.getElementById("courseFile")?.addEventListener("change", async (ev) => {
  const file = (ev.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    showCourse(parseCourse(JSON.parse(await file.text())), file.name);
  } catch (e) {
    showError(e instanceof Error ? e.message : String(e));
  }
});

void loadInitialCourse();
