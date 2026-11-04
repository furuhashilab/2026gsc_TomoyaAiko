import { describe, expect, it } from "vitest";
import basemapConfig from "../../config/basemaps.json";
import sceneConfig from "../../config/scene.sapporo.json";
import { basemapCreditHtml, parseBasemaps, pickBasemap, pickBuildingStyle, tilesetsFor } from "./basemaps";
import { parseScene } from "./scene";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe("parseBasemaps", () => {
  const cfg = parseBasemaps(basemapConfig);

  it("reads the committed config with the three options", () => {
    expect(cfg.basemaps.map((b) => b.id)).toEqual(["gsi-std", "gsi-seamlessphoto", "none"]);
    expect(cfg.buildings.map((b) => b.id)).toEqual(["untextured", "textured"]);
  });

  it("requires attribution for external tiles but not for the plain colour", () => {
    const bad = clone(basemapConfig);
    bad.basemaps[1].attribution = "";
    expect(() => parseBasemaps(bad)).toThrow(/attribution/);
    expect(cfg.basemaps[2].url).toBeNull();
    expect(basemapCreditHtml(cfg.basemaps[2])).toBeNull();
  });

  it("refuses non-https or non-XYZ URLs and an undefined default", () => {
    const http = clone(basemapConfig);
    http.basemaps[0].url = "http://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png";
    expect(() => parseBasemaps(http)).toThrow(/https/);
    const def = clone(basemapConfig);
    def.default_basemap = "google";
    expect(() => parseBasemaps(def)).toThrow(/default_basemap/);
  });

  it("switches the credit with the basemap", () => {
    const std = basemapCreditHtml(pickBasemap(cfg, "gsi-std")) as string;
    const photo = basemapCreditHtml(pickBasemap(cfg, "gsi-seamlessphoto")) as string;
    expect(std).toContain("標準地図");
    expect(std).toContain("maps.gsi.go.jp/development/ichiran.html");
    expect(photo).toContain("全国最新写真（シームレス）");
    expect(photo).toContain("Landsat8");
    expect(photo).not.toContain("標準地図");
  });

  it("falls back to the defaults for unknown URL values", () => {
    expect(pickBasemap(cfg, "nope").id).toBe(cfg.defaultBasemap);
    expect(pickBasemap(cfg, null).id).toBe(cfg.defaultBasemap);
    expect(pickBuildingStyle(cfg, "fancy")).toBe(cfg.defaultBuildings);
    expect(pickBuildingStyle(cfg, "untextured")).toBe("untextured");
  });
});

describe("tilesetsFor", () => {
  const scene = parseScene(sceneConfig);

  it("keeps the untextured set as is", () => {
    expect(tilesetsFor(scene, "untextured")).toEqual(scene.buildings.tilesets);
  });

  it("swaps only the Chuo-ku tileset and never shows a ward twice", () => {
    const textured = tilesetsFor(scene, "textured");
    expect(textured).toHaveLength(scene.buildings.tilesets.length);
    expect(textured.map((t) => t.id)).toContain("01101_bldg_lod2");
    expect(textured.map((t) => t.id)).not.toContain("01101_bldg_lod2_no_texture");
    const wards = textured.map((t) => t.id.split("_")[0]);
    expect(new Set(wards).size).toBe(wards.length);
    // every other ward is unchanged
    const others = textured.filter((t) => t.id !== "01101_bldg_lod2");
    expect(others).toEqual(scene.buildings.tilesets.filter((t) => t.id !== "01101_bldg_lod2_no_texture"));
  });

  it("rejects a textured tileset that would duplicate or orphan a ward", () => {
    const unknown = clone(sceneConfig);
    unknown.buildings.textured_tilesets[0].replaces = "99999_bldg_lod2_no_texture";
    expect(() => parseScene(unknown)).toThrow(/unknown tileset/);
    const twice = clone(sceneConfig);
    twice.buildings.textured_tilesets.push(clone(twice.buildings.textured_tilesets[0]));
    expect(() => parseScene(twice)).toThrow(/replaced twice/);
  });
});
