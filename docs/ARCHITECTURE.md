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

**Validation (`uv run cf-course validate`, gis/src/circuitforge_gis/course.py):** schema; length CRS suits the AOI; OSM snapshot hash matches the graph; every segment exists in that direction (one-way), is routable (Issue #6 direction/access/review rules) and lies inside the AOI; continuity; circuit closure / rally ends; no repeated segment or U-turn; geometry and length match the segments. Warnings: junction revisits, segments driven in both directions, major roads two-way only by OSM default, length outside the preferred range, no elevation, turn restrictions not evaluated.

For Circuit Mode, closure is checked on the graph, not by coordinate proximity. Don't smooth corners in a way that invents roads.

## Visualization details
Initial animation can sample positions along the route and orient a generic glTF/GLB vehicle model with a stable camera target. Interpolation speed is illustrative, not physically simulated. Support playback, pause, reset, speed adjustment, chase/onboard/aerial perspectives, and fallback when 3D data is unavailable.

## Nonfunctional requirements
- Reproducible inputs, small fixtures, meaningful error messages, no hidden network dependencies in unit tests.
- Separate baseline pipeline from AI models to enable ablation studies.
- No secrets or restricted model/asset data in source control.
- Credits/attribution for OSM, PLATEAU and licensed assets in UI and documentation.

## Open architecture questions
Hosted 3D Tiles vs local preprocessing; runtime/costs of AOI acquisition; projected CRS choice; exact persistence format; surface/width completeness; client/server boundary; licensing; eventual engine exports.
