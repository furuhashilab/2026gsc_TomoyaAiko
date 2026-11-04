# Data, Licensing, Attribution & Safety Checklist

**Status: unverified checklist, not legal advice.** Confirm each source's CURRENT terms directly before use, publication, training, or distribution. Record source URL, publisher, license/version, verification date, permitted uses and obligations.

| Asset/data | Intended use | Questions before use |
|---|---|---|
| OpenStreetMap | Directed street graph, roadway tags | ODbL attribution, derivative database/sharing rules, geocoding/Overpass/tiles usage policy, extract date |
| Project PLATEAU | 3D city models, road/building geometry where available | Dataset-by-dataset terms, city/year/version, texture/third-party restrictions, hosting and attribution |
| Elevation/terrain | Terrain-aware visualizations | Source, vertical datum, resolution, accuracy, redistribution, regional coverage |
| CesiumJS / OSMnx / NetworkX | Code libraries | Current open-source license and required notices |
| Generic vehicle glTF/GLB | Animated route follower | Asset provenance, redistribution and allowed modifications; no unlicensed branded designs |
| F1 / WRC / circuit references | Inspiration for user preference labels | Avoid claiming endorsement, official FIA validation or rights to branded game content; no proprietary extracted game assets |
| Teacher-model output | Research dataset for future distillation | Provider's current terms governing output reuse/model training, institutional guidelines, dataset rights |
| User input / location | User-specified AOI/preferences | Avoid unnecessary personal data, limit logging, and do not publish private locations |

## 3D scene sources (Issue #8): buildings and terrain are licensed differently
| Source | Terms (as confirmed 2026-11-04) | Attribution shown | Status |
|---|---|---|---|
| PLATEAU building 3D Tiles (札幌市 2020年度, `assets.cms.plateau.reearth.io`) | 公共データ利用規約 第1.0版 (PDL1.0); PLATEAU site policy states compatibility with CC BY 4.0; copyright belongs to each municipality; processed outputs must say they were processed. Delivery is a trial service. | 「3D都市モデル（Project PLATEAU）札幌市（2020年度）」（国土交通省） | Confirmed from https://www.mlit.go.jp/plateau/site-policy/ . Used for display; the committed height sample (`docs/evidence/issue-8/buildings-base.json`) is labelled as processed. |
| PLATEAU-Terrain (`tile.plateauview.mlit.go.jp/terrain`) | Provider docs (https://docs.plateauview.mlit.go.jp/datasets/terrain/) require the attribution and describe a trial service with no guarantee; **no data licence is stated**. Mapterhorn and GSI are named as sources. | PLATEAU \| Mapterhorn \| 国土地理院 | **Unconfirmed** — do not assume PDL1.0 or any other licence. Only streamed for display; no terrain data is stored or redistributed. Open question recorded in #12. |
| GSI tiles (地理院タイル) | GSI terms, attribution required | 地理院タイル | Used since #5 |
| Vehicle model: Kenney Car Kit 3.1 `race.glb` (+ `Textures/colormap.png`) | CC0 1.0 (License.txt in the pack: personal, educational and commercial use; credit optional) | Credit optional; recorded in `config/vehicle.json` | Confirmed 2026-11-04 from https://kenney.nl/assets/car-kit and the shipped License.txt. Committed unmodified under `web/public/models/kenney-car-kit/` with SHA-256 checks; generic car, no real-world brand. |

## OSM-derived data in this repository (Issue #6)
- Raw Overpass responses and processed graphs/GeoJSON stay under `data/raw/` and `data/processed/` (gitignored); they are reproducible from the pinned query and attic date recorded in `docs/evidence/issue-6/manifest.json`.
- Exported GeoJSON carries `"attribution": "© OpenStreetMap contributors (ODbL 1.0)"`; any UI showing it must display OSM attribution.
- Processed outputs are a derivative database under ODbL. If they are ever published or redistributed, the ODbL share-alike and attribution obligations must be reviewed first (#12).
- Committed OSM-derived content is limited to small summaries (counts, hashes) and a hand-made test fixture that contains no OSM data.
- Course files (Issue #7) built from OSM are derivative data too: they are generated locally (e.g. `web/public/courses/`, gitignored) from committed recipes. Only synthetic course samples (no OSM content) are committed until #12 decides how OSM-derived samples may be published.

## Practical requirements
1. Add visible, appropriate OSM and PLATEAU attribution in the running UI.
2. Never commit API keys, account credentials, large downloaded datasets, third-party 3D models without redistribution permission, or private participant records.
3. Do not assume that public OSM roads are legally accessible to cars or that the full route can safely host motorsport.
4. This is a **fictional route design / visualization tool**, not a road-closure plan, road-racing instruction, or FIA-compliant track certification.
5. Record which geographic attributes are unavailable; distinguish “unknown” from “valid”.
6. Before distributing source code, discuss a repository-level LICENSE with the lab. In the absence of a license file, no general open-source license is granted.
7. Use openly licensed/test fixtures where possible; keep geospatial preprocessing deterministic and documented.

## First review task
Issue [#12](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/12): populate a verified version of the above matrix with authoritative URLs, attribution wording, data provenance, current policy links, and a proposed code-license decision.
