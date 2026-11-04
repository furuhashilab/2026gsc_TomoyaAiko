import { describe, expect, it } from "vitest";
import introRaw from "../../../config/video/intro-18s.json?raw";
import stepARaw from "../../../config/video/step-a-3s.json?raw";
import syntheticRaw from "../../../contracts/examples/synthetic-loop.course.geojson?raw";
import { parseCourse } from "../course";
import { type LonLat, courseFrame, partialCourse } from "./geometry";
import { OVERLAY_NAMES, lengthLabel, statLines } from "./overlay";
import { ease, evaluate, frameCount, parseTimeline } from "./timeline";

const intro = parseTimeline(JSON.parse(introRaw));
const stepA = parseTimeline(JSON.parse(stepARaw));
const course = parseCourse(JSON.parse(syntheticRaw));
const coords = course.coordinates as LonLat[];

describe("timeline files", () => {
  it("Step A is 1280x720, 30 fps, 3 s = 90 frames", () => {
    expect([stepA.width, stepA.height, stepA.fps, frameCount(stepA)]).toEqual([1280, 720, 30, 90]);
  });

  it("the course introduction is 1920x1080, 30 fps, 18 s = 540 frames", () => {
    expect([intro.width, intro.height, intro.fps, frameCount(intro)]).toEqual([1920, 1080, 30, 540]);
  });

  it("only uses overlays that have a renderer", () => {
    for (const tl of [intro, stepA]) for (const s of tl.scenes) for (const o of s.overlays ?? []) expect(OVERLAY_NAMES).toContain(o);
  });
});

describe("parseTimeline", () => {
  const base = JSON.parse(stepARaw);
  it("rejects gaps between scenes, odd sizes and non-WebM codecs", () => {
    expect(() => parseTimeline({ ...base, scenes: [{ ...base.scenes[0], start: 0.5 }] })).toThrow(/previous one ends/);
    expect(() => parseTimeline({ ...base, width: 1281 })).toThrow(/even/);
    expect(() => parseTimeline({ ...base, codecs: ["avc"] })).toThrow(/WebM/);
    expect(() => parseTimeline({ ...base, durationS: 4 })).toThrow(/durationS/);
  });
});

describe("evaluate", () => {
  it("is a pure function of time (same t, same state)", () => {
    for (const t of [0, 3.3, 9.99, 17.97]) expect(evaluate(intro, t)).toEqual(evaluate(intro, t));
  });

  it("moves the camera continuously across scene boundaries", () => {
    let prev = evaluate(intro, 0).camera;
    for (let i = 1; i < frameCount(intro); i++) {
      const c = evaluate(intro, i / intro.fps).camera;
      expect(Math.abs(c.heading - prev.heading)).toBeLessThan(2);
      expect(Math.abs(c.pitch - prev.pitch)).toBeLessThan(2);
      expect(Math.abs(c.rangeK - prev.rangeK)).toBeLessThan(1);
      prev = c;
    }
  });

  it("draws the course 0 -> 1 during its scene and keeps it drawn afterwards", () => {
    expect(evaluate(intro, 2).drawn).toBe(0);
    expect(evaluate(intro, 7).drawn).toBeCloseTo(0.5, 5);
    expect(evaluate(intro, 12).drawn).toBe(1);
    expect(evaluate(intro, 17.9).drawn).toBe(1);
  });

  it("fades overlays in and keeps the final credits fully visible on the last frame", () => {
    expect(evaluate(intro, 10).overlays.find((o) => o.name === "title")?.alpha).toBe(0);
    expect(evaluate(intro, 12).overlays.find((o) => o.name === "title")?.alpha).toBe(1);
    expect(evaluate(intro, (frameCount(intro) - 1) / intro.fps).overlays).toEqual([expect.objectContaining({ name: "credits", alpha: 1 })]);
  });

  it("eases without overshoot", () => {
    expect([ease(-1), ease(0), ease(0.5), ease(1), ease(2)]).toEqual([0, 0, 0.5, 1, 1]);
  });
});

describe("course geometry and labels", () => {
  const frame = courseFrame(coords);
  it("measures roughly the course length from the file", () => {
    expect(frame.lengthM).toBeGreaterThan(course.lengthM * 0.98);
    expect(frame.lengthM).toBeLessThan(course.lengthM * 1.02);
  });

  it("draws exactly the requested fraction", () => {
    const len = (p: LonLat[]) => courseFrame(p).lengthM;
    expect(partialCourse(coords, frame, 0)).toHaveLength(1);
    expect(len(partialCourse(coords, frame, 0.5)) / frame.lengthM).toBeCloseTo(0.5, 2);
    expect(partialCourse(coords, frame, 1)).toEqual(coords);
  });

  it("takes the labels from the course file", () => {
    expect(lengthLabel(398.882)).toBe("399 m");
    expect(lengthLabel(3369.1)).toBe("3.37 km");
    expect(statLines({ name: "x", lengthM: course.lengthM, mode: course.mode, segments: course.segments.length, attribution: "", synthetic: true })).toEqual([
      "全長 399 m",
      "周回コース",
      "6 区間",
      "合成データ（OSM 由来ではない）",
    ]);
  });
});
