# Proposed Architecture (not yet implemented)

## Functional pipeline

```text
User: area of interest + route type + preferences
                   |
            OSM data adapter --------- PLATEAU 3D Tiles / terrain
                   |                              |
    directed road graph / metadata                |
                   |                              |
        candidate route generator                 |
                   |                              |
       constraint validation & metrics             |
                   |                              |
       preference ranking (rules first)            |
                   |                              |
       [future teacher/student evaluator]          |
                   |                              |
           GeoJSON + provenance -------------------+
                   |
        CesiumJS 3D visualization
                   |
      route polyline + animated 3D vehicle
        chase / onboard / aerial camera
```

## Components (proposals)
- **gis-core (Python):** bounded OSM acquisition, graph construction, road metadata, direction/access, candidate route generator, validators, features.
- **web (TypeScript / CesiumJS):** region and preference input, route visualization, PLATEAU/terrain scenes, vehicle interpolation and camera.
- **contracts:** documented GeoJSON schema with versioned properties and sample fixtures.
- **experiments (later):** evaluation dataset, baselines, teacher labels (if permitted), training and inference, result plots.

Actual folders and package choices are decided in Issue #5; these names are conceptual.

## Course contract (decided v0.1.0, Issue #7)
**Status:** decided (D-0011). Schema: [`contracts/course.schema.json`](../contracts/course.schema.json); spec and examples: [`contracts/README.md`](../contracts/README.md).

- One GeoJSON `Feature` (RFC 7946, WGS84 `[longitude, latitude]`) per course, file extension `.course.geojson`. An optional third coordinate is reserved for elevation (not produced yet).
- **Source of truth:** `properties.segments`, the ordered list of directed OSM segments. Each segment is `{edge_uid, way_id, from_node, to_node}` with `edge_uid = way_id:segment_index:f|r` (index of the segment in the way's node list; `f` = drawn order, `r` = against it). This is the same id the road graph uses (Issue #6), so parallel segments between the same nodes stay distinct and simplified graph edges expand back to their ordered raw segments.
- `geometry` and `length_m` are derived from the segments (length in the AOI's `length_crs`) and re-checked by the validator.
- City-specific data lives only in `aoi` (id, bbox, `length_crs`) and `osm_snapshot` (attic date, element hash, profile), so the format is not tied to Sapporo; any AOI with a suitable projected CRS can be used.
- `mode`: `circuit` (graph-closed loop: last `to_node` = first `from_node`) or `rally` (start ≠ finish).
- `authoring` records how the course was made (`manual-via-points` with the shortest-path completion rule, or `manual-segments`). Shortest-path completion is an authoring aid only; preference-aware generation is Issue #10+.
- `validation` is written by `cf-course` for display; readers must not trust it without re-validating.

**Validation (`uv run cf-course validate`, gis/src/circuitforge_gis/course.py):** the graph is rebuilt from the trusted AOI config, not from the course's own metadata; schema; length CRS suits the AOI and equals the CRS the graph lengths were computed in; course AOI equals the trusted AOI; OSM snapshot hash matches the graph; every segment exists in that direction (one-way), is routable (Issue #6 direction/access/review rules) and lies inside the AOI; continuity; circuit closure / rally ends; no repeated segment or U-turn (for circuits including the closing join from the last to the first segment); geometry and length match the segments. Warnings: junction revisits, segments driven in both directions, major roads two-way only by OSM default, length outside the preferred range, no elevation, turn restrictions not evaluated.

For Circuit Mode, closure is checked on the graph, not by coordinate proximity. Don't smooth corners in a way that invents roads.

## 3D scene (Issue #8)
**Status:** implemented (D-0012). Sources are described in `config/scene.<aoi>.json` (written by `uv run cf-scene build`), not in code: terrain URL/format/attribution/licence status and a `layer.json` snapshot (SHA-256, version, retrieval time); building tilesets with PLATEAU dataset ids, year, spec, `tileset.json` SHA-256 and attribution.

- **Terrain:** PLATEAU-Terrain quantized-mesh via `CesiumTerrainProvider.fromUrl` (no Cesium ion). Heights are ellipsoidal, matching the ellipsoidal heights of PLATEAU 3D Tiles geometry. The viewer checks `layer.json` (format) and one sampled height before using it, because CesiumJS otherwise treats a missing `layer.json` as a legacy heightmap server.
- **Buildings:** per ward the PLATEAU `bldg_lod2_no_texture` tileset (falls back to LOD1 per building), else `bldg_lod1`. Buildings are shown **only on top of the PLATEAU terrain**; if terrain fails (at start or later via tile errors) they are removed and the viewer keeps the map and course only, so buildings never float ~50 m above an ellipsoid.
- **Course:** draped on terrain (`clampToGround`, `classificationType: TERRAIN`); direction arrows are ground-clamped billboards rotated to the travel bearing; START/FINISH is ground-clamped.
- **Attribution:** terrain `PLATEAU | Mapterhorn | 国土地理院`, buildings `「3D都市モデル（Project PLATEAU）…」（国土交通省）`, GSI tiles, OSM (course panel).
- **Verification:** building base vs terrain height on a deterministic grid sample (`cf-scene sample-buildings`, `web/tools/height-check.html`), recorded in `docs/evidence/issue-8/`. Re-run after any provider change (`cf-scene check`).

## Vehicle animation (Issue #9)
**Status:** implemented (D-0013). Visualisation of a route, not vehicle dynamics.
- `config/vehicle.json`: model URI, provenance, licence (CC0 Kenney Car Kit `race.glb`, unmodified) and SHA-256 of every shipped file; dimensions, scale, forward axis, heading offset, ground offset; animation settings (heading/pitch window, terrain sample step, base display speed, playback multipliers); camera settings.
- `web/src/vehicle/track.ts` (no CesiumJS): position by linear interpolation on the course polyline (stays on the centre line), chord heading over a window, terrain heights sampled every `terrain_sample_step_m` and interpolated, pitch from height differences; loops for circuits, stops for rallies. City-independent: only the course, scene and vehicle configs are inputs.
- `web/src/vehicle/animation.ts`: model entity driven by the viewer clock; play / pause / reset / speed; chase, onboard-like (ahead of the nose; the model has no cockpit) and aerial cameras plus free camera. Without terrain the vehicle runs on the ellipsoid like the course line.
- Model loading: pre-flight check that the GLB and its external texture can be fetched (`model-check.ts`); on failure or a model error a simple box vehicle is shown with the reason, and the animation continues. Slow loading is not treated as failure.
- Async loads (course file, terrain sampling, model) are tagged with a generation id (`latest.ts`); results of superseded loads are discarded.
- Checks: `web/tools/vehicle-check.html` (terrain-step cost/error, grounding, heading) recorded in `docs/evidence/issue-9/`.

## Visualization details
Initial animation can sample positions along the route and orient a generic glTF/GLB vehicle model with a stable camera target. Interpolation speed is illustrative, not physically simulated. Support playback, pause, reset, speed adjustment, chase/onboard/aerial perspectives, and fallback when 3D data is unavailable.

## Nonfunctional requirements
- Reproducible inputs, small fixtures, meaningful error messages, no hidden network dependencies in unit tests.
- Separate baseline pipeline from AI models to enable ablation studies.
- No secrets or restricted model/asset data in source control.
- Credits/attribution for OSM, PLATEAU and licensed assets in UI and documentation.

## Open architecture questions
Hosted 3D Tiles vs local preprocessing; runtime/costs of AOI acquisition; projected CRS choice; exact persistence format; surface/width completeness; client/server boundary; licensing; eventual engine exports.
