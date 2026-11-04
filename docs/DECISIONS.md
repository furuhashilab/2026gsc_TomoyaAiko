# Decision Log

Records below capture **project direction**, not claims that software or research results already exist. Add entries with date, alternatives, rationale, outcome and follow-up Issue when an actual engineering or scientific decision is made.

## D-0001 — Creative geospatial motorsport design (2026-11-03)
**Status:** project direction. Focus on ideal racing-layout generation on actual geography, rather than winter pedestrian-route choice. F1-style street circuits are the starting inspiration; rally stages and mountain tracks remain future scope.

## D-0002 — City circuit first (2026-11-03)
**Status:** tentative. Start with a small urban PLATEAU-covered AOI to bound the thesis implementation. Pilot city not yet fixed; validate availability before choosing.

## D-0003 — OSM for topology, PLATEAU for 3D context (2026-11-03)
**Status:** provisional architecture. OSM graph handles road connectivity and access information; PLATEAU/terrain supplies 3D scene context. Validate coverage and licenses.

## D-0004 — Demo before advanced AI (2026-11-03)
**Status:** planned development order. First get a manual route + CesiumJS + moving generic car, then algorithmic loop generation, preference-aware ranking, and only then consider distilled student model. No model has been trained.

## D-0005 — Multi-agent development approach (2026-11-03)
**Status:** workflow preference. Claude Code primary implementation, ChatGPT assists research and planning, Codex optional independent verification. All changes by Issue / branch / PR, with human review before merging.

## D-0006 — User preference, scientific evaluation, and intellectual property (2026-11-03)
**Status:** guiding principles. Separate taste/entertainment from real-world racing feasibility. Record data/model rights; use objective constraints + human comparisons and reproducible baselines; treat trained AI as a research hypothesis, not a guaranteed result.

## D-0007 — Seminar repository consolidation (2026-11-04)
**Status:** decided. The canonical development and seminar repository is [`furuhashilab/2026gsc_TomoyaAiko`](https://github.com/furuhashilab/2026gsc_TomoyaAiko). CircuitForge AI replaces the earlier Sapporo winter pedestrian-route study as the main research theme. Original research records are preserved in [the study archive](archive/2026-sapporo-winter-walking.md); previous CircuitForge AI repository remains a historical source. See [MIGRATION.md](MIGRATION.md) for issue mapping and history limitations.

## D-0008 — Tentative pilot AOI: Sapporo center (2026-11-04)
**Status:** tentative (self-directed; to discuss at advisor meeting). **Alternatives considered:** Yokohama Naka-ku (2024 PLATEAU, LOD3 roads), Osaka Kita/Chuo-ku (2025, v5.0), Nagoya Naka-ku (2022), Tokyo 23-ku (2020). **Rationale:** the whole AOI has LOD1 buildings and the city-centre band has streamed LOD2; its grid layout and many one-way streets suit closed-loop generation and directed-graph validation; prior fieldwork familiarity. **Risks:** LOD2 (3.27 km², city centre + Kotoni) covers only 29.0% of AOI buildings (per-building `_lod` in 3D Tiles batch tables); 100 m grid cells where LOD2 is half or more of buildings cover ~2.10 km² (~35%) of the ~5.96 km² AOI, a grid approximation rather than exact area coverage; dataset is FY2020; OSM `width`/`access` tags absent in AOI (absence = unknown, not unrestricted). **Outcome:** AOI bbox `[141.335, 43.050, 141.365, 43.072]` (lon/lat, ~2.4 km square) kept; display policy LOD1 base + LOD2 where available (ward `lod2` tilesets already fall back to LOD1 per building); shrinking AOI to the LOD2 band is the alternative. Yokohama Naka-ku as hold-out candidate. Evidence (with pinned PLATEAU manifest and Overpass attic query): [evidence/issue-4/README.md](evidence/issue-4/README.md); see [RESEARCH_DESIGN.md §5.1.1](RESEARCH_DESIGN.md). **Follow-up:** mixed-LOD rendering check (#8), OSM extraction and tag check (#6), licenses (#12).

## D-0009 — Distillation (RQ3) kept as a deferred research goal (2026-11-04)
**Status:** pending. RQ3 is neither scheduled nor excluded for this year. Decide after RQ1/RQ2 progress and after confirming teacher-output training rights (#12, #13). Angle thresholds for RQ2 features (θ=10°, θ_c=45°, W=30 m) are hypothetical settings until sensitivity analysis (RESEARCH_DESIGN.md §5.2.1).

## D-0010 — OSM road graph: explicit direction/access rules over OSMnx defaults (2026-11-04)
**Status:** implemented in Issue #6 (pending review). **Decision:** OSMnx 2.1.1 builds and simplifies the graph, but direction and motor-car access are classified from raw tags in `gis/src/circuitforge_gis/rules.py` (OSMnx would treat `oneway=reversible/alternating` and unknown values as two-way, and `custom_filter` does not apply its drive access exclusions). Ways with an uncertain direction keep only their drawn-order edge and are non-routable; conditional, mode/direction-specific and unrecognised restrictions are flagged for review and non-routable; untagged access/oneway follow the OSM default with the basis recorded. The full graph is kept with weak (all edges) and strong (routable edges) component ids; boundary-crossing segments keep their first outside OSM node. Lengths use the AOI's `length_crs` (EPSG:6680 for Sapporo), refused when the AOI falls outside the CRS area of use; GeoJSON is EPSG:4326. Simplification keeps parallel edges (their end nodes are forced endpoints) and is verified one-to-one by per-edge `edge_uid`. Data is fetched with the Issue #4 pinned query (identical element hash). Service roads are excluded in the MVP profile, with a `drive-with-service` profile prepared. **Limitations:** turn restrictions not modelled; route generation (#10) must use only `aoi_status="inside"` routable edges and recompute SCCs on that subgraph; 22 trunk/primary/secondary ways are two-way only by OSM default and need checking before #10. Evidence: [evidence/issue-6/README.md](evidence/issue-6/README.md).
