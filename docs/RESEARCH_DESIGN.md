# Research Design / 研究計画（草案）

**Updated:** 2026-11-03 · **Status:** proposal; advisor approval pending.

## 1. Motivation
GIS is often applied to routing efficiency, hazard management, and urban analysis. This project instead explores geospatial **creative design**: can a user describe their ideal motorsport circuit and have a system propose routes on actual city roads, with a 3D preview? Inspired by F1-style street circuits, with future rally stages in mountains.

## 2. Provisional objective
Develop and evaluate a reproducible workflow for creating **fictional, user-preference-aware motorsport layouts** from real road networks. Research contributions should focus on (a) geospatial constraints/route feasibility as a graph, (b) preference-aware candidate ranking, and potentially (c) whether knowledge distillation can approximate larger-model rankings.

## 3. Research questions
- **RQ1:** Can we generate a range of connected, closed-loop route candidates of a desired approximate length from OSM, while respecting defined graph constraints?
- **RQ2:** Do preferences such as long straights or technical corner sequences produce measurably different, preferred routes compared with a baseline?
- **RQ3 (conditional, later):** With legally usable teacher rankings, can a smaller student model achieve comparable human preference alignment at reduced inference cost?
- **RQ4 (demonstration):** Can PLATEAU + CesiumJS support clear 3D review and animated route-following? The viewer alone is a prototype deliverable, not necessarily the research novelty.

## 4. Hypotheses (to refine)
- H1: Constraint-aware graph search achieves higher valid-loop rates than naive random routing.
- H2: Structured feature-based ranking changes route properties in the requested directions.
- H3: Distilled rankings outperform a feature-only baseline on held-out areas; **not presumed true**, and only attempted if resources/rights allow.

## 5. Study scope
First study: one PLATEAU-covered urban AOI and one small fixed OSM extract (city **not yet fixed**; Sapporo center is a candidate). Generate Circuit Mode closed loops. Manual-route 3D visualization precedes automated candidate generation. Actual track design, safety review, road closure feasibility and physics simulation are excluded. Rally Mode with point-to-point mountain roads is an expansion.

## 6. Proposed experiment
1. Document AOI, data source/version, mapping/tag coverage, software versions, and seed.
2. Construct a directed road graph; handle access/oneways; label uncertain tags.
3. Generate a baseline route set (rule-based/random-with-validation), then constraint-aware candidates.
4. Calculate features: length error, segment connectivity, direction constraints, longest straight proxy, turn/corner proxies, elevation if available, route diversity, failure rate, and runtime.
5. Compare ranking methods: explicit weighted features vs. optional teacher model vs. optional distilled student.
6. Hold out other AOIs/cities when available; do not evaluate only on the same roads used for tuning.
7. Conduct a small blind human preference study (criteria and participant information defined in advance).
8. Publish reproducible code, nonrestricted demo fixtures, analysis scripts, and limitations.

## 7. Evaluation caveats
- OSM contains missing/inconsistent access, surface, width, and turn-related tags.
- Polygon or visually attractive course layout != legally/safely usable race venue.
- Corner severity based on discrete OSM nodes is an approximation; simplify/smooth carefully without moving a route off a valid roadway.
- A language model's subjective ranking is not a ground-truth safety or quality label.
- Avoid label leakage, cherry-picked examples, and exaggerated generalizability.

## 8. Deliverables
- A small reproducible pipeline: AOI → OSM directed graph → candidate route GeoJSON → validators/features → ranking → 3D Cesium viewer.
- At least one working route-following demo; experimental results with baselines.
- Clearly documented rights, known limitations, versioned data provenance, and a written research report.

## 9. Decisions pending
- Advisor-approved thesis question, actual deadline, and degree requirements.
- Pilot city, AOI bounds, PLATEAU dataset availability/version, compute budget.
- Which metrics best match perceived circuit quality; human evaluation sampling and ethics.
- Whether model distillation will fit the thesis timeline.

Track decisions in [DECISIONS.md](DECISIONS.md) and work in the linked Issues.
