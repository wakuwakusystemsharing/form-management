# ドキュメント整理・最新化 設計書

**作成日**: 2026-03-15
**対象ブランチ**: staging
**言語方針**: 日本語統一

---

## 背景と目的

`fca7cc4` のリファクタリング（subdomain/custom_domain 削除）や直近の機能追加（注意書き・hide_price・カテゴリー共通オプション等）により、コードとドキュメントの間に乖離が生じている。本作業では全ドキュメントをコード実装と照合し、正確・簡潔・一貫した状態に整備する。

---

## スコープ

### 対象ファイル一覧

| ファイル | アクション |
|---|---|
| `CLAUDE.md` | 全面書き直し |
| `AGENTS.md` | CLAUDE.md に内容統合後、削除 |
| `URL_MIGRATION_SUMMARY.md` | `docs/archive/` へ移動 |
| `docs/ARCHITECTURE.md` | 部分更新（subdomain削除、新機能追加） |
| `docs/API_SPECIFICATION.md` | 部分更新（新API追記） |
| `docs/WORKFLOW.md` | 部分更新（ブランチ戦略を現状に合わせる） |
| `docs/SETUP.md` | 検証・微修正 |
| `docs/SUPABASE_BEST_PRACTICES.md` | 検証・微修正 |
| `docs/DATABASE_MIGRATION.md` | 検証・微修正（subdomain関連削除確認） |
| `docs/STORE_ADMIN_MANAGEMENT.md` | 検証・微修正 |
| `docs/BRANCH_PROTECTION.md` | 検証・微修正 |
| `docs/SUPABASE_STORAGE_SETUP.md` | 検証・微修正 |
| `docs/MCP_SETUP_GUIDE.md` | 検証のみ |
| `docs/DEV_BRANCH_SETUP.md` | `docs/archive/` へ移動 |
| `docs/DEV_TO_STAGING_MERGE_GUIDE.md` | `docs/archive/` へ移動 |
| `docs/STAGING_VS_DEV_CONFLICT_DIFFERENCES.md` | `docs/archive/` へ移動 |
| `docs/SETUP _SUPERBASE.md` | `docs/archive/` へ移動 |
| `docs/superpowers/specs/` | 新規作成（本ファイル＋システム概要仕様書） |

---

## フェーズ別実行計画

### Phase 1: 監査レポート生成
- `src/` 配下のコード（型定義・API・middleware・lib）と全ドキュメントを照合
- 乖離箇所・古い記述・欠落している記述を列挙
- 出力先: `docs/audit-report.md`

### Phase 2: アーカイブ（即実行）
以下を `docs/archive/` に移動:
- `docs/DEV_BRANCH_SETUP.md`
- `docs/DEV_TO_STAGING_MERGE_GUIDE.md`
- `docs/STAGING_VS_DEV_CONFLICT_DIFFERENCES.md`
- `docs/SETUP _SUPERBASE.md`
- `URL_MIGRATION_SUMMARY.md`（ルートから移動）

`AGENTS.md` は内容を CLAUDE.md に統合後に削除。

### Phase 3: 主要ドキュメント更新（並列3エージェント）

**エージェント①: CLAUDE.md 全面書き直し**
- AI向け指示ファイル。プロジェクト概要・アーキテクチャ・必須コマンド・NG事項を現行コードに合わせて全更新
- subdomain/custom_domain の記述を削除
- 最新機能（注意書き・hide_price・カテゴリー共通オプション・CRM・LINE Webhook）を追記
- Superpowers 活用指示は整理して維持
- `AGENTS.md` の内容（Cursor rules 参照）を統合

**エージェント②: ARCHITECTURE.md + DATABASE_MIGRATION.md 更新**
- サブドメイン・カスタムドメイン関連の記述を削除
- stores テーブルから `subdomain`・`custom_domain` カラムを削除
- 最近追加した機能（注意書きフィールド `basic_info.notice`、`hide_price` per-item、カテゴリー共通オプション）をアーキテクチャ説明に追記
- `vercel-blob-deployer.ts` が残存していることを記録し、廃止予定として明記

**エージェント③: API_SPECIFICATION.md 更新**
実際の `src/app/api/` のルートファイルをスキャンし、以下を追記・修正:
- `POST /api/webhooks/line` — LINE Messaging API Webhook
- Google Calendar OAuth フロー（connect / callback）
- CRM 顧客管理 API（`/api/stores/{storeId}/customers/*`）
- 予約分析 API（`/api/stores/{storeId}/reservations/analytics`）
- 店舗管理者 API（`/api/stores/{storeId}/admins/*`）
- 古い・存在しないエンドポイントの削除

### Phase 4: 残りドキュメント検証・微修正（並列2エージェント）

**エージェント④: WORKFLOW.md + BRANCH_PROTECTION.md + STORE_ADMIN_MANAGEMENT.md**
- WORKFLOW.md: 現在のブランチ構成（dev は廃止、staging/main のみ）を確認・修正
- DEV_BRANCH_SETUP.md / DEV_TO_STAGING_MERGE_GUIDE.md の有用な情報を WORKFLOW.md に吸収してからアーカイブ
- BRANCH_PROTECTION.md: 現状のGitHubルールと照合

**エージェント⑤: SETUP.md + SUPABASE_BEST_PRACTICES.md + SUPABASE_STORAGE_SETUP.md + MCP_SETUP_GUIDE.md**
- 各ファイルを通読してコードと照合
- 古いコマンド・古いファイルパス・古い設定値を修正
- スペース入りファイル名 `SETUP _SUPERBASE.md` の内容で有用な部分があれば SETUP.md / SUPABASE_BEST_PRACTICES.md に吸収

### Phase 5: 新規スペック作成
`docs/superpowers/specs/2026-03-15-system-overview-design.md` を新規作成:
- システム全体の正式仕様書（現行実装に基づく）
- 対象読者: 新規開発者・AI エージェント
- 内容: システム構成・データフロー・主要コンポーネント・環境別挙動

### Phase 6: 最終検証
- `pnpm type-check` 実行（ドキュメント変更のみなので必ずパスするはずだが確認）
- 全 `.md` ファイルの内部リンク確認
- `git add` + `git commit`（日本語コミットメッセージ）

---

## 成功基準

1. コードに存在しない機能・カラム・ファイルパスの記述がドキュメントから消えている
2. 直近の主要機能変更（subdomain削除・hide_price・注意書き・CRM・LINE Webhook）がドキュメントに反映されている
3. `docs/archive/` に5ファイルが移動している
4. `CLAUDE.md` が現行実装を正確に反映している
5. `docs/audit-report.md` が生成されている（監査の証跡）
6. 新規スペックファイルが `docs/superpowers/specs/` に存在している

---

## 制約・注意事項

- ドキュメントのみ変更。`src/` 配下のコードは **一切変更しない**（`vercel-blob-deployer.ts` の削除も今回はスコープ外、廃止予定の記述追加のみ）
- アーカイブファイルは削除ではなく移動（gitの履歴で辿れる状態を維持）
- 日本語統一。英語のドキュメントを日本語化する必要はない（既存の英語部分はそのまま）
