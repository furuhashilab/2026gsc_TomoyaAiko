# circuitforge-gis

CircuitForge AI の GIS 処理（Python 3.12、uv で管理）。セットアップとテストの手順はリポジトリ直下の [README](../README.md#セットアップ) を参照してください。

## OSM 道路グラフ（Issue #6）
```bash
uv run cf-osm            # data/raw に取得済みのデータがあれば再利用する
uv run cf-osm --refetch  # Overpass から取り直す
```
共有 AOI（`../config/aoi.sapporo.json`）について、OSM の取得 → 有向道路グラフ → AOI での切り取り → 簡略化と検証 → 属性の点検 → GeoJSON 出力 を実行します。結果は `../data/processed/<aoi>_<profile>_<date>/` に保存されます（gitignore の対象）。

距離は、AOI 設定の `length_crs`（札幌は EPSG:6680）で計算します。別の地域の AOI を使うときは、その地域に合ったメートル単位の投影座標系を `length_crs` に設定してください。座標系の適用範囲外の AOI は、取得を始める前にエラーで止まります。

| 出力 | 内容 |
|---|---|
| `manifest.json` | 取得条件（クエリ、時点、要素数、要素ハッシュ） |
| `nodes.geojson` / `edges.geojson` | 簡略化後のグラフ（EPSG:4326、lon/lat の順、OSM の帰属表示付き） |
| `graph_unsimplified.graphml` / `graph_simplified.graphml` | OSMnx で読み込める GraphML |
| `audit.md` / `audit.json` | 属性の点検と簡略化の検証の結果 |

| モジュール | 役割 |
|---|---|
| `profile.py` | 取得する道路の種類。MVP は service を除外。`drive-with-service` を将来用に用意 |
| `osm_fetch.py` | Overpass クエリ（Issue #4 と同じもの）、取得、要素ハッシュ |
| `rules.py` | 通行方向とアクセス制限の判定（OSMnx の標準の判定には頼らない） |
| `graph.py` | グラフの構築、AOI での切り取り、投影座標系での距離（適用範囲の確認つき）、連結成分、簡略化とその検証（辺の識別子による一対一の照合） |
| `audit.py` / `export.py` / `cli.py` | 点検レポート、GeoJSON 出力、コマンド |

判定ルールと検証結果は [docs/evidence/issue-6/README.md](../docs/evidence/issue-6/README.md) にあります。

## コース（Issue #7）
```bash
uv run cf-course build --recipe ../contracts/examples/sapporo-demo.recipe.json -o ../web/public/courses/sapporo-demo.course.geojson
uv run cf-course build --mode circuit --via 141.3516,43.0620 141.3600,43.0632 ... -o my.course.geojson
uv run cf-course validate my.course.geojson
```
形式・検証ルール・識別子は [contracts/README.md](../contracts/README.md) を参照してください。`course.py` が作成と検証を、`course_cli.py` がコマンドを担当します。

## テスト
```bash
uv run pytest             # オフライン（tests/fixtures の手作りデータ）。CI と同じ
uv run pytest -m network  # Overpass から実データを取得し、Issue #4 と同じデータかを確認する
```
