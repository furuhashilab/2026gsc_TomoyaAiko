import { describe, expect, it } from "vitest";
import presentationConfig from "../../../config/presentation/sapporo-demo.json";
import { buildTrack, xyAt } from "../vehicle/track";
import { parsePresentation } from "./config";
import { buildMeshes, gridIndices, offsetLonLat, stations } from "./geometry";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const DEG = 180 / Math.PI;

// 600 m due east (open route), so "left of travel" is north.
const east = 600 / (111320 * Math.cos(43.06 / DEG));
const straight = buildTrack(
  [
    [141.35, 43.06],
    [141.35 + east, 43.06],
  ],
  false,
);

describe("parsePresentation", () => {
  const cfg = parsePresentation(presentationConfig);

  it("reads the committed Sapporo PoC config", () => {
    expect(cfg.courseId).toBe("sapporo-demo-circuit-001");
    expect(cfg.road.toS - cfg.road.fromS).toBeGreaterThanOrEqual(200);
    expect(cfg.road.toS - cfg.road.fromS).toBeLessThanOrEqual(300);
    expect(cfg.disclaimer).toMatch(/架空/);
    expect(cfg.ads.panels).toHaveLength(4);
  });

  it("keeps every sponsor fictional-labelled and the PoC away from s = 0 (no start line here)", () => {
    expect(cfg.ads.subText).toBe("FICTIONAL SPONSOR");
    expect(cfg.road.fromS).toBeGreaterThan(0);
    expect(JSON.stringify(presentationConfig)).not.toMatch(/start|finish/i);
  });

  it("rejects barriers outside the road range", () => {
    const bad = clone(presentationConfig);
    bad.barriers.sections[0].to_s = 900;
    expect(() => parsePresentation(bad)).toThrow(/inside the road range/);
  });

  it("rejects an ad that does not sit on a barrier of the same side", () => {
    const bad = clone(presentationConfig);
    bad.ads.panels[0].s = 420; // in the barrier gap at the cross street
    expect(() => parsePresentation(bad)).toThrow(/barrier section/);
  });

  it("rejects bad ranges, sides, colours and heights", () => {
    const cases: [(c: typeof presentationConfig) => void, RegExp][] = [
      [(c) => (c.road.to_s = c.road.from_s), /greater than/],
      [(c) => ((c.barriers.sections[0] as { side: string }).side = "middle"), /left/],
      [(c) => (c.ads.sponsors.cfai.bg = "red"), /#rrggbb/],
      [(c) => (c.barriers.fence_height_m = 0.5), /fence_height_m/],
      [(c) => (c.ads.height_m = 1.2), /barrier face/],
      [(c) => (c.road.kerb_width_m = 5), /fit inside/],
      [(c) => (c.schema = "other"), /schema/],
    ];
    for (const [mutate, re] of cases) {
      const bad = clone(presentationConfig);
      mutate(bad);
      expect(() => parsePresentation(bad)).toThrow(re);
    }
  });
});

describe("stations", () => {
  it("covers the range at the step, with the normal to the left of travel", () => {
    const sts = stations(straight, 100, 200, 2, 8);
    expect(sts).toHaveLength(51);
    expect(sts[0].s).toBe(100);
    expect(sts[50].s).toBe(200);
    // travelling east: left = north
    expect(sts[10].nx).toBeCloseTo(0, 6);
    expect(sts[10].ny).toBeCloseTo(1, 6);
    const [x, y] = xyAt(straight, 120);
    expect(sts[10].x).toBeCloseTo(x, 6);
    expect(sts[10].y).toBeCloseTo(y, 6);
  });

  it("offsets points by metres, not degrees", () => {
    const st = stations(straight, 50, 60, 10, 8)[0];
    const [lon, lat] = offsetLonLat(straight, st, 4.5);
    const [lon2, lat2] = offsetLonLat(straight, st, -4.5);
    expect((lat - lat2) * straight.mPerDegLat).toBeCloseTo(9, 6);
    expect((lon - lon2) * straight.mPerDegLon).toBeCloseTo(0, 6);
  });
});

describe("gridIndices", () => {
  it("makes two triangles per quad", () => {
    expect(gridIndices(2, 2)).toEqual([0, 2, 1, 1, 2, 3]);
    expect(gridIndices(3, 5)).toHaveLength(2 * 4 * 2 * 3);
  });
});

describe("buildMeshes", () => {
  const cfg = parsePresentation(presentationConfig);
  const m = buildMeshes(straight, cfg);
  const across = (lat: number) => (lat - straight.lat0) * straight.mPerDegLat;

  it("lays a road of the virtual width, lifted above the ground, with u across it", () => {
    const { road } = m;
    expect(road.cols).toBe(5);
    expect(road.rows).toBe(Math.ceil((cfg.road.toS - cfg.road.fromS) / cfg.sampleStepM) + 1);
    expect(across(road.lonLat[0][1]) - across(road.lonLat[4][1])).toBeCloseTo(cfg.road.widthM, 6);
    expect(new Set(road.up)).toEqual(new Set([cfg.road.liftM]));
    expect(road.uv[0]).toEqual([0, 0]);
    expect(road.uv[4][0]).toBe(1);
    expect(road.uv[road.uv.length - 1][1]).toBeCloseTo((cfg.road.toS - cfg.road.fromS) / cfg.road.textureRepeatM, 6);
  });

  it("puts barriers outside the road edge on the configured side, buried slightly, 1 m tall", () => {
    // 4 sections x (inner face, top, outer face, 2 caps)
    expect(m.barriers).toHaveLength(4 * 5);
    const edge = cfg.road.widthM / 2 + cfg.barriers.gapFromRoadM;
    const leftInner = m.barriers[0];
    expect(across(leftInner.lonLat[0][1])).toBeCloseTo(edge, 6);
    expect(Math.min(...leftInner.up)).toBeLessThan(0);
    expect(Math.max(...leftInner.up)).toBe(cfg.barriers.heightM);
    const rightInner = m.barriers[5];
    expect(across(rightInner.lonLat[0][1])).toBeCloseTo(-edge, 6);
  });

  it("keeps fences above the barriers and ads on the road-facing barrier side", () => {
    expect(m.fences).toHaveLength(4);
    for (const f of m.fences) expect(Math.min(...f.up)).toBe(cfg.barriers.heightM);
    const edge = cfg.road.widthM / 2 + cfg.barriers.gapFromRoadM;
    for (const { grid, panel } of m.ads) {
      const d = Math.abs(across(grid.lonLat[0][1]));
      expect(d).toBeLessThan(edge);
      expect(d).toBeGreaterThan(edge - 0.1);
      expect(Math.max(...grid.up)).toBeLessThanOrEqual(cfg.barriers.heightM);
      // text reads left to right from the road: u grows with s on the left, falls on the right
      const first = grid.uv[0][0];
      const last = grid.uv[grid.uv.length - 1][0];
      expect(panel.side === "left" ? last > first : last < first).toBe(true);
    }
  });
});
