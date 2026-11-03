# Issue #4 調査の根拠（2026-11-04）

[Issue #4](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/4) で行った 2 つの調査について、手順・実行コマンド・結果を記録する。元データ（PLATEAU のタイル、OSM の抽出）はコミットしていない。下のコマンドで取り直せる。

- **AOI（共通）：** `[141.335, 43.050, 141.365, 43.072]`（WGS84、lon/lat）。東西 2,437 m × 南北 2,446 m で、面積は約 5.96 km²（haversine で計算）。
- **実行環境：** macOS、Python 3.9.6（標準ライブラリのみ）

## 1. AOI のうち、実際に LOD2 の建物がある範囲

**データ：** PLATEAU 札幌市 2020年度の建築物 3D Tiles（中央区・北区・東区は `lod1` と `lod2_no_texture`、豊平区は `lod1` のみ）。URL は [PLATEAU 配信データカタログ API](https://api.plateauview.mlit.go.jp/datacatalog/plateau-datasets) から取得した。

**方法**
1. AOI と範囲が重なる末端タイル（b3dm）だけをダウンロードする（71 タイル、約 195 MB）。
2. 各タイルのバッチテーブルから、建物ごとの `gml_id`、`_lod`（実際の LOD）、`_x`・`_y`（重心）を読む。
3. 重心が AOI 内にある建物を `gml_id` で重複なく数える。
4. 100 m メッシュに集計する。

```bash
python3 -I docs/evidence/issue-4/lod_batch.py <cache_dir> docs/evidence/issue-4
```

**重要な発見：** `lod2` タイルセットには、LOD2 モデルがない建物の **LOD1 の形状も入っている**。
- 中央区の `lod2` タイル 10 枚で、Draco 圧縮された頂点をデコードして照合した（scratch 環境で DracoPy 2.2.0 を使用、コードはコミットしていない）。
- 建物 1 棟あたりの頂点数の中央値は、`_lod`=1 が 36（2,082 棟）、`_lod`=2 が 192（833 棟）だった。
- したがって「タイルセットがある範囲」を「LOD2 がある範囲」とみなすことはできない。初回の頂点ベースの集計（LOD2 タイル内に建物の約 99%）はこの理由で誤りだった。

**結果**（[lod_batch_output.txt](lod_batch_output.txt)、[aoi_lod_grid_100m.geojson](aoi_lod_grid_100m.geojson)）
| 指標 | 値 |
|---|---|
| AOI 内の建物（LOD1 タイルセット） | 7,138 棟 |
| そのうち実際に LOD2 の建物 | **2,070 棟（29.0%）** |
| 建物がある 100 m メッシュのうち、LOD2 の建物が過半数を占めるメッシュ | 215 / 586（36.7%） |
| AOI 全体の面積に占める LOD2 過半数メッシュ | 34.4%（約 2.15 km²） |
| LOD2 建物の重心の範囲 | lon 141.3394–141.3649、lat 43.0556–43.0720 |
| LOD2 タイルセットに含まれない建物（豊平区、LOD1 のみ） | 90 棟 |

AOI 内の LOD2 は約 2.15 km² だった。これは、整備範囲 3.27 km²（都心部と琴似の合計）の大部分が都心部にあることと矛盾しない。琴似は西区の `lod2` タイルセットにあり、AOI の外にある（面積はここでは測っていない）。

[aoi_lod_grid_100m.txt](aoi_lod_grid_100m.txt) の見方：`#` は LOD2 が過半数、`+` は LOD2 が一部、`.` は LOD1 のみ、空白は建物なし。上が北。LOD2 は札幌駅〜大通〜すすきのの帯（AOI の東寄り・北寄り）に集まり、すすきのより南と AOI の西側は LOD1 だけになる。

## 2. OSM の頂点密度が角度指標に与える影響

**データ：** Overpass API（`overpass-api.de`）から、AOI 内で車が通る種類の道路（`highway` が motorway〜residential と living_street、*_link）を取得した。OSM 基準時刻は `2026-11-03T16:25:05Z`。© OpenStreetMap contributors（ODbL）。

```bash
curl -s -A "CircuitForgeAI-research/0.1" --data-urlencode 'data=[out:json][timeout:60];way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"](43.050,141.335,43.072,141.365);(._;>;);out body;' https://overpass-api.de/api/interpreter -o osm_aoi.json
python3 -I docs/evidence/issue-4/osm_angle_sensitivity.py osm_aoi.json
```

**方法：** way を AOI で切り取り、AOI の中心で接する平面座標（正距円筒の近似）に変換する。そのうえで、頂点間隔・頂点での曲がり角・コーナー数・最長直線を計算する。生の頂点に加えて、5 m と 20 m の等間隔に点を打ち直した場合とも比べる。

**結果**（[osm_sensitivity.txt](osm_sensitivity.txt)）
- **頂点間隔：** 中央値 14.3 m、下位 10% は 6.0 m 以下、上位 10% は 96.5 m 以上。場所によって大きくばらつく。
- **way 内部の頂点の曲がり角：** 0〜5° が 90.0%、5〜10° が 4.5%、10〜30° が 4.5%、30° 以上が 1.0%。碁盤目状の札幌では、**コーナーはほぼ交差点（way と way のつなぎ目）で起きる**。したがってコーナーの指標は、way 単位ではなく、**つないだ後のルート全体の線**で計算する必要がある。
- **1 頂点ごとに角度を判定する方法は、点の打ち方に左右される。** θc=60° では、1 km あたりのコーナー数が生データ 0.09、5 m 打ち直し 0.03、20 m 打ち直し 0.06 と、最大 3 倍変わった。緩やかなカーブは小さな角度の頂点が続く形で描かれるため、1 頂点だけを見ると見落とす。
- **距離の窓で判定する方法（30 m 以内の向きの変化の合計）は安定していた。** 生データと 5 m 打ち直しで、θc=30°/45°/60° のときそれぞれ 0.41/0.39、0.20/0.19、0.14/0.14 だった。20 m 打ち直しでは形がなまって少し減る（0.30/0.17/0.10）。
- **最長直線**（AOI 内で長さ 200 m 以上の way 199 本の中央値）：θ=5° で 277 m、θ=10° と 15° で 305 m。θ を 5° にすると、OSM の描き方の細かな揺れ（5〜10° の頂点が 4.5%）で直線が途切れやすい。
- **タグが付いている way の割合：** `oneway` 38%、`lanes` 53%、`surface` 56%、`maxspeed` 14%、`width` 0%、`access` 0%。`oneway` がない way は、OSM の慣例では双方向として扱われる（高速道路やロータリーなどの例外を除く）。ただし、本当に双方向かは確認していない。
- **注意：** 中央分離帯のある道路は 2 本の一方通行の way として描かれることがあり、長さとコーナー数を二重に数えている可能性がある。

**この調査が示さないこと：** 生成したルートでの評価はまだ行っていない。ここで分かるのは、way 単位の指標の感度だけ。しきい値の最終的な決定は Issue #10・#11 で行う。
