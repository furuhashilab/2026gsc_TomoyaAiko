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

## Route contract (proposal v0, subject to Issue #7)
Use WGS84 GeoJSON `Feature` with a `LineString` of `[longitude, latitude]` positions. An optional third coordinate is elevation in meters, with vertical datum recorded separately. Include `properties`:
- `schema_version`: e.g. `0.1.0`
- `mode`: `circuit` or `rally`
- `source`: OSM extract date/source and provenance identifier
- `length_m`: calculated using a suitable projected/geodesic method
- `preferences`: explicit desired characteristics
- `warnings`: missing road data, restrictions, missing elevation etc.
- `road_edge_ids`: optional references used to reproduce connectivity and alignment.

For Circuit Mode, inspect graph-loop closure, not only whether the first and last coordinates are numerically close. For Rally Mode, use point-to-point paths with appropriate start/finish metadata. Don't smooth corners in a way that invents roads.

## Visualization details
Initial animation can sample positions along the route and orient a generic glTF/GLB vehicle model with a stable camera target. Interpolation speed is illustrative, not physically simulated. Support playback, pause, reset, speed adjustment, chase/onboard/aerial perspectives, and fallback when 3D data is unavailable.

## Nonfunctional requirements
- Reproducible inputs, small fixtures, meaningful error messages, no hidden network dependencies in unit tests.
- Separate baseline pipeline from AI models to enable ablation studies.
- No secrets or restricted model/asset data in source control.
- Credits/attribution for OSM, PLATEAU and licensed assets in UI and documentation.

## Open architecture questions
Hosted 3D Tiles vs local preprocessing; runtime/costs of AOI acquisition; projected CRS choice; exact persistence format; surface/width completeness; client/server boundary; licensing; eventual engine exports.
