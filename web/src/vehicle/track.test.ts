import { describe, expect, it } from "vitest";
import syntheticRaw from "../../../contracts/examples/synthetic-loop.course.geojson?raw";
import { parseCourse } from "../course";
import {
  angleDiff,
  buildTrack,
  distanceAtTime,
  headingAt,
  heightAt,
  lonLatAt,
  pitchAt,
  segmentHeadingAt,
  terrainSampleDistances,
  xyAt,
} from "./track";

const synthetic = parseCourse(JSON.parse(syntheticRaw));
const DEG = 180 / Math.PI;

// 200 m east, then 200 m north: one 90-degree corner (open route).
const east = 200 / (111320 * Math.cos(43.06 / DEG));
const north = 200 / 111132;
const corner: [number, number][] = [
  [141.35, 43.06],
  [141.35 + east, 43.06],
  [141.35 + east, 43.06 + north],
];

describe("buildTrack", () => {
  it("matches the course length computed in EPSG:6680 within 0.05 %", () => {
    const t = buildTrack(synthetic.coordinates, true);
    expect(Math.abs(t.length - synthetic.lengthM) / synthetic.lengthM).toBeLessThan(5e-4);
  });

  it("stays on the polyline (centre line) between vertices", () => {
    const t = buildTrack(corner, false);
    const [x, y] = xyAt(t, 100);
    expect(y).toBeCloseTo(t.y[0], 6); // still on the first (east-west) segment
    expect(x).toBeCloseTo(t.x[0] + 100, 0);
    expect(lonLatAt(t, 0)).toEqual([corner[0][0], corner[0][1]]);
  });
});

describe("loop and end behaviour", () => {
  it("wraps a circuit and clamps a rally", () => {
    const loop = buildTrack(synthetic.coordinates, true);
    expect(distanceAtTime(loop, 10, loop.length / 5)).toBeCloseTo(0, 6); // two laps
    expect(lonLatAt(loop, loop.length + 1)[0]).toBeCloseTo(lonLatAt(loop, 1)[0], 9);
    const rally = buildTrack(corner, false);
    expect(distanceAtTime(rally, 1000, 10)).toBe(rally.length);
  });
});

describe("heading", () => {
  const t = buildTrack(corner, false);

  it("equals the road direction away from corners (no sideways driving)", () => {
    expect(headingAt(t, 50, 8) * DEG).toBeCloseTo(90, 3);
    expect(headingAt(t, 300, 8) * DEG).toBeCloseTo(0, 3);
    for (let d = 0; d <= t.length; d += 1) {
      const nearCorner = Math.abs(d - t.s[1]) < 4; // the corner vertex (~200 m)
      const dev = Math.abs(angleDiff(headingAt(t, d, 8), segmentHeadingAt(t, d))) * DEG;
      if (!nearCorner) expect(dev).toBeLessThan(1e-6);
      else expect(dev).toBeLessThanOrEqual(45 + 1e-6); // only inside the window, at most half the turn
    }
  });

  it("changes smoothly through a corner and never reverses", () => {
    let prev = headingAt(t, 0, 8);
    for (let d = 0.5; d <= t.length; d += 0.5) {
      const h = headingAt(t, d, 8);
      const step = Math.abs(angleDiff(h, prev)) * DEG;
      expect(step).toBeLessThan(10); // a 90-degree turn spread over the 8 m window
      prev = h;
    }
  });

  it("follows the synthetic circuit without flipping direction", () => {
    const loop = buildTrack(synthetic.coordinates, true);
    let prev = headingAt(loop, 0, 8);
    for (let d = 1; d <= loop.length; d += 1) {
      const h = headingAt(loop, d, 8);
      expect(Math.abs(angleDiff(h, prev))).toBeLessThan(Math.PI / 2);
      prev = h;
    }
  });
});

describe("terrain heights", () => {
  it("interpolates coarse samples and computes pitch", () => {
    const t = buildTrack(corner, false);
    const ds = terrainSampleDistances(t, 10);
    expect(ds[0]).toBe(0);
    expect(ds[ds.length - 1]).toBe(t.length);
    const hs = ds.map((d) => 50 + 0.05 * d); // 5 % uphill
    expect(heightAt(t, ds, hs, 123)).toBeCloseTo(50 + 0.05 * 123, 6);
    expect(Math.tan(pitchAt(t, ds, hs, 100, 8))).toBeCloseTo(0.05, 6);
  });

  it("wraps heights on a circuit", () => {
    const loop = buildTrack(synthetic.coordinates, true);
    const ds = terrainSampleDistances(loop, 10);
    const hs = ds.map((_, i) => i);
    const last = hs[hs.length - 1];
    expect(heightAt(loop, ds, hs, loop.length - 1e-6)).toBeCloseTo(0, 3);
    expect(heightAt(loop, ds, hs, ds[ds.length - 1])).toBeCloseTo(last, 6);
  });
});
