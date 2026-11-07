import { describe, expect, it } from "vitest";
import presentationConfig from "../../../config/presentation/sapporo-demo.json";
import { parsePresentation } from "../presentation/config";
import { DEFAULT_LIFT_RAMP_M, type GroundLift, liftAt } from "./lift";

const L = 3369; // length of the Sapporo demo loop
const lift: GroundLift = { fromS: 290, toS: 560, liftM: 0.1, rampM: 4 };

describe("liftAt", () => {
  it("is exactly 0 with the presentation off, everywhere on the course", () => {
    for (let s = 0; s <= L; s += 1) expect(liftAt(s, null, L, true)).toBe(0);
  });

  it("is the full lift over the drawn road, including both ends", () => {
    for (const s of [290, 291, 425, 559, 560]) expect(liftAt(s, lift, L, true)).toBe(0.1);
  });

  it("goes back to the usual height beyond the ramps", () => {
    for (const s of [0, 100, 286, 564, 1000, 3368]) expect(liftAt(s, lift, L, true)).toBe(0);
  });

  it("eases in and out without a step or a kink at either end", () => {
    const step = 0.05;
    let prev = liftAt(280, lift, L, true);
    let prevSlope = 0;
    for (let s = 280 + step; s <= 570; s += step) {
      const h = liftAt(s, lift, L, true);
      const slope = (h - prev) / step;
      expect(Math.abs(h - prev)).toBeLessThan(0.002); // no jump (< 2 mm per 5 cm)
      expect(Math.abs(slope)).toBeLessThanOrEqual((1.5 * 0.1) / 4 + 1e-6); // max smoothstep slope
      expect(Math.abs(slope - prevSlope)).toBeLessThan(0.002); // no kink
      prev = h;
      prevSlope = slope;
    }
    expect(liftAt(288, lift, L, true)).toBeCloseTo(0.05, 9); // halfway up the entry ramp
    expect(liftAt(562, lift, L, true)).toBeCloseTo(0.05, 9); // halfway down the exit ramp
  });

  it("wraps across s = 0 on a closed loop but not on an open route", () => {
    const nearStart: GroundLift = { fromS: 1, toS: 50, liftM: 0.1, rampM: 4 };
    expect(liftAt(L - 1, nearStart, L, true)).toBeCloseTo(0.05, 9); // 2 m before fromS round the loop
    expect(liftAt(L - 1, nearStart, L, false)).toBe(0);
  });

  it("matches the committed Sapporo config with the default ramp", () => {
    const { road } = parsePresentation(presentationConfig);
    const cfgLift = { fromS: road.fromS, toS: road.toS, liftM: road.liftM, rampM: DEFAULT_LIFT_RAMP_M };
    expect(liftAt((road.fromS + road.toS) / 2, cfgLift, L, true)).toBe(road.liftM);
    expect(liftAt(road.fromS - DEFAULT_LIFT_RAMP_M - 1, cfgLift, L, true)).toBe(0);
    expect(liftAt(road.toS + DEFAULT_LIFT_RAMP_M + 1, cfgLift, L, true)).toBe(0);
  });
});
