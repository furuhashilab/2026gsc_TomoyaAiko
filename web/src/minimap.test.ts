import { describe, expect, it } from "vitest";
import syntheticRaw from "../../contracts/examples/synthetic-loop.course.geojson?raw";
import { parseCourse } from "./course";
import { ahead, fitTrack, markerRotation, splitAt } from "./minimap";
import { angleDiff, buildTrack, headingAt, xyAt } from "./vehicle/track";

const loop = buildTrack(parseCourse(JSON.parse(syntheticRaw)).coordinates, true);
const pathLength = (p: [number, number][]) => p.slice(1).reduce((a, q, i) => a + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0);

// 200 m east then 200 m north with a 90-degree corner (open route)
const corner = buildTrack(
  [
    [141.35, 43.06],
    [141.35 + 200 / (111320 * Math.cos((43.06 * Math.PI) / 180)), 43.06],
    [141.35 + 200 / (111320 * Math.cos((43.06 * Math.PI) / 180)), 43.06 + 200 / 111132],
  ],
  false,
);

describe("fitTrack", () => {
  it("keeps the whole course inside the box with its aspect ratio", () => {
    const fit = fitTrack(loop, 200, 200, 12);
    for (let i = 0; i < loop.x.length; i++) {
      const [sx, sy] = fit.toSvg(loop.x[i], loop.y[i]);
      expect(sx).toBeGreaterThanOrEqual(11.99);
      expect(sx).toBeLessThanOrEqual(188.01);
      expect(sy).toBeGreaterThanOrEqual(11.99);
      expect(sy).toBeLessThanOrEqual(188.01);
    }
  });

  it("puts north up (larger y = smaller SVG y)", () => {
    const fit = fitTrack(corner, 200, 200, 12);
    expect(fit.toSvg(corner.x[2], corner.y[2])[1]).toBeLessThan(fit.toSvg(corner.x[1], corner.y[1])[1]);
  });
});

describe("splitAt / ahead", () => {
  it("splits the lap into driven and remaining parts that add up to the lap", () => {
    for (const d of [0, 50, 123.4, loop.length - 1]) {
      const { done, todo } = splitAt(loop, d);
      expect(pathLength(done)).toBeCloseTo(d, 3);
      expect(pathLength(done) + pathLength(todo)).toBeCloseTo(loop.length, 3);
      expect(done[done.length - 1]).toEqual(xyAt(loop, d)); // marker sits where the two meet
    }
  });

  it("shows the next stretch across the start/finish on a circuit", () => {
    const p = ahead(loop, loop.length - 20, 50);
    expect(pathLength(p)).toBeCloseTo(50, 3);
  });

  it("stops at the end of a rally", () => {
    expect(pathLength(ahead(corner, corner.length - 20, 50))).toBeCloseTo(20, 3);
  });
});

describe("marker direction", () => {
  it("follows the road and turns smoothly through a sharp corner without flipping", () => {
    expect(markerRotation(headingAt(corner, 50, 8))).toBeCloseTo(90, 3); // east
    expect(markerRotation(headingAt(corner, corner.length - 50, 8))).toBeCloseTo(0, 3); // north
    let prev = headingAt(corner, 0, 8);
    for (let d = 0.5; d <= corner.length; d += 0.5) {
      const h = headingAt(corner, d, 8);
      expect(Math.abs(angleDiff(h, prev))).toBeLessThan(Math.PI / 2);
      prev = h;
    }
  });
});
