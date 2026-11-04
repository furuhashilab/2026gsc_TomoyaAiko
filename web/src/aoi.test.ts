import { describe, expect, it } from "vitest";
import sharedAoi from "../../config/aoi.sapporo.json";
import { parseAoi } from "./aoi";

const valid = { id: "test", name: "test", bbox: [141.335, 43.05, 141.365, 43.072], crs: "EPSG:4326" };

describe("parseAoi", () => {
  it("loads the shared Sapporo AOI config", () => {
    const aoi = parseAoi(sharedAoi);
    expect(aoi.id).toBe("sapporo-center");
    expect([aoi.lonMin, aoi.latMin, aoi.lonMax, aoi.latMax]).toEqual([141.335, 43.05, 141.365, 43.072]);
  });

  it("rejects a bbox written in lat/lon order", () => {
    expect(() => parseAoi({ ...valid, bbox: [43.05, 141.335, 43.072, 141.365] })).toThrow(/latitudes/);
  });

  it("rejects a non-increasing bbox", () => {
    expect(() => parseAoi({ ...valid, bbox: [141.365, 43.05, 141.335, 43.072] })).toThrow(/longitudes/);
  });

  it("rejects a non-WGS84 crs", () => {
    expect(() => parseAoi({ ...valid, crs: "EPSG:6668" })).toThrow(/crs/);
  });
});
