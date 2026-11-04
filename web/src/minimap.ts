// 2D course minimap (SVG) drawn from the loaded course itself; no base map.
//
// Geometry helpers are pure (unit-tested); `Minimap` only maps them onto SVG elements.
// The marker uses the same vehicle state as the 3D model, so both stay in sync.
// Layers are separate <g> groups so sectors, corner numbers or position markers can be
// added later without touching the existing ones.
import { type Track, headingAt, normalise, xyAt } from "./vehicle/track";

export type Point = [number, number];

export interface Fit {
  toSvg(x: number, y: number): Point;
  scale: number;
}

/** Fit the track (planar metres, y = north) into a width x height box, keeping aspect ratio. */
export function fitTrack(track: Track, width: number, height: number, pad: number): Fit {
  const minX = Math.min(...track.x);
  const maxX = Math.max(...track.x);
  const minY = Math.min(...track.y);
  const maxY = Math.max(...track.y);
  const scale = Math.min((width - 2 * pad) / Math.max(maxX - minX, 1e-9), (height - 2 * pad) / Math.max(maxY - minY, 1e-9));
  const ox = (width - (maxX - minX) * scale) / 2;
  const oy = (height - (maxY - minY) * scale) / 2;
  return {
    scale,
    toSvg: (x, y) => [ox + (x - minX) * scale, height - (oy + (y - minY) * scale)], // SVG y grows downwards
  };
}

/** Polyline vertices between distances a and b (a <= b, both within the track), with exact ends. */
export function slice(track: Track, a: number, b: number): Point[] {
  const out: Point[] = [xyAt(track, a)];
  for (let i = 0; i < track.s.length; i++) {
    if (track.s[i] > a && track.s[i] < b) out.push([track.x[i], track.y[i]]);
  }
  out.push(xyAt(track, b));
  return out;
}

/** Driven (start -> d) and remaining (d -> end) parts of the current lap. */
export function splitAt(track: Track, distance: number): { done: Point[]; todo: Point[] } {
  const d = normalise(track, distance);
  return { done: slice(track, 0, d), todo: slice(track, d, track.length) };
}

/** The next `lengthM` of the route from d; wraps past the start/finish on a circuit. */
export function ahead(track: Track, distance: number, lengthM: number): Point[] {
  const d = normalise(track, distance);
  const end = d + lengthM;
  if (end <= track.length || !track.closed) return slice(track, d, Math.min(end, track.length));
  return [...slice(track, d, track.length), ...slice(track, 0, end - track.length).slice(1)];
}

/** SVG rotation (degrees clockwise) for a heading in radians clockwise from north. */
export function markerRotation(heading: number): number {
  return (heading * 180) / Math.PI;
}

const NS = "http://www.w3.org/2000/svg";

function el<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string>, parent?: Element) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.appendChild(e);
  return e;
}

const pts = (fit: Fit, p: Point[]) =>
  p.map(([x, y]) => fit.toSvg(x, y).map((v) => v.toFixed(1)).join(",")).join(" ");

export class Minimap {
  private readonly svg: SVGSVGElement;
  private readonly todo: SVGPolylineElement;
  private readonly done: SVGPolylineElement;
  private readonly next: SVGPolylineElement;
  private readonly start: SVGGElement;
  private readonly marker: SVGGElement;
  private readonly label: HTMLDivElement;
  private track: Track | null = null;
  private fit: Fit | null = null;

  constructor(
    container: HTMLElement,
    private readonly width = 200,
    private readonly height = 200,
    private readonly headingWindowM = 8,
  ) {
    this.svg = el("svg", { viewBox: `0 0 ${width} ${height}`, width: String(width), height: String(height), role: "img", "aria-label": "コースのミニマップ" });
    const route = el("g", { class: "layer-route" }, this.svg);
    el("g", { class: "layer-annotations" }, this.svg); // future: sectors, corner numbers
    const line = { fill: "none", "stroke-linejoin": "round", "stroke-linecap": "round" };
    this.todo = el("polyline", { ...line, stroke: "#9aa3ad", "stroke-width": "4" }, route);
    this.done = el("polyline", { ...line, stroke: "#ff7a00", "stroke-width": "4" }, route);
    this.next = el("polyline", { ...line, stroke: "#ffd400", "stroke-width": "6", opacity: "0.9" }, route);
    this.start = el("g", {}, this.svg);
    el("rect", { x: "-5", y: "-2", width: "10", height: "4", fill: "#fff", stroke: "#000", "stroke-width": "1" }, this.start);
    el("text", { x: "7", y: "4", fill: "#fff", "font-size": "10", "font-family": "system-ui" }, this.start).textContent = "S/F";
    this.marker = el("g", { class: "layer-vehicles" }, this.svg); // future: more vehicles
    el("polygon", { points: "0,-9 6,6 0,3 -6,6", fill: "#fff", stroke: "#d9481f", "stroke-width": "2" }, this.marker);
    container.appendChild(this.svg);
    this.label = document.createElement("div");
    container.appendChild(this.label);
  }

  setTrack(track: Track): void {
    this.track = track;
    this.fit = fitTrack(track, this.width, this.height, 12);
    const [sx, sy] = this.fit.toSvg(track.x[0], track.y[0]);
    this.start.setAttribute("transform", `translate(${sx.toFixed(1)},${sy.toFixed(1)}) rotate(${markerRotation(headingAt(track, 0, this.headingWindowM)).toFixed(1)})`);
  }

  /** Current marker position in SVG coordinates (for checks). */
  markerPosition(distance: number): Point | null {
    if (!this.track || !this.fit) return null;
    const [x, y] = xyAt(this.track, distance);
    return this.fit.toSvg(x, y);
  }

  update(distance: number, lap: number): void {
    if (!this.track || !this.fit) return;
    const { done, todo } = splitAt(this.track, distance);
    this.todo.setAttribute("points", pts(this.fit, todo));
    this.done.setAttribute("points", pts(this.fit, done));
    this.next.setAttribute("points", pts(this.fit, ahead(this.track, distance, 150)));
    const [mx, my] = this.markerPosition(distance) as Point;
    const rot = markerRotation(headingAt(this.track, distance, this.headingWindowM));
    this.marker.setAttribute("transform", `translate(${mx.toFixed(1)},${my.toFixed(1)}) rotate(${rot.toFixed(1)})`);
    const pct = Math.floor((normalise(this.track, distance) / this.track.length) * 100);
    this.label.textContent = this.track.closed ? `${lap} 周目 ${pct}%（黄：この先 150 m）` : `${pct}%（黄：この先 150 m）`;
  }
}
