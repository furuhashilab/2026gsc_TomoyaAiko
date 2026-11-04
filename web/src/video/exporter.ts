// Frame-by-frame WebM export of a course introduction (WebCodecs via Mediabunny).
//
// For frame i: t = i / fps -> timeline state -> place the camera and the drawn course ->
// render until the globe tiles are loaded -> copy the WebGL canvas onto a 2D composite
// canvas -> draw the 2D overlays -> CanvasSource.add(t). Wall-clock speed never affects
// the result; `await source.add()` applies the encoder's backpressure.
import {
  Cartesian3,
  CesiumWidget,
  Color,
  EllipsoidTerrainProvider,
  HeadingPitchRange,
  JulianDate,
  Material,
  Math as CesiumMath,
  Matrix4,
  PolylineCollection,
  SceneTransforms,
} from "cesium";
import {
  BufferSource,
  BufferTarget,
  CanvasSource,
  Input,
  Output,
  WEBM,
  WebMOutputFormat,
  getFirstEncodableVideoCodec,
  type VideoCodec,
} from "mediabunny";
import packageJson from "../../package.json";
import type { Course } from "../course";
import { type LonLat, courseFrame, partialCourse } from "./geometry";
import { type CourseInfo, drawOverlays, statLines } from "./overlay";
import { type CameraPose, type Timeline, evaluate, frameCount } from "./timeline";

const CESIUM_VERSION = packageJson.dependencies.cesium;
export const FONT_FAMILY = '"Noto Sans JP"';
const FONT_LICENCE = "フォント：Noto Sans JP（SIL Open Font License 1.1）";
const SOFTWARE_CREDIT = `CesiumJS ${CESIUM_VERSION}（Apache-2.0）`;
// Fixed scene time so sun and atmosphere look the same on every run (03:00 UTC = noon JST).
const SCENE_TIME = JulianDate.fromIso8601("2026-06-21T03:00:00Z");
// Heights (m) above the ellipsoid. The lines are stacked instead of sharing one height,
// because translucent polylines are drawn after opaque ones and would cover them.
const GHOST_HEIGHT_M = 0.5;
const UNDER_HEIGHT_M = 1;
const LINE_HEIGHT_M = 2.5;
const MAX_SETTLE_ITERATIONS = 600;

export interface ExportOptions {
  container: HTMLElement;
  course: Course;
  courseText: string;
  timeline: Timeline;
  timelineText: string;
  onProgress?: (frame: number, total: number, composite: HTMLCanvasElement) => void;
}

export interface Verification {
  width: number;
  height: number;
  durationS: number;
  packetCount: number;
  averageFps: number;
  codec: string | null;
  /** The browser's own <video> element could load the file and seek to its last frame. */
  playableToEnd: boolean;
  videoElementDurationS: number;
}

export interface ExportResult {
  webm: ArrayBuffer;
  record: Record<string, unknown>;
}

const sleep = () => new Promise<void>((r) => setTimeout(r, 0));

async function sha256(data: ArrayBuffer | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function courseInfo(course: Course): CourseInfo {
  return {
    name: course.name,
    lengthM: course.lengthM,
    mode: course.mode,
    segments: course.segments.length,
    attribution: course.attribution,
    synthetic: course.synthetic,
  };
}

/** Loads the bundled font for every string drawn, so text never falls back to a system font. */
async function loadFonts(texts: string[]): Promise<void> {
  const sample = texts.join("");
  await Promise.all([400, 700].map((w) => document.fonts.load(`${w} 32px ${FONT_FAMILY}`, sample)));
  for (const w of [400, 700]) {
    if (!document.fonts.check(`${w} 32px ${FONT_FAMILY}`, sample)) throw new Error(`フォント ${FONT_FAMILY}（${w}）を読み込めません`);
  }
}

function makeWidget(container: HTMLElement, width: number, height: number): CesiumWidget {
  // Drawing buffer = CSS size x devicePixelRatio x resolutionScale; pin it to the video size.
  container.style.width = `${width}px`;
  container.style.height = `${height}px`;
  const widget = new CesiumWidget(container, {
    baseLayer: false,
    terrainProvider: new EllipsoidTerrainProvider(),
    useDefaultRenderLoop: false,
    useBrowserRecommendedResolution: false,
    shouldAnimate: false,
    creditContainer: document.createElement("div"),
    contextOptions: { webgl: { alpha: false, preserveDrawingBuffer: true } },
  });
  widget.resolutionScale = 1 / window.devicePixelRatio;
  widget.resize();
  widget.clock.currentTime = SCENE_TIME.clone();
  const { scene } = widget;
  scene.globe.baseColor = Color.fromCssColorString("#3a3f45");
  scene.globe.showGroundAtmosphere = false;
  scene.fog.enabled = false;
  if (widget.canvas.width !== width || widget.canvas.height !== height) {
    widget.destroy();
    throw new Error(`描画サイズが ${widget.canvas.width}×${widget.canvas.height} になり、指定の ${width}×${height} と一致しません`);
  }
  return widget;
}

function placeCamera(widget: CesiumWidget, centre: Cartesian3, radiusM: number, pose: CameraPose): void {
  const range = Math.max(pose.rangeK * radiusM, 60);
  widget.camera.lookAt(centre, new HeadingPitchRange(CesiumMath.toRadians(pose.heading), CesiumMath.toRadians(pose.pitch), range));
  widget.camera.lookAtTransform(Matrix4.IDENTITY);
}

/** Renders until the globe reports all tiles loaded; returns the number of renders. */
async function settle(widget: CesiumWidget): Promise<number> {
  for (let n = 1; n <= MAX_SETTLE_ITERATIONS; n++) {
    widget.render();
    if (n >= 2 && widget.scene.globe.tilesLoaded) return n;
    await sleep();
  }
  throw new Error(`タイルの読み込みが ${MAX_SETTLE_ITERATIONS} 回の描画で終わりませんでした`);
}

export async function verifyWebm(webm: ArrayBuffer, fps: number): Promise<Verification> {
  const input = new Input({ source: new BufferSource(webm), formats: [WEBM] });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error("書き出したファイルに映像トラックがありません");
  const durationS = await input.computeDuration();
  const stats = await track.computePacketStats(Number.MAX_SAFE_INTEGER);
  // Independent check with the browser's own player: load, then seek to the last frame.
  const url = URL.createObjectURL(new Blob([webm], { type: "video/webm" }));
  const video = document.createElement("video");
  video.muted = true;
  let playableToEnd: boolean;
  let videoElementDurationS: number;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("<video> がファイルを読み込めません"));
      video.src = url;
    });
    videoElementDurationS = video.duration;
    await new Promise<void>((resolve, reject) => {
      video.onseeked = () => resolve();
      video.onerror = () => reject(new Error("<video> が最後のフレームへ移動できません"));
      video.currentTime = Math.max(0, durationS - 0.5 / fps);
    });
    playableToEnd = video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
  } finally {
    video.removeAttribute("src");
    URL.revokeObjectURL(url);
  }
  return {
    width: track.displayWidth,
    height: track.displayHeight,
    durationS,
    packetCount: stats.packetCount,
    averageFps: stats.averagePacketRate,
    codec: track.codec,
    playableToEnd,
    videoElementDurationS,
  };
}

export async function exportVideo(opts: ExportOptions): Promise<ExportResult> {
  const { timeline: tl, course } = opts;
  const started = performance.now();
  const codec = await getFirstEncodableVideoCodec(tl.codecs as VideoCodec[], { width: tl.width, height: tl.height, bitrate: tl.bitrate, frameRate: tl.fps });
  if (!codec) throw new Error(`このブラウザは ${tl.codecs.join(" / ")} を ${tl.width}×${tl.height} でエンコードできません（Chrome などの WebCodecs 対応ブラウザが必要です）`);

  const info = courseInfo(course);
  const credits = [SOFTWARE_CREDIT, FONT_LICENCE, "地図・建物・地形：使用していません（単色の地面）"];
  await loadFonts([info.name, info.attribution, ...statLines(info), ...credits, "出典・クレジット START / FINISH 架空ルートの可視化です。公道走行の提案ではありません。コース：｜"]);

  const coords = course.coordinates as LonLat[];
  const frame = courseFrame(coords);
  const centre = Cartesian3.fromDegrees(frame.centre[0], frame.centre[1], 0);
  const toWorld = (p: LonLat[], h = LINE_HEIGHT_M) => p.map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat, h));
  const k = tl.height / 1080;

  const widget = makeWidget(opts.container, tl.width, tl.height);
  const composite = document.createElement("canvas");
  composite.width = tl.width;
  composite.height = tl.height;
  const ctx = composite.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("2D canvas を作成できません");

  const lines = widget.scene.primitives.add(new PolylineCollection()) as PolylineCollection;
  const colour = (css: string, a = 1) => Material.fromType("Color", { color: Color.fromCssColorString(css).withAlpha(a) });
  lines.add({ positions: toWorld(coords, GHOST_HEIGHT_M), width: 6 * k, material: colour("#c9d1d9", 0.35) }); // whole layout, faint
  const under = lines.add({ positions: toWorld(coords.slice(0, 2), UNDER_HEIGHT_M), width: 18 * k, material: colour("#111418") });
  const line = lines.add({ positions: toWorld(coords.slice(0, 2)), width: 10 * k, material: colour("#ff7a00") });
  const startFinish = Cartesian3.fromDegrees(coords[0][0], coords[0][1], LINE_HEIGHT_M);

  const output = new Output({ format: new WebMOutputFormat(), target: new BufferTarget() });
  const source = new CanvasSource(composite, { codec, bitrate: tl.bitrate, keyFrameInterval: 2 });
  output.addVideoTrack(source, { frameRate: tl.fps });
  const total = frameCount(tl);
  let maxSettle = 0;
  let settleSum = 0;
  try {
    await output.start();
    for (let i = 0; i < total; i++) {
      const state = evaluate(tl, i / tl.fps);
      const drawn = partialCourse(coords, frame, state.drawn);
      const show = drawn.length >= 2 && state.drawn > 0;
      under.show = line.show = show;
      if (show) {
        under.positions = toWorld(drawn, UNDER_HEIGHT_M);
        line.positions = toWorld(drawn);
      }
      placeCamera(widget, centre, frame.radiusM, state.camera);
      const n = await settle(widget);
      maxSettle = Math.max(maxSettle, n);
      settleSum += n;
      // Copy right after the last render, before anything else can touch the canvas.
      ctx.drawImage(widget.canvas, 0, 0, tl.width, tl.height);
      const sf = SceneTransforms.worldToDrawingBufferCoordinates(widget.scene, startFinish);
      drawOverlays({ ctx, width: tl.width, height: tl.height, font: FONT_FAMILY, info, startFinish: sf ? [sf.x, sf.y] : null, credits }, state);
      await source.add(i / tl.fps, 1 / tl.fps);
      opts.onProgress?.(i + 1, total, composite);
    }
    source.close();
    await output.finalize();
  } catch (e) {
    await output.cancel();
    throw e;
  } finally {
    widget.destroy();
  }
  const webm = (output.target as BufferTarget).buffer;
  if (!webm) throw new Error("ファイルが確定されませんでした");
  const encodeSeconds = (performance.now() - started) / 1000;

  const verification = await verifyWebm(webm, tl.fps);
  const record = {
    tool: "circuitforge-web video-export PoC",
    generatedAt: new Date().toISOString(),
    course: { id: course.id, name: course.name, lengthM: course.lengthM, mode: course.mode, segments: course.segments.length, synthetic: course.synthetic, sha256: await sha256(opts.courseText) },
    timeline: { id: tl.id, sha256: await sha256(opts.timelineText), definition: tl },
    encoding: { container: "webm", codec, bitrate: tl.bitrate, keyFrameIntervalS: 2, width: tl.width, height: tl.height, fps: tl.fps, frames: total },
    rendering: { cesium: CESIUM_VERSION, sceneTime: JulianDate.toIso8601(SCENE_TIME), externalData: "none", maxRendersPerFrame: maxSettle, meanRendersPerFrame: settleSum / total, devicePixelRatio: window.devicePixelRatio },
    environment: { userAgent: navigator.userAgent },
    output: { bytes: webm.byteLength, sha256: await sha256(webm), encodeSeconds },
    verification,
    credits: [`コース：${info.attribution}`, ...credits],
  };
  return { webm, record };
}
