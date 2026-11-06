# Course contract（CircuitForge Course v0.1.1）

コース（架空のモータースポーツコース）の交換形式です。決定の経緯は [docs/DECISIONS.md](../docs/DECISIONS.md) の D-0011、全体の設計は [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md#course-contract-decided-v010-issue-7) にあります。

- スキーマ：[course.schema.json](course.schema.json)（JSON Schema 2020-12）
- **v0.1.1（Issue #10）：** `authoring.method` に `generated-outbound-return`（自動生成の案 A）を追加しました。追加だけの変更なので、0.1.0 のファイルもそのまま読めます。生成したコースの `authoring` には、`seed`・`attempt`・`start_node`・`turn_node`・`params` も記録します。
- 形式：GeoJSON の `Feature` 1 つ（RFC 7946、WGS84、`[lon, lat]` の順）。拡張子は `.course.geojson`
- **本体は `properties.segments`**（OSM の有向区間の順番付きリスト）。`geometry` と `length_m` はそこから計算した値で、検証のときに計算し直して照合します。

## 区間の識別子 `edge_uid`
`way_id:区間番号:f|r` の形です。
- **区間番号：** way のノード列の中で、その区間が何番目か（`nodes[i] → nodes[i+1]` の `i`）。
- **`f` / `r`：** `f` は OSM で描かれた向き、`r` はその逆向き。

道路グラフ（Issue #6、`uv run cf-osm`）の辺と同じ識別子です。そのため、次のことができます。
- 同じノード間に並行する区間があっても区別できます。
- 簡略化したグラフの辺も、元の区間の順番と向きに戻せます（`course.expand_simplified_path`）。

## 例
| ファイル | 内容 | コミット |
|---|---|---|
| [examples/synthetic-loop.course.geojson](examples/synthetic-loop.course.geojson) | 手作りのテストデータ（`gis/tests/fixtures`）上の周回 398.9 m。実在の道路ではない | する（OSM のデータを含まない） |
| [examples/sapporo-demo.recipe.json](examples/sapporo-demo.recipe.json) | 札幌のデモ周回を作るためのレシピ（経由点 5 つ、データの時点、AOI） | する（経由点は手で選んだ座標で、OSM のデータではない） |
| `web/public/courses/sapporo-demo.course.geojson` | レシピから作った札幌のデモ周回 | **しない**（OSM の派生データ。ODbL の扱いは Issue #12 で決める。`.gitignore` の対象） |

```bash
cd gis
uv run cf-osm                                   # 札幌の OSM データ（時点を固定）を取得し、道路グラフを作る
uv run cf-course build --recipe ../contracts/examples/sapporo-demo.recipe.json \
  -o ../web/public/courses/sapporo-demo.course.geojson
uv run cf-course validate ../web/public/courses/sapporo-demo.course.geojson
```

## 手動でコースを作る方法
- **経由点で作る：** `--via LON,LAT ...`（緯度経度）か `--via-nodes ID ...`（OSM のノード ID）で経由点を指定します。経由点どうしの間は、「経路探索に使える辺」かつ「AOI 内の辺」だけを使った最短経路（`length_m` を mm 単位の整数にしたもの）でつなぎます。
  - 長さが同じ経路が複数ある場合は、`edge_uid` の並びが辞書順で最小のものを選びます。グラフに辺を追加した順番には左右されません。
  - これはコースを手で作るための補助機能で、面白いコースを選ぶものではありません。好みに合わせた自動生成は Issue #10 以降で扱います。
  - 緯度経度で指定した経由点は、最寄りの使えるノードに合わせます。30 m 以上離れていればエラーにします。
- **区間を直接指定して作る：** `--segments EDGE_UID ...` で、区間のリストをそのまま渡します。

## 検証（`cf-course validate`）
| 種類 | コード |
|---|---|
| エラー | `E_SCHEMA`、`E_LENGTH_CRS`、`E_LENGTH_CRS_MISMATCH`（道路グラフの距離計算に使った座標系と違う）、`E_AOI_MISMATCH`（信頼できる AOI 設定と違う）、`E_SNAPSHOT_MISMATCH`、`E_UNKNOWN_SEGMENT`、`E_DIRECTION_NOT_ALLOWED`（一方通行の逆走・向きが不確定）、`E_SEGMENT_MISMATCH`、`E_NOT_ROUTABLE`、`E_OUTSIDE_AOI`、`E_DISCONTINUOUS`、`E_UTURN`（周回では閉じ目、つまり最後の区間から最初の区間へのつなぎ目も対象）、`E_REPEATED_SEGMENT`、`E_NOT_CLOSED`、`E_RALLY_SAME_ENDS`、`E_GEOMETRY_MISMATCH`、`E_LENGTH_MISMATCH`（0.1% を超える差） |
| 警告 | `W_NODE_REVISITED`、`W_OPPOSITE_DIRECTION_REUSE`、`W_DEFAULT_TWO_WAY_MAJOR`、`W_LENGTH_OUT_OF_RANGE`、`W_NO_ELEVATION`、`W_TURN_RESTRICTIONS_NOT_EVALUATED`（毎回出る） |

道路グラフは、`data/raw/` にある時点固定の OSM データから作り直して検証に使います。

**コース側のメタデータは信頼しません。**
- `cf-course validate` は、コースに書かれた `aoi` ではなく、信頼できる AOI 設定（`--aoi`、既定は `config/aoi.sapporo.json`）から道路グラフを作ります。
- そのうえで、コースの `aoi`（ID・bbox）がその AOI 設定と一致するか、コースの `aoi.length_crs` が道路グラフの距離計算に実際に使った座標系と一致するかを照合します。
- たとえば EPSG:6691（JGD2011 UTM 54N）は札幌でも使える座標系ですが、道路グラフが EPSG:6680 で計算されていれば不合格になります。コースに記録された要素ハッシュと一致しない場合は、検証できないので `E_SNAPSHOT_MISMATCH` になります。
