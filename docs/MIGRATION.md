# Repository migration & theme change / ゼミ論の統合記録

**Canonical repository:** [`furuhashilab/2026gsc_TomoyaAiko`](https://github.com/furuhashilab/2026gsc_TomoyaAiko)  
**Previous development source:** [`furuhashilab/circuitforge-ai`](https://github.com/furuhashilab/circuitforge-ai)  
**Updated:** 2026-11-04

## なぜ統合したか

古橋研究室の2026年度ゼミ論命名規則に合わせて、既存の **`2026gsc_TomoyaAiko`** を正式な研究・開発リポジトリとして使用するため。今回からのメインテーマは、**CircuitForge AI（実在する道路・都市空間を使う架空のモータースポーツコース生成・3D可視化）**。旧テーマ「札幌都心部における冬季歩行者の経路選択分析」は、新テーマへの変更を明記してアーカイブ化した。

- 旧ゼミ論README全文・発表原稿・参考文献・質疑応答（旧Issue #3のコメントを含む）を **[旧研究アーカイブ](archive/2026-sapporo-winter-walking.md)** にまとめて保存。
- 旧Issue [#1](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/1)、[#2](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/2)、[#3](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/3) は元の記録として引き続き閲覧可能。
- CircuitForge AIのREADME、`CLAUDE.md`、`AGENTS.md`、`CONTRIBUTING.md`、`.gitignore`、`docs/` 以下の研究・設計・ロードマップ・ワークフロー文書を統合した。
- 元CircuitForge AIのIssue 10件は、**同じ作業内容で**新リポジトリに再作成し、全件 `@mapbytomoya` にアサインした。元Issueへのリンクをそれぞれ記載。
- 新テーマの研究室用Issueを作成：[#14 構想発表](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/14)、[#15 参考文献](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/15)、[#16 質疑応答](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/16)。

## CircuitForge AI Issueの対応表

| 旧開発用Issue | 現行ゼミ論Issue | 内容 |
|---|---|---|
| [furuhashilab/circuitforge-ai#1](https://github.com/furuhashilab/circuitforge-ai/issues/1) | [#4](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/4) | 研究目的・対象都市・MVP |
| [furuhashilab/circuitforge-ai#2](https://github.com/furuhashilab/circuitforge-ai/issues/2) | [#5](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/5) | 開発環境とClaude Code |
| [furuhashilab/circuitforge-ai#3](https://github.com/furuhashilab/circuitforge-ai/issues/3) | [#6](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/6) | OSM道路網・GeoJSON |
| [furuhashilab/circuitforge-ai#4](https://github.com/furuhashilab/circuitforge-ai/issues/4) | [#7](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/7) | コース形式・入力検証 |
| [furuhashilab/circuitforge-ai#5](https://github.com/furuhashilab/circuitforge-ai/issues/5) | [#8](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/8) | CesiumJS・PLATEAU |
| [furuhashilab/circuitforge-ai#6](https://github.com/furuhashilab/circuitforge-ai/issues/6) | [#9](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/9) | 3D車両・追従カメラ |
| [furuhashilab/circuitforge-ai#7](https://github.com/furuhashilab/circuitforge-ai/issues/7) | [#10](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/10) | 周回コース自動生成 |
| [furuhashilab/circuitforge-ai#8](https://github.com/furuhashilab/circuitforge-ai/issues/8) | [#11](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/11) | 嗜好入力・評価実験 |
| [furuhashilab/circuitforge-ai#9](https://github.com/furuhashilab/circuitforge-ai/issues/9) | [#12](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/12) | データ・モデルの利用条件 |
| [furuhashilab/circuitforge-ai#10](https://github.com/furuhashilab/circuitforge-ai/issues/10) | [#13](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/13) | 知識蒸留 |

## Gitの履歴について

**ファイルの内容とIssue本文は移行したが、旧開発リポジトリのコミットSHA・PR番号・PRレビュー・Issueコメントの履歴を、新リポジトリのGit/GitHub履歴に完全に合体させたわけではありません。**

- 旧ゼミ論リポジトリのGit履歴はそのまま保持され、変更前READMEは以前のコミットから閲覧できる。
- 旧開発リポジトリも、過去のPRやコミットへの参照を残すため削除しない。元の [PR #11](https://github.com/furuhashilab/circuitforge-ai/pull/11) と [PR #12](https://github.com/furuhashilab/circuitforge-ai/pull/12) は引き続き旧リポジトリ側の記録。
- 以後の開発・Issue・PRは **`furuhashilab/2026gsc_TomoyaAiko` のみ** を正本として扱う。
- フルGit履歴の統合には別途ローカルGitでの慎重な履歴マージが必要。現在の移行には含めていない。

## Claude Code / ローカル環境の切替

もし以前の `circuitforge-ai` をclone済みなら、研究室の正式リポジトリを**別フォルダに新しくclone**するのが安全。

```bash
git clone https://github.com/furuhashilab/2026gsc_TomoyaAiko.git
cd 2026gsc_TomoyaAiko
git remote -v
git status
```

**同名ファイルがあっても、旧フォルダから手作業で `.git` ディレクトリをコピーしない。** Claude Codeには新しいフォルダを開かせ、`CLAUDE.md` と [WORKFLOW.md](WORKFLOW.md) と現行のIssueを読ませる。旧source repoには新機能のPRを出さない。

## ライセンスと権利

旧札幌研究のCC BY 4.0表示は**アーカイブ原文のもの**。CircuitForge AIのソースコードのライセンスや第三者OSM・PLATEAU・車両モデル等の利用許諾に自動適用しない。公開・学習の可否は [DATA_AND_LICENSES.md](DATA_AND_LICENSES.md) と [Issue #12](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/12) で確認する。
