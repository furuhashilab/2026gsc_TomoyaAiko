# Research Design / 研究計画（草案）

**Updated:** 2026-11-04 · **Status:** proposal. Self-directed; open points are reviewed with the advisor at meetings (see [RESEARCH_SUMMARY_JA.md](RESEARCH_SUMMARY_JA.md)).

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
First study: one PLATEAU-covered urban AOI and one small fixed OSM extract (tentatively **Sapporo center**, see §5.1; Yokohama Naka-ku as hold-out candidate). Generate Circuit Mode closed loops. Manual-route 3D visualization precedes automated candidate generation. Actual track design, safety review, road closure feasibility and physics simulation are excluded. Rally Mode with point-to-point mountain roads is an expansion.

### 5.1 対象都市・AOIの比較（2026-11-04 調査、暫定）

**出典：** [G空間情報センター PLATEAU データカタログ](https://www.geospatial.jp/ckan/dataset?q=PLATEAU)（CKAN API `package_show`）と [PLATEAU 配信サービスのデータカタログ API](https://api.plateauview.mlit.go.jp/datacatalog/plateau-datasets)。いずれも 2026-11-04 に取得。PLATEAU 配信サービスは**試験運用**で、提供期間は保証されていない（[公式チュートリアル](https://www.mlit.go.jp/plateau/learning/tpc06-1/)）。

| 候補 | PLATEAU 年度 / 仕様 | 中心部の建築物 3D Tiles（配信） | 道路モデル | LOD2 範囲 | 評価 |
|---|---|---|---|---|---|
| **札幌市 中央区** | 2020年度 / 仕様書 v4.1 対応版あり | LOD1・LOD2（テクスチャあり／なし） | LOD0・1（MVT） | 3.27 km²（都心部＋琴似） | **第1候補** |
| 横浜市 中区 | 2024年度 / v4.1 | LOD1〜3 | LOD0・1・3（3D Tiles あり） | 未確認 | **ホールドアウト候補** |
| 大阪市 北区・中央区 | 2025年度 / v5.0 | LOD1〜3 | LOD1・2・3.2 | 未確認 | 予備 |
| 名古屋市 中区 | 2022年度 / v4.1 | LOD1・2 | LOD1 | 未確認 | 予備 |
| 東京都23区 | 2020年度（新しい年度は未確認） | LOD1 は全域、LOD2 は都心など 32 km² | 未確認 | 32.02 km² | 交通量が多く比較対象にしにくい |

**札幌を第1候補とする理由**
- 碁盤目状の道路網なので、長い直線と直角コーナーの組み合わせが多い。周回路の生成と「直線重視／テクニカル重視」の比較（RQ2）で、特徴量の差が出やすいと予想される。これは**仮説で、未検証**。
- 都心部に LOD2 の建物があり、AOI 全体は LOD1 でカバーされている。そのため Gate B のデモに必要な 3D 表示ができる見込み（§5.1.1）。
- 一方通行が多い地区なので、有向グラフの扱い（RQ1）を検証する題材になる。`oneway` タグは AOI 内の way の 38% に付いている。
- 前の研究テーマ（札幌都心の歩行者経路）で土地勘と既存資料がある。

**注意点・未確認事項**
- 札幌のデータは 2020年度の整備で、横浜・大阪より道路モデルの LOD が低い。道路の接続は OSM で扱う方針（D-0003）なので、MVP では問題にならない見込み。
- PLATEAU の利用条件は [PLATEAU Site Policy](https://www.mlit.go.jp/plateau/site-policy/) による（カタログ上の表記）。詳細は Issue #12 で確認する。
- AOI 内の OSM の way で、`width` と `access` のタグは 0% だった。道幅による制約は今の OSM データだけでは扱えない。詳しい検証は Issue #6 で行う。

#### 5.1.1 LOD2 の実際の範囲と AOI のカバー率（2026-11-04 測定）
手順・コマンド・出力は [evidence/issue-4/README.md](evidence/issue-4/README.md) に記録した。

- **AOI（約 5.96 km²）のうち、LOD2 の建物がある範囲は一部だけ。** AOI 内の建物 7,138 棟のうち、実際に LOD2 なのは 2,070 棟（**29.0%**）。100 m メッシュで見ると、建物があるメッシュの 36.7%、AOI 全体の面積の 34.4%（約 2.15 km²）で LOD2 の建物が過半数を占める。
- **場所：** LOD2 は札幌駅〜大通〜すすきのの帯（lon 141.339–141.365、lat 43.056–43.072）に集まる。すすきのより南と AOI の西側は LOD1 だけ。
- **気をつける点：** PLATEAU の `lod2` タイルセットには、LOD2 モデルがない建物の LOD1 形状も入っている。そのため、タイルセットがある範囲を LOD2 の範囲とみなしてはいけない。建物ごとの `_lod` 属性で区別する。

**表示の方針（案）：LOD1 を基本にして、LOD2 がある部分だけ高精細に表示する**
- 中央区・北区・東区は `lod2` タイルセットを使う。LOD2 がない建物は、`_lod`=1 の形状として同じタイルセットに入っているので、結果として LOD1 と LOD2 が混ざった表示になる。豊平区（AOI 内 90 棟）は `lod1` タイルセットを使う。
- AOI は変えない。周回路の生成は OSM の道路グラフで行い、建物の LOD には左右されない（D-0003）。LOD2 の範囲に合わせて AOI を狭めると候補ルートが減り、RQ1 の多様性の評価が弱くなる。
- ルートごとに「LOD2 区間の割合」を**表示用のメタデータ**として記録する。これは RQ1・RQ2 の評価指標には含めない。
- デモ用のルート（Gate B）は、LOD2 の帯を通るように選ぶ。
- **別案：** AOI を LOD2 の帯（約 2.1 × 1.8 km）に縮める。3〜5 km の周回は入るが、候補が減る。CesiumJS での見え方を Issue #8 で確かめてから判断する。

**暫定 AOI（札幌中心部、約 2.4 km 四方）**
- bbox（WGS84, lon/lat）：`[141.335, 43.050, 141.365, 43.072]`
- 札幌駅・大通公園・すすきのを含む。大きさは cos 43° を使った概算で、Issue #6 で投影座標系を使って測り直す。
- 目標コース長 3〜5 km の周回路が、この中に十分に入る見込み。

### 5.2 評価指標（暫定定義）

RQ1（生成できるか）
| 指標 | 定義 |
|---|---|
| 有効周回率 | 検証を通った周回路の数 ÷ 生成を試みた回数 |
| 距離誤差 | \|L − L_target\| ÷ L_target（L は測地線または投影座標で計算した全長） |
| 辺の重複率 | 同じ道路辺を 2 回以上通る区間の長さ ÷ 全長（Circuit Mode では 0 を目標） |
| 方向制約違反 | 一方通行を逆走する辺の数（有向グラフで 0 にする） |
| 失敗理由の内訳 | 閉じない、長さが範囲外、AOI 外に出る、などの件数 |
| 計算時間 | 候補 1 本あたりの生成時間（環境と seed を記録） |

RQ2（好みで変わるか）
| 指標 | 定義 |
|---|---|
| 最長直線 | 進行方向の変化が θ 未満で続く区間の最長距離（θ=10° は仮説上の設定） |
| コーナー密度 | 1 km あたりの、距離 W 以内の向きの変化の合計が θ_c 以上になる回数（θ_c=45°、W=30 m は仮説上の設定） |
| 候補の多様性 | 候補どうしの辺集合の Jaccard 距離の平均 |
| 好みの効果 | 「直線重視」「テクニカル重視」の条件で、上の特徴量がベースラインと比べて指定した方向に動くか（効果量で示す） |
| 人による評価 | 少人数で行うブラインドの一対比較。手順は実施前に決める |

#### 5.2.1 角度しきい値と OSM の頂点密度（2026-11-04 予備調査）
**θ=10°、θ_c=45°、W=30 m は、根拠のある値ではなく仮説上の設定。** 最終的な値は Issue #10・#11 で、生成したルートを使って感度分析をしてから決める。AOI の OSM で予備的に調べた結果は次のとおり（[evidence/issue-4/README.md §2](evidence/issue-4/README.md)）。

- **頂点の間隔がばらつく：** 中央値 14.3 m、下位 10% は 6.0 m 以下、上位 10% は 96.5 m 以上。緩やかなカーブは、小さな角度の頂点が続く形で描かれる。1 頂点ごとに判定すると、θ_c=60° のときコーナー数が点の打ち方によって最大 3 倍変わった（1 km あたり 0.09／0.03／0.06）。
- **距離の窓で判定すると安定する：** W=30 m の窓で判定すると、生データと 5 m 打ち直しの差は 1 km あたり 0.02 以下だった。**コーナー指標は、ルートを一定間隔（例：5 m）に打ち直したうえで、距離の窓で判定する方式にする。**
- **コーナーはほぼ交差点で起きる：** way の内部の頂点の 90.0% は曲がりが 5° 未満だった。碁盤目の街区では、コーナーは way と way のつなぎ目で起きる。そのため指標は、way 単位ではなく**つないだ後のルート全体の線**で計算する。
- **直線のしきい値 θ：** θ=10° と 15° では最長直線の中央値が変わらなかった（305 m）。θ=5° だと OSM の細かな描き方の揺れで直線が途切れ、277 m になった。θ は 10° 前後で比較的安定していると見られる。
- **道路の形が影響する点：** 中央分離帯のある道路は 2 本の一方通行の way として描かれることがあり、二重に数える原因になる。また、交差点の角を丸めた描き方（隅切り）は、コーナーの角度を小さく見せる可能性がある。
- **今後の感度分析の範囲：** θ ∈ {5, 10, 15}°、θ_c ∈ {30, 45, 60}°、W ∈ {20, 30, 50} m、打ち直し間隔 ∈ {生データ, 5, 10} m。指標の順位がしきい値によって入れ替わるかどうかを報告する。

### 5.3 ゼミ論の成果物（案）
- **最低ライン：** Gate B（手動ルートの 3D 表示と車両の追走デモ）が再現できる状態と、AOI・データの出典の記録。
- **目標：** Gate C（周回路の自動生成）と、RQ1 の指標の初期結果（ベースラインとの比較）。
- **余裕があれば：** RQ2 の予備的な比較。
- **追加の研究目標（保留）：** 蒸留（RQ3）は、今年度の対象から外すとは決めず、保留にする。RQ1・RQ2 の進み具合と、教師モデルの出力を学習に使えるかどうかの利用条件（Issue #12・#13）を確認してから判断する。

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
- Thesis question wording, actual deadline, and seminar/degree requirements (discuss at advisor meeting).
- Pilot city and AOI are tentative (§5.1). LOD2 covers only ~29% of AOI buildings (§5.1.1); LOD1-base + LOD2-where-available display to be confirmed in Issue #8. OSM tag quality check in Issue #6. Compute budget.
- Angle thresholds (θ, θ_c, W) are hypothetical settings pending sensitivity analysis (§5.2.1).
- Which metrics best match perceived circuit quality; human evaluation sampling and ethics.
- Whether model distillation will fit the thesis timeline.

Track decisions in [DECISIONS.md](DECISIONS.md) and work in the linked Issues.
