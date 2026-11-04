import { describe, expect, it } from "vitest";
import vehicleConfig from "../../../config/vehicle.json";
import { parseVehicleConfig } from "./config";

const clone = () => JSON.parse(JSON.stringify(vehicleConfig));

describe("parseVehicleConfig", () => {
  it("reads the committed vehicle config", () => {
    const c = parseVehicleConfig(vehicleConfig);
    expect(c.modelUri).toBe("models/kenney-car-kit/race.glb");
    expect(c.license).toBe("CC0-1.0");
    expect(c.terrainStepM).toBe(2);
    expect(c.baseSpeedMps).toBeCloseTo(40 / 3.6);
    expect(c.multipliers).toContain(1);
  });

  it("requires licence and provenance for the model", () => {
    const bad = clone();
    delete bad.model.license;
    expect(() => parseVehicleConfig(bad)).toThrow(/license/);
  });

  it("requires a SHA-256 for the model file", () => {
    const bad = clone();
    bad.model.files = {};
    expect(() => parseVehicleConfig(bad)).toThrow(/SHA-256/);
  });
});
