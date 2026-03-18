# ドキュメント整理・最新化 設計書

**作成日**: 2026-03-15
**対象ブランチ**: staging
**言語方針**: 日本語統一

---

## 背景と目的

`fca7cc4`（subdomain/custom_domain 削除リファクタリング）以降の機能追加（注意書き `basic_info.notice`・`hide_price` per-item・カテゴリー共通オプション・CRM・LINE Webhook）により、コードとドキュメントの間に乖離が生じている。本作業では全ドキュメントをコード実装と照合し、正確・簡潔・一貫した状態に整備する。

**対象範囲のコミット**: `fca7cc4`（2024年以降のステージングブランチ）以降の全変更を参照する。

---

## スコープ

### アーカイブ対象（`docs/archive/` へ git mv）

以下の**5ファイル**をアーカイブする:

1. `docs/DEV_BRANCH_SETUP.md` — devブランチは廃止済み、WORKFLOW.mdに吸収
2. `docs/DEV_TO_STAGING_MERGE_GUIDE.md` — 一時的な作業手順、WORKFLOW.mdに吸収
3. `docs/STAGING_VS_DEV_CONFLICT_DIFFERENCES.md` — 一時的な作業記録
4. `docs/SETUP _SUPERBASE.md`（ファイル名にスペース含む。`git mv` 時はクォートでエスケープ必須） — SUPABASE_BEST_PRACTICES.mdと重複
5. `URL_MIGRATION_SUMMARY.md`（プロジェクトルート直下 `./URL_MIGRATION_SUMMARY.md`） — 一時的な作業メモ

### 統合・削除対象

- `AGENTS.md` — 内容を **CLAUDE.md** に統合した後、削除

### 検討対象（更新または検証）

| ファイル | アクション |
|---|---|
| `CLAUDE.md` | 全面書き直し（**他ファイルより先に単独実行**） |
| `.github/copilot-instructions.md` | CLAUDE.mdと整合性確認・更新 |
| `docs/ARCHITECTURE.md` | 部分更新（subdomain削除、新機能追記） |
| `docs/API_SPECIFICATION.md` | 部分更新（新API追記、廃止API削除） |
| `docs/WORKFLOW.md` | 部分更新（ブランチ構成をstagingブランチ現状に合わせる）＋アーカイブファイルの有用情報を吸収 |
| `docs/SETUP.md` | 検証・微修正 |
| `docs/SUPABASE_BEST_PRACTICES.md` | 検証・微修正（`SETUP _SUPERBASE.md`の有用情報を吸収してからアーカイブ） |
| `docs/DATABASE_MIGRATION.md` | 検証・微修正（subdomain関連削除確認） |
| `docs/STORE_ADMIN_MANAGEMENT.md` | 検証・微修正 |
| `docs/BRANCH_PROTECTION.md` | 検証・微修正 |
| `docs/SUPABASE_STORAGE_SETUP.md` | 検証・微修正 |
| `docs/MCP_SETUP_GUIDE.md` | 検証のみ |

### 新規作成

- `docs/audit-report.md` — Phase 1 で生成する監査レポート
- `docs/superpowers/specs/2026-03-15-system-overview-design.md` — システム概要仕様書（新規開発者・AIエージェント向け）

---

## フェーズ別実行計画

### Phase 1: 監査レポート生成（単独・逐次）

`src/` 配下のコード（`src/types/`・`src/app/api/`・`src/middleware.ts`・`src/lib/`）と全ドキュメントを照合し、以下を列挙した `docs/audit-report.md` を生成する:

- コードに存在しない機能・カラム・ファイルパスが記載されているドキュメント箇所（行番号付き）
- コードに存在するが未記載のAPI・機能
- 具体的な修正指示（「XXX.mdのYY行目のZZZをWWWに変更」形式）

**Phase 3以降のエージェントはこのレポートを読み込んでから作業する。**

### Phase 2: アーカイブ＆リンク確認（単独・逐次）

1. アーカイブ前に、全 `.md` ファイルでアーカイブ対象ファイルへのリンクを検索し、リンク切れが発生しないことを確認（または修正）
2. `docs/archive/` ディレクトリ作成
3. 上記5ファイルを `git mv` で移動（スペース入りファイルは `git mv "docs/SETUP _SUPERBASE.md" docs/archive/` と引用符付きで実行）
4. `AGENTS.md` の Cursor rules に関する記述を抽出してメモし、ファイル自体は**Phase 3完了後に削除**（CLAUDE.md への統合が完了してから `git rm AGENTS.md`）

### Phase 3: CLAUDE.md 全面書き直し（単独・逐次）

**他の並列フェーズより先に完了させる。** CLAUDE.md は他のドキュメントの基準となるため、単独で処理する。

更新内容:
- `subdomain`・`custom_domain` 関連の記述を全て削除
- `VercelBlobDeployer` の記述にファイルパス（`src/lib/vercel-blob-deployer.ts` に残存）を追記（現行は「削除予定」と記載されているが実ファイルはまだ存在するため注釈を補強する）
- 最新機能を追記: `basic_info.notice`（注意書き）、`hide_price` per-item、カテゴリー共通オプション
- CRM 機能（`customer-utils.ts`・`customer_visits`テーブル）の説明を追記
- `AGENTS.md` の内容（Cursor rules 参照）を統合
- Superpowers 活用指示は整理して維持
- `.github/copilot-instructions.md` との整合性を確認し、必要に応じて更新

### Phase 4: 主要ドキュメント更新（並列2エージェント、Phase 3完了後）

**エージェントA: ARCHITECTURE.md + API_SPECIFICATION.md + DATABASE_MIGRATION.md**
- Phase 1 の audit-report.md を参照して作業
- `stores` テーブルから `subdomain`・`custom_domain` カラム記述を削除
- `basic_info.notice`・`hide_price`・カテゴリー共通オプションをアーキテクチャ説明に追記
- `vercel-blob-deployer.ts` を廃止予定として明記
- API仕様書に以下を追記:
  - `POST /api/webhooks/line`
  - Google Calendar OAuth（connect / callback）
  - CRM API（`/api/stores/{storeId}/customers/*`）
  - 予約分析 API（`/api/stores/{storeId}/reservations/analytics`）
  - 店舗管理者 API（`/api/stores/{storeId}/admins/*`）

**エージェントB: WORKFLOW.md + BRANCH_PROTECTION.md + STORE_ADMIN_MANAGEMENT.md**
- Phase 1 の audit-report.md を参照して作業
- WORKFLOW.md: `dev` ブランチが現在も使われているか確認し、実態に合わせて更新。アーカイブした `DEV_BRANCH_SETUP.md`・`DEV_TO_STAGING_MERGE_GUIDE.md` の有用情報を吸収

### Phase 5: 残りドキュメント検証（並列2エージェント、Phase 4完了後）

**エージェントC: SETUP.md + SUPABASE_BEST_PRACTICES.md + SUPABASE_STORAGE_SETUP.md**
- `SETUP _SUPERBASE.md`（アーカイブ済み）の有用情報を SUPABASE_BEST_PRACTICES.md に吸収
- コマンド・ファイルパス・設定値を現行コードと照合して修正

**エージェントD: MCP_SETUP_GUIDE.md + 全ドキュメントのリンク確認**
- MCP_SETUP_GUIDE.md を通読して問題なければそのまま
- 全 `.md` ファイルの内部リンク（`[...](...)`）が有効か確認

### Phase 6: 新規スペック作成（単独）

`docs/superpowers/specs/2026-03-15-system-overview-design.md` を新規作成:
- **目的**: 新規開発者・AIエージェントが最短でシステムを理解できる正式仕様書
- **内容**: システム構成（3層アーキテクチャ）・データフロー（フォーム作成→デプロイ→顧客アクセス）・主要コンポーネント・環境別挙動・重要な制約

### Phase 7: 最終検証とコミット

- `pnpm type-check` 実行（ドキュメントのみ変更を確認。もし src/ ファイルが誤って変更されていた場合に検知するセーフティネット）
- `git add -A` + `git commit`（日本語コミットメッセージ）

---

## 成功基準（検証可能な形式）

| # | 基準 | 検証方法 |
|---|---|---|
| 1 | `subdomain`・`custom_domain` の記述がすべての更新済みドキュメントから削除されている | `grep -r "subdomain\|custom_domain" docs/ CLAUDE.md --include="*.md" \| grep -v "docs/archive/" \| grep -v "docs/audit-report.md"` でゼロ件 |
| 2 | `basic_info.notice`・`hide_price`・カテゴリー共通オプションが CLAUDE.md と ARCHITECTURE.md に記載されている | `grep "notice\|hide_price" CLAUDE.md docs/ARCHITECTURE.md` で記述あり |
| 3 | `docs/archive/` に5ファイルが存在する | 以下5ファイルがすべて存在すること: `docs/archive/DEV_BRANCH_SETUP.md`・`docs/archive/DEV_TO_STAGING_MERGE_GUIDE.md`・`docs/archive/STAGING_VS_DEV_CONFLICT_DIFFERENCES.md`・`docs/archive/SETUP _SUPERBASE.md`・`docs/archive/URL_MIGRATION_SUMMARY.md` |
| 4 | `AGENTS.md` が削除されている | `ls AGENTS.md` で not found |
| 5 | `docs/audit-report.md` が存在する | `ls docs/audit-report.md` で存在確認 |
| 6 | `docs/superpowers/specs/2026-03-15-system-overview-design.md` が存在する | `ls` で確認 |
| 7 | `docs/API_SPECIFICATION.md` に LINE Webhook・CRM・Google Calendar の記述がある | `grep "webhooks/line\|customers\|google-calendar" docs/API_SPECIFICATION.md` で記述あり |
| 8 | `pnpm type-check` がエラーゼロで完了する | コマンド出力で確認 |

---

## 制約・注意事項

- `src/` 配下のコードは**一切変更しない**（`vercel-blob-deployer.ts` の実ファイル削除も今回スコープ外。廃止予定の記述追加のみ）
- アーカイブはgit mvで移動（gitの履歴で辿れる状態を維持）
- 日本語統一。既存ドキュメントの英語部分はそのままでよい
- CLAUDE.md の更新は単独・逐次処理（並列化しない）
