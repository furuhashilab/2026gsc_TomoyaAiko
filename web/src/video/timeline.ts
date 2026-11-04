// Video timeline: a JSON list of scenes evaluated as a pure function of time.
//
// The exporter turns frame i into t = i / fps and asks `evaluate` for the camera, how much
// of the course is drawn and which 2D overlays are visible. Nothing depends on wall-clock
// time, so the same timeline and course always give the same sequence of states.
// New scene content (sectors, tyre cards, ...) is added as new overlay names.

export interface CameraPose {
  /** Degrees clockwise from north, looking at the course centre. */
  heading: number;
  /** Degrees; negative looks down. */
  pitch: number;
  /** Distance from the course centre as a multiple of the course radius. */
  rangeK: number;
}

export interface Scene {
  id: string;
  start: number;
  end: number;
  camera: { from: CameraPose; to: CameraPose };
  /** Course drawn fraction at the start and end of the scene; omitted = keep the previous value. */
  draw?: [number, number];
  overlays?: string[];
}

export interface Timeline {
  id: string;
  width: number;
  height: number;
  fps: number;
  durationS: number;
  /** WebM codecs to try in order; the first one the browser can encode is used. */
  codecs: string[];
  bitrate: number;
  scenes: Scene[];
}

export interface OverlayState {
  name: string;
  /** 0..1, fades in and out at the scene edges. */
  alpha: number;
  /** 0..1 progress through the scene (for overlay animations). */
  u: number;
}

export interface FrameState {
  t: number;
  scene: string;
  camera: CameraPose;
  drawn: number;
  overlays: OverlayState[];
}

const FADE_S = 0.4;
const WEBM_CODECS = new Set(["vp9", "vp8", "av1"]);

function fail(message: string): never {
  throw new Error(`Invalid timeline: ${message}`);
}

function num(v: unknown, what: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) fail(`${what} must be a number`);
  return v;
}

function pose(v: unknown, what: string): CameraPose {
  const p = (v ?? {}) as Record<string, unknown>;
  const rangeK = num(p.rangeK, `${what}.rangeK`);
  if (rangeK <= 0) fail(`${what}.rangeK must be positive`);
  return { heading: num(p.heading, `${what}.heading`), pitch: num(p.pitch, `${what}.pitch`), rangeK };
}

export function parseTimeline(data: unknown): Timeline {
  const d = (data ?? {}) as Record<string, unknown>;
  const width = num(d.width, "width");
  const height = num(d.height, "height");
  // VP9/VP8 encoders need even dimensions
  if (width % 2 || height % 2 || width <= 0 || height <= 0) fail("width and height must be positive even numbers");
  const fps = num(d.fps, "fps");
  const durationS = num(d.durationS, "durationS");
  if (fps <= 0 || durationS <= 0) fail("fps and durationS must be positive");
  const codecs = Array.isArray(d.codecs) ? d.codecs.map(String) : fail("codecs must be an array");
  if (codecs.length === 0 || codecs.some((c) => !WEBM_CODECS.has(c))) fail("codecs must list WebM codecs (vp9, vp8, av1)");
  if (!Array.isArray(d.scenes) || d.scenes.length === 0) fail("scenes must be a non-empty array");
  let prevEnd = 0;
  const scenes = d.scenes.map((s: Record<string, unknown>, i: number): Scene => {
    const start = num(s.start, `scene ${i} start`);
    const end = num(s.end, `scene ${i} end`);
    if (Math.abs(start - prevEnd) > 1e-9) fail(`scene ${i} must start where the previous one ends (${prevEnd})`);
    if (end <= start) fail(`scene ${i} must end after it starts`);
    prevEnd = end;
    const cam = (s.camera ?? {}) as Record<string, unknown>;
    let draw: [number, number] | undefined;
    if (s.draw !== undefined) {
      if (!Array.isArray(s.draw) || s.draw.length !== 2) fail(`scene ${i} draw must be [from, to]`);
      draw = [num(s.draw[0], `scene ${i} draw`), num(s.draw[1], `scene ${i} draw`)];
      if (draw.some((v) => v < 0 || v > 1)) fail(`scene ${i} draw values must be within 0..1`);
    }
    return {
      id: String(s.id ?? fail(`scene ${i} has no id`)),
      start,
      end,
      camera: { from: pose(cam.from, `scene ${i} camera.from`), to: pose(cam.to, `scene ${i} camera.to`) },
      draw,
      overlays: Array.isArray(s.overlays) ? s.overlays.map(String) : [],
    };
  });
  if (Math.abs(prevEnd - durationS) > 1e-9) fail(`scenes end at ${prevEnd} s but durationS is ${durationS}`);
  return { id: String(d.id ?? fail("id is missing")), width, height, fps, durationS, codecs, bitrate: num(d.bitrate, "bitrate"), scenes };
}

export function frameCount(tl: Timeline): number {
  return Math.round(tl.durationS * tl.fps);
}

/** Smooth start and stop (no sudden camera jumps between scenes). */
export function ease(u: number): number {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

export function evaluate(tl: Timeline, t: number): FrameState {
  let i = tl.scenes.findIndex((s) => t < s.end);
  if (i === -1) i = tl.scenes.length - 1;
  const s = tl.scenes[i];
  const last = i === tl.scenes.length - 1;
  const u = Math.min(1, Math.max(0, (t - s.start) / (s.end - s.start)));
  const e = ease(u);
  const { from, to } = s.camera;
  let drawn = 0;
  for (const prev of tl.scenes.slice(0, i)) if (prev.draw) drawn = prev.draw[1];
  if (s.draw) drawn = lerp(s.draw[0], s.draw[1], e);
  // the last scene (credits) stays fully visible until the final frame
  const alpha = Math.min(1, (t - s.start) / FADE_S, last ? 1 : (s.end - t) / FADE_S);
  return {
    t,
    scene: s.id,
    camera: { heading: lerp(from.heading, to.heading, e), pitch: lerp(from.pitch, to.pitch, e), rangeK: lerp(from.rangeK, to.rangeK, e) },
    drawn,
    overlays: (s.overlays ?? []).map((name) => ({ name, alpha: Math.max(0, alpha), u })),
  };
}
