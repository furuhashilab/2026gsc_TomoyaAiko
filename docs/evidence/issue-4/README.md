# Issue #4 調査の根拠（2026-11-04）

[Issue #4](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/4) で行った 2 つの調査について、データの取得条件・手順・実行コマンド・結果を記録する。元データ（PLATEAU のタイル、OSM の抽出）はコミットしていない。下のファイルとコマンドで、同じデータを取り直せる。

- **AOI（共通）：** `[141.335, 43.050, 141.365, 43.072]`（WGS84、lon/lat）。東西 2,437 m × 南北 2,446 m で、面積は約 5.96 km²（haversine で計算）。
- **実行環境：** macOS、Python 3.9.6（標準ライブラリのみ）

| ファイル | 内容 |
|---|---|
| [lod_batch.py](lod_batch.py) | PLATEAU のタイル取得と、LOD 別の集計 |
| [plateau_manifest.json](plateau_manifest.json) | 使ったカタログの項目と、タイル 71 枚の URL・バイト数・SHA-256 |
| [lod_batch_output.txt](lod_batch_output.txt) | 集計結果（標準出力） |
| [aoi_lod_grid_100m.geojson](aoi_lod_grid_100m.geojson) / [.txt](aoi_lod_grid_100m.txt) | 100 m メッシュの集計（PLATEAU の派生データ） |
| [overpass_query.overpassql](overpass_query.overpassql) | OSM を取得するクエリ（時点を固定） |
| [osm_angle_sensitivity.py](osm_angle_sensitivity.py) | OSM の頂点密度と角度指標の感度分析 |
| [osm_sensitivity.txt](osm_sensitivity.txt) | 感度分析の結果（標準出力） |

## 1. AOI のうち、実際に LOD2 の建物がある範囲

### データの取得条件
- **取得元：** [PLATEAU 配信データカタログ API](https://api.plateauview.mlit.go.jp/datacatalog/plateau-datasets)。試験運用のサービスで、将来も同じ URL で使える保証はない。
- **データセット：** 札幌市、整備 2020年度、仕様書 4.1、2024年登録、CRS は JGD2011。
  - 中央区（01101）・北区（01102）・東区（01103）：`bldg_lod1` と `bldg_lod2_no_texture`
  - 豊平区（01105）：`bldg_lod1` のみ（LOD2 なし）
  - AOI に重なる区は、各区のタイルセットのルートの範囲で判定した。
- **タイルの選び方：** 末端タイルのうち、`content.boundingVolume.region` が AOI と重なるもの。
- **今回の取得：** カタログは 2026-11-04T03:48:05Z（UTC）に取得。71 タイル、203 MB（10^6 バイト単位）。

```bash
# 1) カタログから取得する（マニフェストを作り直す）
python3 -I docs/evidence/issue-4/lod_batch.py <cache_dir> docs/evidence/issue-4
# 2) 記録したマニフェストどおりに取得し、SHA-256 を照合する（空のキャッシュで確認済み）
python3 -I docs/evidence/issue-4/lod_batch.py <cache_dir> <out_dir> docs/evidence/issue-4/plateau_manifest.json
```

### 方法
1. 各タイルのバッチテーブルから、建物ごとの `gml_id`、`_lod`（実際の LOD）、`_x`・`_y`（重心、WGS84）を読む。
2. 重心が AOI 内にある建物を `gml_id` で重複なく数える。LOD1 タイルセットの全建物を母数にし、LOD2 タイルセットで `_lod`=2 になっている建物を LOD2 として数える。
3. 100 m メッシュに集計する。

**重要な発見：** `lod2` タイルセットには、LOD2 モデルがない建物の **LOD1 の形状も入っている**。
- 中央区の `lod2` タイル 10 枚で、Draco 圧縮された頂点をデコードして照合した（scratch 環境で DracoPy 2.2.0 を使用、コードはコミットしていない）。
- 建物 1 棟あたりの頂点数の中央値は、`_lod`=1 が 36（2,082 棟）、`_lod`=2 が 192（833 棟）だった。
- したがって「タイルセットがある範囲」を「LOD2 がある範囲」とみなすことはできない。初回の頂点ベースの集計（LOD2 タイル内に建物の約 99%）はこの理由で誤りだった。

### 結果（[lod_batch_output.txt](lod_batch_output.txt)）
| 指標 | 値 | 性質 |
|---|---|---|
| AOI 内の建物（LOD1 タイルセット） | 7,138 棟 | 棟数（重心で判定） |
| そのうち実際に LOD2 の建物 | **2,070 棟（29.0%）** | 棟数（重心で判定） |
| LOD2 の建物が 1 棟以上ある 100 m メッシュ | 237 / 586（40.4%） | メッシュでの近似 |
| LOD2 の建物が**半数以上**のメッシュ | 215 / 586（36.7%） | メッシュでの近似 |
| 上のメッシュの、AOI 内の面積 | 約 2.10 km²（AOI の約 35%） | メッシュでの近似 |
| LOD2 建物の重心の範囲 | lon 141.3394–141.3649、lat 43.0556–43.0720 | 重心の bbox |
| LOD2 タイルセットに含まれない建物（豊平区、LOD1 のみ） | 90 棟 | 棟数 |

**メッシュでの近似値について（厳密なカバー率ではない）**
- 「半数以上」は、メッシュ内で LOD2 の棟数 ≥ LOD1 のみの棟数になる場合を指す（`>=` で判定）。「過半数」ではない。
- メッシュは 25 × 25 で、緯度経度あたりの距離を局所的に近似して配置している（AOI の面積は、この近似で 5.94 km²）。最後の列と行は 100 m より狭く、AOI で切り取った面積で計算した。
- 分類は建物の重心だけに基づく。LOD2 の整備範囲のポリゴンとは比べていない。
- メッシュ数で単純に割った値（215 / 625 = 34.4%）は、端の切り取りを考慮していないので使わない。

AOI 内の LOD2 の範囲（約 2.1 km²）は、整備範囲 3.27 km²（都心部と琴似の合計）の大部分が都心部にあることと矛盾しない。琴似は西区の `lod2` タイルセットにあり、AOI の外にある（面積はここでは測っていない）。

[aoi_lod_grid_100m.txt](aoi_lod_grid_100m.txt) の見方：`#` は LOD2 が半数以上、`+` は LOD2 が一部、`.` は LOD1 のみ、空白は建物なし。上が北。LOD2 は札幌駅〜大通〜すすきのの帯（AOI の東寄り・北寄り）に集まり、すすきのより南と AOI の西側は LOD1 だけになる。

## 2. OSM の頂点密度が角度指標に与える影響（way 内部の予備調査）

### データの取得条件
- **取得元：** Overpass API `https://overpass-api.de/api/interpreter`。© OpenStreetMap contributors（ODbL）。
- **クエリ：** [overpass_query.overpassql](overpass_query.overpassql)
  - `[date:"2026-11-03T16:25:05Z"]` で、データの時点を最初の取得と同じ時刻に固定している。
  - `highway` が motorway〜residential、living_street、*_link の way と、その構成ノードを取得する。
  - bbox は `(43.050,141.335,43.072,141.365)`（Overpass は lat/lon の順）。
- **同じデータかの確認：** 時点を固定したクエリ（2026-11-04 に実行）と最初の取得を比べ、要素が完全に一致した（ノード 4,502、way 630）。
  - 応答ファイルには取得時刻のヘッダが入るため、ファイルのハッシュは毎回変わる。そこで、要素を並べ替えて正規化したハッシュで比べる（`c2eed5dd2b6d397a`…）。
  - 時点を固定したクエリでは、応答の `timestamp_osm_base` はサーバーの現在時刻になる。データの時点はクエリの `date` で決まる。

```bash
curl -s -A "CircuitForgeAI-research/0.1" --data-urlencode "data@docs/evidence/issue-4/overpass_query.overpassql" https://overpass-api.de/api/interpreter -o osm_aoi.json
python3 -I docs/evidence/issue-4/osm_angle_sensitivity.py osm_aoi.json
```

### 方法
- way を AOI で切り取り、AOI の中心で接する平面座標（正距円筒の近似）に変換する。
- 頂点間隔・頂点での曲がり角・コーナー数・最長直線を計算する。
- 生の頂点に加えて、5 m と 20 m の等間隔に点を打ち直した場合とも比べる。
- **コーナーは way の内部だけで数えている。** way と way のつなぎ目（交差点）での曲がりは測っていない。

### 結果（[osm_sensitivity.txt](osm_sensitivity.txt)）
- **頂点間隔：** 中央値 14.3 m、下位 10% は 6.0 m 以下、上位 10% は 96.5 m 以上。場所によって大きくばらつく。
- **way 内部の頂点の曲がり角：** 0〜5° が 90.0%、5〜10° が 4.5%、10〜30° が 4.5%、30° 以上が 1.0%。
  - **仮説：** 碁盤目状の札幌では、コーナーの多くは交差点で起きる。今回は交差点を測っていないので、これは**検証されていない**。Issue #10 で、生成したルートについて交差点での曲がりとそれ以外を分けて数え、検証する。
- **1 頂点ごとに角度を判定する方法は、点の打ち方に左右される。** θc=60° では、1 km あたりのコーナー数が生データ 0.09、5 m 打ち直し 0.03、20 m 打ち直し 0.06 と、最大 3 倍変わった。
- **距離の窓で判定する方法（30 m 以内の向きの変化の合計）は安定していた。** 生データと 5 m 打ち直しで、θc=30°/45°/60° のときそれぞれ 0.41/0.39、0.20/0.19、0.14/0.14 だった。20 m 打ち直しでは形がなまって少し減る（0.30/0.17/0.10）。
- **最長直線**（AOI 内で長さ 200 m 以上の way 199 本の中央値）：θ=5° で 277 m、θ=10° と 15° で 305 m。
- **タグが付いている way の割合：** `oneway` 38%、`lanes` 53%、`surface` 56%、`maxspeed` 14%、`width` 0%、`access` 0%。
  - **`access` タグがないことは、通行制限がないことを意味しない。** 制限は `motor_vehicle`・`vehicle`・`motorcar`・`*:conditional` などのタグで書かれることもあり、今回はこれらを確認していない。また、制限が OSM に入力されていない場合もある。タグがない状態は「不明」として扱う。
  - `oneway` がない way は、OSM の慣例では双方向として扱われる（高速道路やロータリーなどの例外を除く）。ただし、本当に双方向かは確認していない。
- **注意：** 中央分離帯のある道路は 2 本の一方通行の way として描かれることがあり、長さとコーナー数を二重に数えている可能性がある。

**この調査が示さないこと：** 生成したルートでの評価と、交差点での曲がりの測定はまだ行っていない。しきい値の最終的な決定は Issue #10・#11 で行う。
