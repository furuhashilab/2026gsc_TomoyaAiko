// Dev page for the video export PoC (tools/video-export.html).
// HTML here is only the control panel; everything in the video is drawn on canvases.
import "@fontsource/noto-sans-jp/400.css";
import "@fontsource/noto-sans-jp/700.css";
import "cesium/Build/Cesium/Widgets/widgets.css";
import syntheticRaw from "../../../contracts/examples/synthetic-loop.course.geojson?raw";
import { parseCourse } from "../course";
import { exportVideo } from "../video/exporter";
import { parseTimeline } from "../video/timeline";

const timelineFiles = import.meta.glob("../../../config/video/*.json", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const timelines = Object.fromEntries(
  Object.values(timelineFiles).map((text) => {
    const tl = parseTimeline(JSON.parse(text));
    return [tl.id, { tl, text }];
  }),
);
// Only the synthetic sample for now: OSM-derived courses wait for the #12 publication policy.
const courses = { synthetic: syntheticRaw };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const timelineSelect = $<HTMLSelectElement>("timeline");
for (const id of Object.keys(timelines).sort()) timelineSelect.add(new Option(id, id));
const state = $<HTMLParagraphElement>("state");
const preview = $<HTMLCanvasElement>("preview").getContext("2d") as CanvasRenderingContext2D;
const result = $<HTMLPreElement>("result");

function link(id: string, blob: Blob, name: string): void {
  const a = $<HTMLAnchorElement>(id);
  if (a.href) URL.revokeObjectURL(a.href);
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.hidden = false;
}

// Dev server only: write the files to web/out/video/ (see vite.config.ts).
async function saveToDisk(name: string, body: Blob): Promise<string | null> {
  if (!import.meta.env.DEV) return null;
  const res = await fetch(`/__video-out?name=${encodeURIComponent(name)}`, { method: "POST", body });
  if (!res.ok) throw new Error(`保存に失敗しました（HTTP ${res.status}）`);
  return ((await res.json()) as { path: string }).path;
}

async function run(timelineId: string, courseId: keyof typeof courses = "synthetic"): Promise<Record<string, unknown>> {
  const entry = timelines[timelineId];
  if (!entry) throw new Error(`映像の構成 ${timelineId} がありません`);
  const courseText = courses[courseId];
  const course = parseCourse(JSON.parse(courseText));
  state.className = "";
  state.textContent = "書き出し中…";
  const { webm, record } = await exportVideo({
    container: $("cesiumContainer"),
    course,
    courseText,
    timeline: entry.tl,
    timelineText: entry.text,
    onProgress: (i, n, composite) => {
      if (i % 5 === 0 || i === n) {
        preview.drawImage(composite, 0, 0, 640, 360);
        state.textContent = `書き出し中… ${i} / ${n} フレーム`;
      }
    },
  });
  const base = `${entry.tl.id}-${course.id}`;
  const webmBlob = new Blob([webm], { type: "video/webm" });
  const recordBlob = new Blob([JSON.stringify(record, null, 2) + "\n"], { type: "application/json" });
  link("download", webmBlob, `${base}.webm`);
  link("downloadRecord", recordBlob, `${base}.json`);
  const saved = [await saveToDisk(`${base}.webm`, webmBlob), await saveToDisk(`${base}.json`, recordBlob)].filter(Boolean);
  record.savedTo = saved;
  result.textContent = JSON.stringify(record, null, 2);
  state.textContent = `完了：${(webm.byteLength / 1e6).toFixed(1)} MB${saved.length ? `（${saved.join("、")} に保存）` : ""}`;
  return record;
}

$<HTMLButtonElement>("run").addEventListener("click", async () => {
  const button = $<HTMLButtonElement>("run");
  button.disabled = true;
  try {
    await run(timelineSelect.value);
  } catch (e) {
    state.className = "error";
    state.textContent = `失敗：${e instanceof Error ? e.message : String(e)}`;
  } finally {
    button.disabled = false;
  }
});

// For scripted checks (e.g. from the browser console or an automation tool).
(window as unknown as { __videoExport: unknown }).__videoExport = { run, timelines: Object.keys(timelines) };
