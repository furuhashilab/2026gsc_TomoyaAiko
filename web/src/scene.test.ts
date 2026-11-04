import { describe, expect, it } from "vitest";
import sceneConfig from "../../config/scene.sapporo.json";
import { heightStats, parseScene, TERRAIN_ATTRIBUTION } from "./scene";

const clone = () => JSON.parse(JSON.stringify(sceneConfig));

describe("parseScene", () => {
  it("reads the committed Sapporo scene config", () => {
    const s = parseScene(sceneConfig);
    expect(s.terrain.url).toBe("https://tile.plateauview.mlit.go.jp/terrain");
    expect(s.terrain.attribution).toContain(TERRAIN_ATTRIBUTION);
    expect(s.buildings.tilesets.length).toBeGreaterThan(0);
    expect(s.buildings.attribution).toContain("PLATEAU");
  });

  it("requires the terrain attribution", () => {
    const bad = clone();
    bad.terrain.attribution = "PLATEAU";
    expect(() => parseScene(bad)).toThrow(/attribution/);
  });

  it("requires https URLs", () => {
    const bad = clone();
    bad.buildings.tilesets[0].url = "http://example.com/tileset.json";
    expect(() => parseScene(bad)).toThrow(/https/);
  });
});

describe("heightStats", () => {
  it("summarises differences against the provisional threshold", () => {
    const s = heightStats([-0.5, 0.1, -2.5, 1.9]);
    expect(s.n).toBe(4);
    expect(s.min).toBe(-2.5);
    expect(s.max).toBe(1.9);
    expect(s.withinThreshold).toBe(3);
    expect(s.mean).toBeCloseTo(-0.25);
  });
});
