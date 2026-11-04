# Issue #6 OSM 道路グラフの検証記録（2026-11-04）

[Issue #6](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/6) で作った道路グラフ処理（`gis/`、コマンド `cf-osm`）について、札幌の実データで検証した結果を記録する。元データと加工後のデータ（`data/raw/`、`data/processed/`）は `.gitignore` の対象で、コミットしていない。

| ファイル | 内容 |
|---|---|
| [manifest.json](manifest.json) | 取得条件（クエリ、時点、AOI、プロファイル、要素数、要素ハッシュ） |
| [audit.md](audit.md) / [audit.json](audit.json) | 属性の点検・AOI での切り取り・連結成分・簡略化の検証の結果 |

```bash
cd gis
uv sync
uv run cf-osm --refetch          # 取得 → グラフ化 → 点検 → GeoJSON 出力（data/ に保存）
uv run pytest                    # オフラインのテスト（CI と同じ）
uv run pytest -m network         # Overpass から実データを取得し、#4 と同じデータかを確認する
```

## 1. Issue #4 のデータ取得条件の引き継ぎ
| 項目 | Issue #4 | Issue #6 | 差異 |
|---|---|---|---|
| クエリ | `docs/evidence/issue-4/overpass_query.overpassql` | `build_query()` で生成 | **なし**。生成したクエリが #4 のファイルと 1 文字も違わないことをテストで確認している（`test_query_is_identical_to_issue4_evidence`） |
| エンドポイント・時点 | overpass-api.de、`[date:"2026-11-03T16:25:05Z"]` | 同じ | なし |
| 取得したデータ | ノード 4,502、way 630、要素ハッシュ `c2eed5dd2b6d397a…` | 2026-11-04 に取り直して**一致**（`pytest -m network` と `cf-osm --refetch`） | なし |
| 取得方法 | curl | Python 標準ライブラリで POST | 中身は同じ。OSMnx 標準の取得（`graph_from_bbox`、ポリゴンによるクエリ）は**使っていない**。#4 と同じクエリを固定して使うため |
| AOI 境界での切り取り | AOI 外の頂点を落とし、way をそこで分割 | 境界をまたぐ区間は、AOI 外の最初の OSM ノードまで残す | **あり**。そのため長さの合計は #4（way 単位の片方向の長さ 118.4 km）と #6（有向辺の合計 199.7 km。双方向の道は 2 回数える）で直接比べられない |
| 距離の計算 | AOI の中心で接する平面座標で近似 | AOI 設定の `length_crs`（札幌は EPSG:6680、JGD2011 平面直角座標系 第XII系） | **あり**。#6 のほうが正確（§4）。座標系の適用範囲外の AOI はエラーにする（§4） |

## 2. 通行方向とアクセス制限の扱い（`gis/src/circuitforge_gis/rules.py`）
OSMnx 2.1.1 の標準の判定は、`oneway` の値が {yes, true, 1, -1, reverse, T, F} 以外なら**双方向として扱う**（`reversible`・`alternating`・入力ミスも双方向になる。`osmnx/graph.py` の `_is_path_one_way` で確認）。また、`custom_filter` を使うと、標準の drive ネットワークのアクセス除外条件は自動では適用されない。

そこで OSMnx には向きを判定させず（`settings.all_oneway=True` で各 way を 1 回だけ追加させる）、すべての way を元のタグから自前で分類し、その分類に従って辺を作り直している。

| 区分 | 条件 | 辺の作り方 | 経路探索に使うか |
|---|---|---|---|
| forward | `oneway=yes/true/1`、または oneway タグがなく `junction=roundabout/circular` か `highway=motorway` | 描かれた向きの辺だけ | 使う |
| reverse | `oneway=-1/reverse` | 描かれた向きと逆の辺だけ | 使う |
| both | `oneway=no/false/0`、または oneway タグなし（OSM の既定値は双方向） | 両方向 | 使う（判定の根拠を `direction_source` に記録） |
| **uncertain** | `oneway=reversible/alternating`、想定外の値（`yes;no`・`T` など）、oneway タグのない `motorway_link` | **描かれた向きの辺だけ。逆向きの辺は作らない** | **使わない**（`routable=false`） |

**アクセス制限：** 自動車について、`motorcar` > `motor_vehicle` > `vehicle` > `access` の順に、最も具体的なキーで判定する。
- `yes/permissive/designated` は allowed（通行可）、`no/private` は restricted（通行不可）。
- `destination`・`permit` など、それ以外の値は needs_review（要確認）とし、経路探索に使わない。
- どのキーもない場合は untagged とし、**「制限なし」ではなく、OSM の既定値に基づくもの**として記録する。経路探索には使う。

**要確認として記録し、経路探索に使わないもの：**
- `access:conditional`・`motor_vehicle:conditional`・`motorcar:conditional`・`vehicle:conditional`・`oneway:conditional`
- 方向別の指定（`motor_vehicle:forward` など）や、交通手段別の oneway 指定（`oneway:motorcar` など）
- `area=yes`

自転車・バスなど、ほかの交通手段だけに関するキー（`oneway:bicycle` など）は自動車に影響しないので無視する。

**対象外（限界）：** 右左折の禁止（turn restriction の relation）は扱っていない。

## 3. 札幌の実データでの結果（[audit.md](audit.md)）
- **way 630 本の内訳：**
  - 向き：forward 235（`oneway=yes`）、both 395（うちタグなしで既定値によるもの 392）、reverse 0、uncertain 0
  - アクセス：untagged 628、restricted 2（`access=no`：札幌停車場線などの 2 本）。条件付き制限などの要確認タグは 0
- **OSM の既定値で双方向としている way の道路種別：** tertiary 183、residential 155、unclassified 25、**trunk 17、secondary 7、primary 5**。幹線道路でタグが欠けている中央分離帯付きの道路が含まれている可能性があり、#10 で周回路を作る前に確認が必要。
- **タグの欠損率：** `maxspeed` 86%、`width` 99.8%、`lanes` 47%、`surface` 44%、`name` 59%。値の書式の誤り（数値でない `lanes`・`maxspeed`）や複数値は 0 件。
- **AOI での切り取り：** AOI 内のノード 3,112、境界の外側に残したノード 108、境界をまたぐ辺 198、両端が AOI 外で AOI の角を横切る区間 0。
- **連結成分：** 弱連結成分 4（最大 3,195 ノード）。経路探索に使える辺での強連結成分は 2 ノード以上のものが 6 で、最大の成分が使える辺の総延長の 96.9% を占める。
- **グラフ：** 簡略化前は 3,220 ノード・6,017 辺、簡略化後は 995 ノード・2,517 辺。一方通行の袋小路 0、行き止まりの道の端 16、自己ループ 0。

## 4. 簡略化の検証と距離の照合
**並行する辺の扱い：** OSMnx 2.1.1 の `simplify_graph` は、中間ノードどうしの間に辺が複数あると、**最初の 1 本だけを残し、残りは警告を出して捨てる**（`osmnx/simplification.py` で確認）。同じ道路が重複して描かれている場合などに起こる。対策として、並行する辺の両端のノードに `parallel_edge_endpoint` の印を付け、`node_attrs_include` で必ず端点として扱わせている。こうすると、並行する辺は統合されずに全部残る。札幌の AOI では該当するノードは 0 個だったが、テストデータには重複して描いた一方通行の way 2 本を入れて確認している。

**照合の方法：** 元の有向辺にはそれぞれ一意の識別子 `edge_uid`（way の ID、両端のノード、同じ区間での通し番号）を付ける。簡略化のときは `edge_attr_aggs` で、統合した順番どおりのリストとして引き継ぐ。`verify_simplification` は、この識別子で元の辺と簡略化後の辺を**一対一で**照合する（辺の数やノードの組で比べるだけでは、並行する辺が抜けても重複と打ち消し合って見逃す可能性があるため）。札幌の実データでも、テストデータでも、**問題は 0 件**だった。

- **一対一の対応：** 元の 6,017 辺の識別子が、簡略化後の辺にちょうど 1 回ずつ現れること（抜け 0、重複 0）。各識別子の両端が `merged_edges` の区間と順番どおりに一致し、u から v への鎖になっていること。
- **確認できる範囲：** 一対一の対応は識別子で厳密に確認している。対象は「AOI で切り取った後、簡略化する前」のグラフ。それより前の段階（OSM の way から OSMnx が辺を作る段階）は、`all_oneway` で各区間が 1 回ずつ作られることを前提にしていて、ここでは照合していない。また、テストでは、印を付けずに OSMnx の簡略化を使うと並行する辺が 2 本失われ、この照合で検出できることを確認している。
- **形状：** 簡略化後の辺の LineString の頂点列が、元のノードの座標列と完全に一致すること。頂点を 1 つも間引いていないので、コーナーの形は失われない。テストでは、曲線の way（6 頂点）でも確認している。
- **長さ：** `length_m` が元の辺の合計と一致すること（総延長 199,699.4 m で、前後が一致）。
- **属性：** `highway`・`name`・`direction`・`access`・`routable`・`aoi_status`・`scc_id` が異なる辺どうしは統合しない（`edge_attrs_differ`）。境界の内側と外側の切り替わり点も、簡略化後にノードとして残る。
- **連結成分：** 弱連結成分と強連結成分の数が、簡略化の前後で同じであること。

**距離の座標系：** 距離は、AOI 設定（`config/aoi.*.json`）の `length_crs` で指定した投影座標系で計算する。`check_length_crs` は、その座標系がメートル単位の投影座標系であることと、公開されている適用範囲（area of use）の外接矩形に AOI が収まることを確認し、満たさなければ取得の前にエラーで止める。

- EPSG:6680 の適用範囲は、経度 140.89〜143.61°・緯度 42.15〜45.54° の外接矩形（北海道中央部の市町村）。たとえば東京の AOI に EPSG:6680 を指定するとエラーになる。
- ただし、この判定は外接矩形によるもので、市町村単位で決まる系の境界付近までは判定できない。

**距離の照合：**
- EPSG:6680 の距離は、GRS80 楕円体上の測地線距離と最大 0.0036% しか違わなかった（平面直角座標の縮尺係数の範囲内）。
- OSMnx の大円距離（球面上の haversine）とは最大 0.27% 違った。これは球面近似による誤差で、方位によって変わる。そのため、プロジェクトでは EPSG:6680 の `length_m` を使い、測地線距離は検算用に残している。

## 5. オフラインのテスト（CI で実行）
`gis/tests/fixtures/mini_overpass.json` は手作りの小さなテストデータ（way 19 本）。66 件のテストがあり、次を確認する。

- 未タグの双方向、`oneway=-1`（逆向きの辺だけになる）、`reversible`・`yes;no`・未タグの `motorway_link`（逆向きの辺を作らず、経路探索にも使わない）、ロータリー、未タグの `motorway`
- アクセスの優先順位（`access=no` + `motorcar=yes` は通行可、`access=yes` + `motor_vehicle=no` は通行不可）、条件付き制限、ほかの交通手段のキーを無視すること
- AOI 境界：AOI 外の最初のノードだけ残すこと、AOI の角を横切る区間を報告すること
- 簡略化：曲線の形と長さが保たれること、境界のノードが残ること、並行する辺がすべて残り識別子で一対一に対応すること（印がないと 2 本失われ、それを検出できること）
- 距離の座標系：適用範囲外（東京に EPSG:6680）・地理座標系・未設定をエラーにし、札幌の EPSG:6680 は受け付けること
- EPSG:6680 と測地線距離の一致、強連結成分が経路探索に使えない辺を無視すること
- 生成したクエリが #4 のものと同じであること、GeoJSON が lon/lat の順で帰属表示付きであること

実データを使うテスト（`@pytest.mark.network`）は、既定では実行しない。

## 6. Issue #10 への申し送り
- **AOI 外のノードにつながる辺はコース生成に使わない：** グラフには、境界をまたぐ辺（`aoi_status="crossing"`、札幌で 198 本）と、その先の AOI 外のノード（`in_aoi=false`、108 個）が残っている。これは、道路が AOI の外へ続いていることを記録するためで、コースに使うことを意味しない。周回路の生成では、`aoi_status="inside"` かつ `routable=true` の辺だけを使う必要がある。
  - 強連結成分（`scc_id`）は、境界をまたぐ辺も含めて計算している。そのため、AOI 内だけの部分グラフで、強連結成分を計算し直す必要がある。
- 幹線道路で、OSM の既定値によって双方向としている way（trunk 17 本・secondary 7 本・primary 5 本）を確認する。
- 同じ内容を [Issue #10](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/10) にコメントとして記録した。
