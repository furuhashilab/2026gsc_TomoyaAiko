// Meshes for the race presentation, independent of CesiumJS (unit-tested).
//
// Everything is laid out along the course polyline by distance s: a station is a point on
// the centre line plus the unit normal to the left of travel, and a cross-section profile
// is swept along the stations. Vertices carry (lon, lat) and a height *relative to the
// ground at that same lon/lat*; the CesiumJS layer samples the terrain there and adds it.
// The terrain only gives heights: it says nothing about buildings next to the road.

import type { PresentationConfig, Side } from "./config";
import { headingAt, type Track, xyAt } from "../vehicle/track";

export interface Station {
  s: number;
  x: number;
  y: number;
  /** unit normal pointing to the left of the travel direction */
  nx: number;
  ny: number;
}

/** A rows x cols vertex grid (row-major) triangulated as quads. */
export interface Grid {
  rows: number;
  cols: number;
  lonLat: [number, number][];
  /** height above the ground sampled at the same lon/lat (m) */
  up: number[];
  uv: [number, number][];
}

export interface PresentationMeshes {
  road: Grid;
  barriers: Grid[];
  fences: Grid[];
  ads: { grid: Grid; panel: PresentationConfig["ads"]["panels"][number] }[];
}

/** Stations every ~stepM from fromS to toS (both included); normals from a heading window. */
export function stations(track: Track, fromS: number, toS: number, stepM: number, headingWindowM: number): Station[] {
  const n = Math.max(1, Math.ceil((toS - fromS) / stepM));
  const out: Station[] = [];
  for (let k = 0; k <= n; k++) {
    const s = fromS + (k * (toS - fromS)) / n;
    const [x, y] = xyAt(track, s);
    const h = headingAt(track, s, headingWindowM);
    out.push({ s, x, y, nx: -Math.cos(h), ny: Math.sin(h) });
  }
  return out;
}

/** lon/lat of the point `offset` metres to the left (negative = right) of a station. */
export function offsetLonLat(track: Track, st: Station, offset: number): [number, number] {
  return [track.lon0 + (st.x + st.nx * offset) / track.mPerDegLon, track.lat0 + (st.y + st.ny * offset) / track.mPerDegLat];
}

/** Triangle indices for a grid (two triangles per quad). */
export function gridIndices(rows: number, cols: number): number[] {
  const out: number[] = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      out.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
    }
  }
  return out;
}

interface ProfilePoint {
  offset: number;
  up: number;
  v: number;
}

/** Sweep a cross-section along stations; u = f(s) along the course, v from the profile. */
function sweep(track: Track, sts: Station[], profile: ProfilePoint[], u: (s: number) => number): Grid {
  const g: Grid = { rows: sts.length, cols: profile.length, lonLat: [], up: [], uv: [] };
  for (const st of sts) {
    for (const p of profile) {
      g.lonLat.push(offsetLonLat(track, st, p.offset));
      g.up.push(p.up);
      g.uv.push([u(st.s), p.v]);
    }
  }
  return g;
}

/** A flat quad across one station (barrier end cap). */
function cap(track: Track, st: Station, inner: number, outer: number, bottom: number, top: number): Grid {
  const g: Grid = { rows: 2, cols: 2, lonLat: [], up: [], uv: [] };
  for (const [up, v] of [[bottom, 0], [top, 1]]) {
    for (const [off, u] of [[inner, 0], [outer, 1]]) {
      g.lonLat.push(offsetLonLat(track, st, off));
      g.up.push(up);
      g.uv.push([u, v]);
    }
  }
  return g;
}

const sign = (side: Side) => (side === "left" ? 1 : -1);

// how far barrier faces reach below the sampled ground, so slopes leave no visible gap
const BURY_M = 0.3;
// ad panels sit this far in front of the barrier face (avoids z-fighting with it)
const AD_GAP_M = 0.03;
// ad panels start this high above the ground
const AD_BASE_M = 0.1;
// texture repeat length along concrete and fence (m)
export const CONCRETE_REPEAT_M = 4;
export const FENCE_REPEAT_M = 4;

export function buildMeshes(track: Track, cfg: PresentationConfig): PresentationMeshes {
  const { road, barriers: b, ads } = cfg;
  const step = cfg.sampleStepM;
  const win = cfg.headingWindowM;
  const half = road.widthM / 2;

  // Road: 5 vertices across, so the ribbon follows terrain crossfall instead of cutting
  // through it; u = 0 at the left edge, v runs along the course.
  const across: ProfilePoint[] = [0, 0.25, 0.5, 0.75, 1].map((t) => ({ offset: half - t * road.widthM, up: road.liftM, v: t }));
  const roadGrid = sweep(track, stations(track, road.fromS, road.toS, step, win), across, (s) => (s - road.fromS) / road.textureRepeatM);
  // the texture runs across the road in u, so swap (u, v)
  roadGrid.uv = roadGrid.uv.map(([along, acrossT]) => [acrossT, along]);

  const barrierGrids: Grid[] = [];
  const fenceGrids: Grid[] = [];
  for (const sec of b.sections) {
    const k = sign(sec.side);
    const inner = k * (half + b.gapFromRoadM);
    const outer = k * (half + b.gapFromRoadM + b.thicknessM);
    const mid = (inner + outer) / 2;
    const sts = stations(track, sec.fromS, sec.toS, step, win);
    const u = (s: number) => (s - sec.fromS) / CONCRETE_REPEAT_M;
    barrierGrids.push(
      sweep(track, sts, [{ offset: inner, up: -BURY_M, v: 0 }, { offset: inner, up: b.heightM, v: 1 }], u),
      sweep(track, sts, [{ offset: inner, up: b.heightM, v: 0 }, { offset: outer, up: b.heightM, v: 1 }], u),
      sweep(track, sts, [{ offset: outer, up: -BURY_M, v: 0 }, { offset: outer, up: b.heightM, v: 1 }], u),
      cap(track, sts[0], inner, outer, -BURY_M, b.heightM),
      cap(track, sts[sts.length - 1], inner, outer, -BURY_M, b.heightM),
    );
    if (b.fenceHeightM > b.heightM) {
      fenceGrids.push(
        sweep(track, sts, [{ offset: mid, up: b.heightM, v: 0 }, { offset: mid, up: b.fenceHeightM, v: 1 }], (s) => (s - sec.fromS) / FENCE_REPEAT_M),
      );
    }
  }

  const adGrids = ads.panels.map((panel) => {
    const k = sign(panel.side);
    const face = k * (half + b.gapFromRoadM - AD_GAP_M);
    const s0 = panel.s - ads.lengthM / 2;
    const sts = stations(track, s0, s0 + ads.lengthM, step, win);
    // Seen from the road, +s runs to the right on the left barrier and to the left on the
    // right barrier; flip u there so the text reads left to right.
    const u = (s: number) => (panel.side === "left" ? (s - s0) / ads.lengthM : 1 - (s - s0) / ads.lengthM);
    const grid = sweep(track, sts, [{ offset: face, up: AD_BASE_M, v: 0 }, { offset: face, up: AD_BASE_M + ads.heightM, v: 1 }], u);
    return { grid, panel };
  });

  return { road: roadGrid, barriers: barrierGrids, fences: fenceGrids, ads: adGrids };
}
