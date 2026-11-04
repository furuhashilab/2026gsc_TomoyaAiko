# Roadmap & Scope

All features below are **planned** unless a merged PR and reproducible demonstration establish completion. No deadlines have been committed.

**How to execute the roadmap step by step:** [実作業ガイド / WORKFLOW.md](WORKFLOW.md) — starting actions, Claude Code instructions, GitHub branch/PR cycle, and stage-by-stage completion gates.

## Status (2026-11-04)
| Gate | Work | Status |
|---|---|---|
| A | #4 research scope / AOI (provisional), #12 rights | #4 open (provisional design merged), #12 open (OSM publication & terrain licence unresolved) |
| B | #5 dev env, #6 OSM graph, #7 course format, #8 3D city scene, #9 vehicle animation | #5–#8 merged; **#9 in review (PR #25)** |
| C | **#10 automatic circuit generation** | **next — top priority** |
| D | #11 preferences, features and evaluation | after #10 (design can start in parallel) |

## Realistic order from here
Research value comes from Gates C and D; presentation work must not delay them.

1. **Finish #9** (PR #25 review and merge). Gate B is then complete.
2. **#10 — automatic circuit generation (top priority).** Deterministic, seeded candidate generation on the Issue #6 graph, reusing the Issue #7 validator (one-ways, routability, inside-AOI edges only, closure, U-turns) and the notes recorded on #10. Baseline runtime and failure cases are part of the result.
3. **#11 — preferences, features and evaluation.** Feature definitions (length, straights, corners with the provisional thresholds of RESEARCH_DESIGN §5.2.1) and the rule-based baseline; human-evaluation design.
4. **In parallel, small:** #12 decisions that unblock work (OSM-derived course publication under ODbL, terrain licence) and, once decided, #32 (PR preview URLs).
5. **#27 — course annotations** (sectors, start/finish, corners, straights, elevation) as the shared data for display and video, defined together with #11 features. Minimal version only until Gate D.
6. **After Gate C/D results exist:** #26 (scene readability), then #28 (sector / broadcast-style UI).
7. **Future (presentation):** #29 course introduction video, #30 video export, #31 fictional race-event graphics (tyres, starting grid). Recorded only.

Conditional research: #13 distillation, only if rights, data and time allow (see D-0009).

## P0 — Get a credible first 3D demo
| Order | Work | GitHub |
|---|---|---|
| 1 | Finalize research question, AOI, measurable acceptance criteria | [#4](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/4) |
| 1 | Confirm OSM/PLATEAU/3D asset/AI training rights before use | [#12](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/12) |
| 2 | Dev environment, tests, contributor documentation | [#5](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/5) (done) |
| 3 | Download a bounded OSM graph and export GeoJSON | [#6](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/6) (done) |
| 3 | Route contract and valid manual route fixture | [#7](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/7) (done) |
| 4 | CesiumJS city/terrain + optional PLATEAU overlay | [#8](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/8) (done) |
| 5 | Generic 3D car follows route with camera controls | [#9](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/9) (in review) |

**P0 demo definition:** Open a known, credited route in a 3D scene and follow a moving generic car across the course; no AI generation required.

## P1 — Automatic circuit generation & evaluation
- [#10](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/10): Valid closed-loop candidate generation over an OSM graph with reproducible random seed.
- [#11](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/11): Structured natural language preferences, feature metrics, baseline ranking, controlled comparisons.
- Expand geography only after end-to-end tests and meaningful data validation.

## P2 — Independent AI research
- [#13](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/13): If license and scope permit, distill candidate ranking from teacher labels into a smaller student; compare quality/latency/cost on held-out AOIs.
- Explicitly distinguish true model training from simply prompting a general-purpose LLM.

## P2/P3 — Presentation and workflow (after Gates C/D unless noted)
| Work | GitHub | Priority | Depends on |
|---|---|---|---|
| Course annotations: sectors, start/finish, corners, straights, elevation, display time — reusable by UI and video | [#27](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/27) | P2 | #10, #11 |
| PR preview URLs (GitHub Pages); OSM-derived courses only after #12 decides | [#32](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/32) | P2 | #12 |
| 3D scene readability: base-map switching (low-label / aerial), building styling, course visibility, panel UX | [#26](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/26) | P2 | licence checks |
| Sector display and broadcast-style UI while driving (display time, no fake standings) | [#28](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/28) | P3 | #27 |

## Future — broadcast-style presentation (recorded, not scheduled)
| Work | GitHub | Depends on |
|---|---|---|
| Course introduction video (opening, layout draw, sectors, key straights/corners, start/finish; original music and graphics only) | [#29](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/29) | #27 |
| Video file export (MP4/WebM): recording, audio, CORS, burned-in attribution | [#30](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/30) | #29 |
| Fictional race-event graphics: tyre compounds, starting grid (multi-vehicle) | [#31](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/31) | multiple vehicles, #27, #30 |

**Principles for these items**
- They communicate GIS generation and evaluation results; they are not cosmetic F1 imitations. All numbers shown (length, corners, straights, sectors, elevation, start/finish, vehicle position and display time) come from the course data (#27), so screen and video use one source.
- No official F1/FIA/team/driver names, logos, music, broadcast graphics or tyre data. Fictional events are labelled as fictional; display time is labelled as non-physical; no standings are shown before a real ranking method exists.
- Minimise external and commercial dependencies; record provenance, licence and SHA-256 of every asset, and the update procedure, so lab members can maintain the work after handover.

## Future (not thesis MVP commitments)
- **Rally Mode:** open-ended stages, road-surface properties, gradient / mountains / terrain, forest-road quality, specific rally camera/vehicle effects.
- **More creative edits:** route constraints, landmark priorities, manual segment adjustments, iterative regeneration.
- **Simulation integration:** physically modeled handling or export to driving simulators, only after investigating feasible formats and intellectual-property rights.
- **International reach:** multiple regions, data completeness differences, language/localization, global deployment.

## Proposed priority rule
Scientific baseline > beautiful demo > personalized AI ranking > distilled student > physically realistic racing game. Reprioritize only after recording the tradeoff in [DECISIONS.md](DECISIONS.md).
