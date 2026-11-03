# CircuitForge AI — 実作業ガイド（どこから、どう進めるか）

> **最初に読むファイル。** この文書は「開発の実際の進め方」を説明する。技術構成は [ARCHITECTURE.md](ARCHITECTURE.md)、研究の問いは [RESEARCH_DESIGN.md](RESEARCH_DESIGN.md)、機能の優先度は [ROADMAP.md](ROADMAP.md)、各作業の完了条件は [Issues](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues) に記載する。
>
> **現状：2026-11-03時点ではドキュメントのみ。** アプリ、3Dビューア、自動コース生成、学習済みモデルはまだない。下記は実装済み機能ではなく、これから実施する手順。期日・卒論の最終スコープは指導教員と確定する。

## まず何を作るか（最初のゴール）

**AIがコースを考える前に**、指定した都市の*手動で用意した1本のルート*を3D地図に描き、**汎用車両の3Dモデルがそのルートに沿って動く**状態を目指す。

初回デモで必要なこと：
- 地図が開く、対象領域に移動できる。
- 適切な利用条件の小さな GeoJSON LineString を読み込んでルートを表示できる。
- CesiumJSで地形や、取得可能ならPLATEAUの3D建物を重ねて表示できる。
- 汎用3D車両がルート上を動き、追走視点・車載視点（可能なら空撮視点）に切り替えられる。
- 再生・停止・リセットができる。誰でも再現できる起動方法とデモ手順をREADMEに書ける。

**これができても「AIが設計した」ことにはならない。** 自動生成、嗜好評価、独自AI蒸留は別ステップ。リアルな車両運動も初回デモの対象外。

## 全体の作業順（Issueとの対応）

| 順番 | 作業 | 担当/使うツール | 次へ進む条件 |
|---|---|---|---|
| **0-A** | [#4](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/4) 研究課題、初期都市とAOI（地図範囲）、卒論MVPの評価指標を仮決め | 本人＋ChatGPT（設計）、指導教員に相談 | 対象都市1か所、範囲、最初のデモ条件を文書化 |
| **0-B** | [#12](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/12) OSM・PLATEAU・標高・3D車両のライセンスと利用可能範囲を確認 | 本人＋ChatGPT（資料整理） | 出典・版・利用可否が記録され、未許諾アセットは使わない |
| **1** | [#5](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/5) 開発環境・フォルダ構成・依存パッケージ・動作確認 | Claude Code（主）、本人が実行結果確認 | ローカルで最小Web画面が開き、起動手順を記録 |
| **2-A** | [#6](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/6) 指定AOIのOSM取得、道路グラフ化、GeoJSON出力 | Claude Code + Python/OSMnx | 小範囲の道路データを再現可能に取得し、接続・方向を確認 |
| **2-B** | [#7](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/7) コースデータ形式、手動ルート用サンプル、入力チェック | Claude Code、本人がサンプル検証 | ビューアに渡せる妥当なGeoJSONが1つできる |
| **3** | [#8](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/8) CesiumJSの3D地図、ルート線、条件に合うPLATEAU表示 | Claude Code + CesiumJS | ルートと3D都市/地形が正しい位置で描画される |
| **4** | [#9](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/9) 車両アニメーションと追従カメラ | Claude Code + 許諾確認済みGLB | **最初の3D走行デモ完成**。操作を画面収録/再現できる |
| **5** | [#10](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/10) OSMグラフから有効な閉じた周回路を複数生成 | Claude Code + Python/NetworkX | 手動入力でなく、検証済みの周回候補を出力できる |
| **6** | [#11](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/11) 「高速型」「テクニカル型」等の好み入力、特徴量、ルールベース比較 | 本人＋ChatGPT（実験計画）、Claude Code（実装） | 条件差と評価指標を説明でき、実験を再現できる |
| **7（条件付き）** | [#13](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/13) 教師評価データ → 小型モデルへの知識蒸留 → ベースラインと比較 | 本人＋ChatGPT（実験設計）、Claude Code（学習コード）、Codex（レビュー） | **学習利用が許諾され、評価用データと比較対象が揃ったときだけ**進む |
| **将来** | Rally Mode、山・林道・勾配、好みの細かな編集、よりリアルな走行 | 新しいIssueを起票 | 卒論MVPが成立してから別フェーズで扱う |

**依存関係：** #4と#12を先に確認 → #5 → #6/#7 → #8 → #9 → #10 → #11 →（許諾と研究期間が許せば）#13。#6と#7は一部並行できるが、データ形式の合意が必要。**いきなり学習やラリー開発から着手しない。**

## 今日から始める具体的な手順

### A. まず GitHub 上で確認する

1. [Issue #4](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/4) を開き、自分（`mapbytomoya`）が担当になっているか確認する。
2. `docs/RESEARCH_DESIGN.md` を読んで、**最初の都市はどこか・地図の範囲はどこか・何を成功とみなすか**を仮決めする。札幌は候補だが確定ではない。
3. [Issue #12](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/12) でOSM・PLATEAUの使用条件と入手可能な3Dモデルを確認する。
4. 未決事項はIssueコメントに追記する。計画が固まるまでは、複数都市・知識蒸留・ゲーム化へ拡大しない。
5. 研究とデータの条件が整理できたら [Issue #5](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/5) に着手する。

### B. Macでリポジトリを開き、Claude Codeを使う

```bash
# 初回のみ：Git が利用できる環境でリポジトリを取得
git clone https://github.com/furuhashilab/2026gsc_TomoyaAiko.git
cd circuitforge-ai

# README / CLAUDE.md / docs/WORKFLOW.md を読んでから作業
git status
git pull --ff-only origin main

# 例：Issue #5 の開発作業。番号と名前は着手するIssueに合わせる
git switch -c chore/issue-2-dev-environment

# Claude Code CLI がインストール・認証済みの場合のみ
claude
```

Claude CodeをVS Codeから使う場合も、**開いている作業フォルダが `circuitforge-ai` で、正しいブランチになっていること**を先に確認する。CLIが未導入なら研究室のセットアップ手順を確認する（上記はインストール方法の説明ではない）。

### C. Claude Codeに最初に渡す指示（Issue #5の例）

> `CLAUDE.md`, `docs/WORKFLOW.md`, `README.md`, `docs/ARCHITECTURE.md` と Issue #5 を読み、**Issue #5だけ**の実装計画を提案してください。最初はファイル変更をせず、候補のディレクトリ構成、必要なツール、最小の起動コマンド、テスト方針、ライセンス上の注意、完了条件を説明してください。承認後、最小限の雛形を実装し、実行したコマンドと結果を報告してください。`main` に直接コミットせず、PRを作成してマージはしないでください。

**本人の仕事：** 生成されたコードを「なぜ必要か」のレベルで説明できるか確認する。**実行して動作を確かめる**。不明点をそのままにせずAIに解説させる。

## 毎回の開発サイクル（1 Issue = 1 小さなPR）

1. **選ぶ：** 次に進めるIssueを1件選び、担当を `@mapbytomoya` にする。前提Issueと完了条件を読む。
2. **設計する：** ChatGPT/本人で目的・入力・出力・成功条件を確認。曖昧な仕様はIssueコメントに記録する。
3. **分ける：** `main` を最新にし、Issue番号入りの新規ブランチを作る。**同じ作業ディレクトリをClaude CodeとCodexに同時編集させない**。
4. **実装する：** Claude Codeに**そのIssueだけ**を渡す。最初に計画→小さい実装→テストを繰り返す。依存ライブラリやGISのデータは根拠を確認する。
5. **検証する：** 本人が起動し、再現手順・想定結果・実際の結果を確認。GISなら座標順・道路接続・標高、3Dなら表示ずれやカメラの動きを検証する。バグはIssueに残す。
6. **PRにする：** 目的、関連Issue、変更内容、テスト結果、スクリーンショット/動画（可能なら）、課題・ライセンスを記す。未完なら `Refs #N`、完了条件を満たしたときだけ `Closes #N`。
7. **レビューする：** 本人が差分を理解。必要ならCodexに**読むだけの独立レビュー**を依頼する。指導教員に確認すべき科学的判断はそこで止める。
8. **承認・マージ：** 人間の了承後にPRをマージする。Issueを閉じ、READMEやDecision Logを必要に応じて更新して次のIssueへ。

### PRに必ず書く項目（コピー用）

```markdown
## 目的・関連Issue
Refs #N

## 今回やったこと
- 

## 今回やっていないこと（次のIssue）
- 

## 動作確認
- 確認した環境:
- 実行したコマンド:
- 結果: 成功/失敗（ログやスクリーンショットへのリンク）

## 研究・データ
- データ出典/取得日:
- CRS・座標系・スキーマ:
- 使用アセットのライセンス/帰属表示:
- 未解決事項:
```

## 研究の記録をどう残すか

「とりあえず動いた」で止めず、あとでゼミ論・卒論に使える状態にする。

- **Issue：** 問題、タスク、完了条件、悩んでいる点、判断材料。
- **PR：** どのコードを何のために変更し、どう確認したか。
- **`docs/DECISIONS.md`：** 重要な選択肢と採用理由。例：なぜOSMを道路グラフに使ったか。
- **`docs/RESEARCH_DESIGN.md`：** 研究の問い、評価指標、対象地域、比較手法。
- **実験の成果物（将来）：** AOI、取得日時、OSM/PLATEAUの版、モデル/プロンプト、乱数seed、実行コードのコミットID、定量結果と失敗例。公開できない素材はコミットしない。

## 「完成」とみなすチェックポイント

**Gate A — 研究条件が妥当：** 1都市と小さなAOI、元データの出典、再配布可否、デモの評価基準が分かる。

**Gate B — 初期3Dデモ：** 手動GeoJSON → 3D地図 → 動く汎用車両 → 視点切替を他人のPCでも起動手順に従って再現可能。*自動生成機能は不要*。

**Gate C — 自動生成：** 同じAOIに対し、OSMの接続グラフから**異なる有効な周回路**を生成・検査できる。距離と接続条件の失敗も記録。

**Gate D — 研究評価：** ルールベースや比較対象と、評価指標・実験データ・再現可能な分析方法が揃う。

**Gate E — AI蒸留（任意）：** 教師出力の学習利用許諾を確認し、ホールドアウトした地域などで小型モデルをベースラインと比較できる。成功したという結果は前提にしない。

**卒論の期限に間に合わない場合：** Gate A〜Dを優先し、AI蒸留を「今後の課題」にする可能性もある。論文として主張できる検証を優先し、完成していない機能を成果と書かない。

## 役割分担

| 人・ツール | 具体的に担当すること | 担当しないこと |
|---|---|---|
| **本人（@mapbytomoya）** | 研究判断、先生への相談、Issue優先順位、コードの理解、手元での検証、PR承認 | AIに作業の最終責任を丸投げしない |
| **ChatGPT** | 問い・評価方法・仕様の壁打ち、調査、進捗整理 | 動作未確認なのに成功と断言しない |
| **Claude Code（主）** | コード・テスト・README実装手順・PRの作成 | 承認なしのマージ、Issue外の大規模改修 |
| **Codex（補助）** | 別の観点からのコードレビュー、テスト提案、難しい不具合の切り分け | Claude Codeと同じブランチ/作業ツリーの同時改変 |
| **指導教員・研究室** | テーマの妥当性、実施範囲、評価計画、公開・倫理上の判断 | AIツールだけでの研究審査の代行 |

## 困ったときの判断

- **対象都市に使えるPLATEAUがない：** Gate Bでは地形/ベースマップだけでルート表示を先に完成し、別のPLATEAU対応都市を候補として比較する。データがないのに「ある」と扱わない。
- **OSMのデータが不完全：** 属性不明を不明として残し、誤った自動判定を避ける。
- **学習データ・GPU・時間が足りない：** まずルールベースの比較実験をきちんと仕上げる。蒸留はオプションにする。
- **先生からテーマ変更を求められた：** 研究の問い・範囲・評価をIssue #4とDecision Logで更新し、開発優先度を組み替える。
- **新しい機能を思いついた：** 今のIssueに横入りさせず、別Issueとしてアイデアと優先度を記録。MVP後に判断する。

## いま開くべきリンク

**最初：** [Issue #4](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/4) → [Issue #12](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/12) → [Issue #5](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/5)

**最初のデモ：** [Issue #6](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/6) / [Issue #7](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/7) → [#8](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/8) → [#9](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/9)

[リポジトリ](https://github.com/furuhashilab/2026gsc_TomoyaAiko) · [Issue一覧](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues) · [ロードマップ](ROADMAP.md)
