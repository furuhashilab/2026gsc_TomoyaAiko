import { describe, expect, it } from "vitest";
import syntheticRaw from "../../contracts/examples/synthetic-loop.course.geojson?raw";
import { arrowSegments, bearingRad, parseCourse } from "./course";

const sample = JSON.parse(syntheticRaw);
const clone = () => JSON.parse(syntheticRaw);

describe("parseCourse", () => {
  it("reads the committed synthetic sample", () => {
    const c = parseCourse(sample);
    expect(c.id).toBe("synthetic-loop");
    expect(c.mode).toBe("circuit");
    expect(c.synthetic).toBe(true);
    expect(c.segments).toHaveLength(c.coordinates.length - 1);
    expect(c.coordinates[0]).toEqual(c.coordinates[c.coordinates.length - 1]);
    expect(c.validation?.status).toBe("valid");
  });

  it("rejects lat/lon order", () => {
    const bad = clone();
    bad.geometry.coordinates[1] = [43.06, 141.35];
    expect(() => parseCourse(bad)).toThrow(/out of range/);
  });

  it("rejects a broken segment chain", () => {
    const bad = clone();
    bad.properties.segments[2].from_node = 999;
    expect(() => parseCourse(bad)).toThrow(/does not continue/);
  });

  it("rejects an open circuit", () => {
    const bad = clone();
    bad.geometry.coordinates.pop();
    bad.properties.segments.pop();
    expect(() => parseCourse(bad)).toThrow(/not closed/);
  });

  it("rejects other files", () => {
    expect(() => parseCourse({ type: "FeatureCollection", features: [] })).toThrow(/Feature/);
    expect(() => parseCourse({ ...clone(), properties: { ...clone().properties, schema: "other" } })).toThrow(/schema/);
  });
});

describe("arrowSegments", () => {
  it("places arrows along the line", () => {
    const line: [number, number][] = [
      [141.35, 43.06],
      [141.36, 43.06],
      [141.37, 43.06],
    ];
    expect(arrowSegments(line, 500).length).toBeGreaterThan(1);
  });
});

describe("bearingRad", () => {
  it("points north and east as expected", () => {
    expect(bearingRad([141.35, 43.06], [141.35, 43.07])).toBeCloseTo(0, 6);
    expect(bearingRad([141.35, 43.06], [141.36, 43.06])).toBeCloseTo(Math.PI / 2, 2);
  });
});
