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
