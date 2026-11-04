// 2D graphics burned into the video (drawn on the composite canvas, not HTML).
//
// Every value shown comes from the course file. Overlays are looked up by name from the
// timeline, so later additions (sector cards, tyre cards) only need a new entry here.
import type { FrameState, OverlayState } from "./timeline";

export interface CourseInfo {
  name: string;
  lengthM: number;
  mode: "circuit" | "rally";
  segments: number;
  attribution: string;
  synthetic: boolean;
}

export interface OverlayContext {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  font: string;
  info: CourseInfo;
  /** Start/finish on screen (pixels), or null when off-screen. */
  startFinish: [number, number] | null;
  /** Fixed credit lines (software, fonts) appended to the course attribution. */
  credits: string[];
}

export const DISCLAIMER = "架空ルートの可視化です。公道走行の提案ではありません。";

export function lengthLabel(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

export function statLines(info: CourseInfo): string[] {
  return [
    `全長 ${lengthLabel(info.lengthM)}`,
    info.mode === "circuit" ? "周回コース" : "ラリー（一方向）",
    `${info.segments} 区間`,
    info.synthetic ? "合成データ（OSM 由来ではない）" : "OSM の道路から作成した架空のコース",
  ];
}

/** Largest font size (px) <= max that fits the text into maxWidth. */
function fitFont(o: OverlayContext, text: string, weight: number, max: number, maxWidth: number): number {
  let size = max;
  o.ctx.font = `${weight} ${size}px ${o.font}`;
  while (size > 10 && o.ctx.measureText(text).width > maxWidth) {
    size -= 2;
    o.ctx.font = `${weight} ${size}px ${o.font}`;
  }
  return size;
}

type Renderer = (o: OverlayContext, s: OverlayState, k: number) => void;

const ACCENT = "#ff7a00";

const renderers: Record<string, Renderer> = {
  title(o, s, k) {
    const { ctx } = o;
    const slide = (1 - Math.min(1, s.u * 4)) * 60 * k;
    const x = 80 * k - slide;
    const y = o.height - 250 * k;
    ctx.fillStyle = "rgba(10,12,16,0.78)";
    ctx.fillRect(x - 24 * k, y - 78 * k, o.width * 0.62, 112 * k);
    ctx.fillStyle = ACCENT;
    ctx.fillRect(x - 24 * k, y - 78 * k, 10 * k, 112 * k);
    ctx.fillStyle = "#fff";
    fitFont(o, o.info.name, 700, 56 * k, o.width * 0.62 - 48 * k);
    ctx.fillText(o.info.name, x, y);
  },
  stats(o, s, k) {
    const { ctx } = o;
    const lines = statLines(o.info);
    const x = 80 * k;
    const y = o.height - 112 * k;
    ctx.fillStyle = "rgba(10,12,16,0.7)";
    ctx.fillRect(x - 24 * k, y - 46 * k, o.width * 0.62, 68 * k);
    ctx.font = `400 ${30 * k}px ${o.font}`;
    let cx = x;
    lines.forEach((line, i) => {
      // reveal one item after another, left to right
      if (s.u * lines.length * 1.5 < i) return;
      ctx.fillStyle = i === 0 ? ACCENT : "#e8ecf0";
      ctx.fillText(line, cx, y);
      cx += ctx.measureText(line).width + 40 * k;
    });
  },
  startFinish(o, _s, k) {
    if (!o.startFinish) return;
    const [x, y] = o.startFinish;
    const { ctx } = o;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 3 * k;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - 70 * k);
    ctx.stroke();
    ctx.font = `700 ${26 * k}px ${o.font}`;
    const label = "START / FINISH";
    const w = ctx.measureText(label).width;
    ctx.fillStyle = "rgba(10,12,16,0.85)";
    ctx.fillRect(x - w / 2 - 12 * k, y - 112 * k, w + 24 * k, 44 * k);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, x - w / 2, y - 80 * k);
  },
  credits(o, _s, k) {
    // compact bottom-right panel, so the final overview of the course stays visible
    const { ctx } = o;
    const lines = [`コース：${o.info.attribution}`, ...o.credits, DISCLAIMER];
    const x0 = o.width * 0.6;
    const y0 = o.height - (120 + lines.length * 44 + 60) * k;
    ctx.fillStyle = "rgba(10,12,16,0.85)";
    ctx.fillRect(x0, y0, o.width - x0 - 32 * k, o.height - y0 - 64 * k);
    const x = x0 + 32 * k;
    const maxWidth = o.width - x - 64 * k;
    ctx.fillStyle = "#fff";
    ctx.font = `700 ${34 * k}px ${o.font}`;
    ctx.fillText("出典・クレジット", x, y0 + 60 * k);
    lines.forEach((line, i) => {
      fitFont(o, line, 400, 24 * k, maxWidth);
      ctx.fillText(line, x, y0 + (112 + i * 44) * k);
    });
  },
};

export const OVERLAY_NAMES = Object.keys(renderers);

/** Draws the overlays of one frame plus the always-on disclaimer and credit line. */
export function drawOverlays(o: OverlayContext, state: FrameState): void {
  const k = o.height / 1080;
  const { ctx } = o;
  ctx.save();
  ctx.textBaseline = "alphabetic";
  for (const s of state.overlays) {
    const r = renderers[s.name];
    if (!r) throw new Error(`unknown overlay "${s.name}"`);
    ctx.save();
    ctx.globalAlpha = s.alpha;
    r(o, s, k);
    ctx.restore();
  }
  // always-on footer: fictional-route notice and attribution
  ctx.font = `400 ${20 * k}px ${o.font}`;
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillText(DISCLAIMER, 24 * k, o.height - 24 * k);
  const credit = `コース：${o.info.attribution} ｜ ${o.credits[0] ?? ""}`;
  ctx.fillText(credit, o.width - ctx.measureText(credit).width - 24 * k, o.height - 24 * k);
  ctx.restore();
}
