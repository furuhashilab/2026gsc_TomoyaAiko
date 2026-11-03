# CLAUDE.md — CircuitForge AI

Claude Code is the primary implementation assistant for this research project. Read `README.md`, `docs/RESEARCH_DESIGN.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, and `docs/DATA_AND_LICENSES.md` before nontrivial changes.

## Start here — practical work sequence
Read [docs/WORKFLOW.md](docs/WORKFLOW.md) before starting any new issue. It contains the actual step-by-step workflow, phase gates, owner responsibilities and the first Claude Code prompt. **Do not skip to distillation or implement multiple phases in one request.** For each task: read issue → propose a small plan → work on an issue-specific branch → test and report actual results → open PR → wait for human approval before merge.

## Mission and boundaries
- Build a research system for **fictional** motorsport routes from real geospatial data, initially an urban closed loop with OSM + optional PLATEAU 3D context.
- The **first executable milestone** is a manually selected route shown in CesiumJS, followed by an animated generic 3D vehicle and follow-camera. It is not an accurate racing simulator.
- Circuit Mode: closed loop. Future Rally Mode: typically point-to-point with gradient and road-surface features.
- Do not claim a working feature, trained model, safe race route, FIA-compliant circuit, or real-world road closure without evidence.
- Do not use official F1/WRC branding, proprietary circuit geometry, or vehicle designs/assets without verifying rights.

## Workflow
1. Read the corresponding GitHub Issue. If scope is unclear, write acceptance criteria and plan **before coding**.
2. For an individual issue, create a feature branch (e.g. `feat/issue-3-osm-graph`). Do **not** write directly to `main`.
3. Prefer the smallest testable increment. Keep GIS processing, candidate generation, and rendering loosely coupled.
4. Run checks and document commands + outcomes in PR; do not fabricate test results.
5. Open a PR linked with `Closes #N` only when requirements are satisfied; otherwise `Refs #N`. Never auto-merge without explicit human approval.
6. Prefer explainable algorithms and human-readable experiment logs; document failed attempts and unresolved research choices.
7. Avoid unrelated refactors, generated binary assets, huge map files, credentials, and raw AI training data in commits.

## Scientific guardrails
- Use WGS84 GeoJSON coordinates in **longitude, latitude** order; for lengths/distances use appropriate projected/geodesic calculations, not raw degree distances.
- Explicitly track road graph directionality, access limitations, AOI boundary, closed-loop validation, and missing OSM tags.
- Record OSM extraction date, dataset provenance, PLATEAU city/version, model IDs, evaluation prompts, random seed, and code version when running experiments.
- Validate data before training. Prevent overlap between train and test cities/segments as appropriate.
- Generative models may interpret preferences or rank candidates but must not invent GIS road connectivity.
- Distillation requires permission for training on teacher outputs and a measurable baseline. No such permission is assumed.
- Preserve attribution and follow licenses for OSM/PLATEAU/3D assets. Do not put branded GR Yaris assets in the repo without verifying the license.
- Any route is a fictional visualization, not a suggestion for driving on public roads.

## Collaboration
Lead: `@mapbytomoya` (2026gsc_TomoyaAiko seminar repository). ChatGPT helps research design; Codex can independently review. Treat recommendations from any assistant as proposals requiring verification, not as findings. If docs conflict, open an issue/PR clarifying the choice; update `docs/DECISIONS.md` for architectural decisions.

## Immediate tasks
See Issues #4–#13. Prioritize #4, #12, #5, #6/#7, then #8/#9. Work on a specific requested issue rather than implementing the full roadmap at once.
