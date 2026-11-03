# Roadmap & Scope

All features below are **planned** unless a merged PR and reproducible demonstration establish completion. No deadlines have been committed.

**How to execute the roadmap step by step:** [実作業ガイド / WORKFLOW.md](WORKFLOW.md) — starting actions, Claude Code instructions, GitHub branch/PR cycle, and stage-by-stage completion gates.

## P0 — Get a credible first 3D demo
| Order | Work | GitHub |
|---|---|---|
| 1 | Finalize research question, AOI, measurable acceptance criteria | [#4](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/4) |
| 1 | Confirm OSM/PLATEAU/3D asset/AI training rights before use | [#12](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/12) |
| 2 | Dev environment, tests, contributor documentation | [#5](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/5) |
| 3 | Download a bounded OSM graph and export GeoJSON | [#6](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/6) |
| 3 | Route contract and valid manual route fixture | [#7](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/7) |
| 4 | CesiumJS city/terrain + optional PLATEAU overlay | [#8](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/8) |
| 5 | Generic 3D car follows route with camera controls | [#9](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/9) |

**P0 demo definition:** Open a known, credited route in a 3D scene and follow a moving generic car across the course; no AI generation required.

## P1 — Automatic circuit generation & evaluation
- [#10](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/10): Valid closed-loop candidate generation over an OSM graph with reproducible random seed.
- [#11](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/11): Structured natural language preferences, feature metrics, baseline ranking, controlled comparisons.
- Expand geography only after end-to-end tests and meaningful data validation.

## P2 — Independent AI research
- [#13](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/13): If license and scope permit, distill candidate ranking from teacher labels into a smaller student; compare quality/latency/cost on held-out AOIs.
- Explicitly distinguish true model training from simply prompting a general-purpose LLM.

## Future (not thesis MVP commitments)
- **Rally Mode:** open-ended stages, road-surface properties, gradient / mountains / terrain, forest-road quality, specific rally camera/vehicle effects.
- **More creative edits:** route constraints, landmark priorities, manual segment adjustments, iterative regeneration.
- **Simulation integration:** physically modeled handling or export to driving simulators, only after investigating feasible formats and intellectual-property rights.
- **International reach:** multiple regions, data completeness differences, language/localization, global deployment.

## Proposed priority rule
Scientific baseline > beautiful demo > personalized AI ranking > distilled student > physically realistic racing game. Reprioritize only after recording the tradeoff in [DECISIONS.md](DECISIONS.md).
