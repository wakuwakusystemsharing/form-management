# ドキュメント整理・最新化 実装計画

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `fca7cc4` 以降のコード変更（CRM・LINE Webhook・Google Calendar・notice 等）に合わせて、全ドキュメントを正確・簡潔・一貫した状態に整備する。

**Architecture:** Phase 1 で監査レポートを生成し、Phase 2 でアーカイブ、Phase 3 で CLAUDE.md を単独書き直し、Phase 4-5 で残りのドキュメントを並列更新、Phase 6 で新規スペック作成、Phase 7 で最終検証。`src/` 配下のコードは一切変更しない。

**Tech Stack:** git mv（アーカイブ）、Markdown 編集、pnpm type-check（検証）

---

## Chunk 1: Phase 1 — 監査レポート生成

### Task 1: `docs/audit-report.md` を生成する

**Files:**
- Create: `docs/audit-report.md`
- Read: `src/types/form.ts`, `src/types/store.ts`, `src/types/survey.ts`
- Read: `src/app/api/` 配下の全ルート
- Read: `src/middleware.ts`, `src/lib/env.ts`
- Read: `docs/ARCHITECTURE.md`, `docs/API_SPECIFICATION.md`, `docs/DATABASE_MIGRATION.md`, `docs/WORKFLOW.md`, `docs/SETUP.md`, `docs/SUPABASE_BEST_PRACTICES.md`, `docs/STORE_ADMIN_MANAGEMENT.md`, `docs/BRANCH_PROTECTION.md`, `docs/SUPABASE_STORAGE_SETUP.md`, `CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`

- [ ] **Step 1: API ルート一覧をコードから抽出する**

  ```bash
  find src/app/api -name "route.ts" | sort
  ```
  期待出力: 全 API ルートファイルが列挙される

- [ ] **Step 2: docs/API_SPECIFICATION.md の API 一覧と照合する**

  各ドキュメントを読み、コードに存在するが未記載の API を洗い出す。
  **重要**: Step 1 の `find` 出力に含まれる**すべてのルート**を API_SPECIFICATION.md と照合すること。以下は未記載の可能性が高い代表例だが、リストにない API も必ず確認する。

  確認対象（コードに存在するが旧ドキュメントに未記載の可能性が高いもの）:
  - `POST /api/webhooks/line`
  - `GET /api/integrations/google-calendar/connect`
  - `GET /api/integrations/google-calendar/callback`
  - `GET|PUT /api/stores/{storeId}/calendar`
  - `POST /api/stores/{storeId}/calendar/disconnect`
  - `GET /api/stores/{storeId}/calendar/availability`
  - `GET|POST /api/stores/{storeId}/customers`
  - `GET|PUT|DELETE /api/stores/{storeId}/customers/{customerId}`
  - `GET /api/stores/{storeId}/customers/analytics`
  - `GET /api/stores/{storeId}/reservations/analytics`
  - `GET|POST /api/stores/{storeId}/admins`
  - `DELETE /api/stores/{storeId}/admins/{userId}`

- [ ] **Step 3: `subdomain` / `custom_domain` の記述をドキュメントで検索する**

  ```bash
  grep -rn "subdomain\|custom_domain" docs/ CLAUDE.md AGENTS.md .github/copilot-instructions.md --include="*.md"
  ```
  期待出力: 該当箇所のファイル名と行番号の一覧

- [ ] **Step 4: `src/types/store.ts` の現行 Store 型を確認する**

  ```bash
  cat src/types/store.ts
  ```
  `subdomain`・`custom_domain` カラムが削除済みであることを確認する。

- [ ] **Step 5: ドキュメントに記載の旧フィールド・旧パスを確認する**

  以下を各ドキュメントで検索し、コードに存在しない記述を列挙する:
  - `VercelBlobDeployer`（非推奨 deployer への参照）
  - `dev` ブランチの扱い（現行ブランチ構成と照合）
  - `hide_price` per-item フィールドの有無
  - カテゴリー共通オプション（`common_options`）の有無

- [ ] **Step 6: `docs/audit-report.md` を作成する**

  以下の形式で記述する:

  ```markdown
  # ドキュメント監査レポート

  **生成日**: 2026-03-15
  **対象**: fca7cc4 以降のコード変更とドキュメントの乖離

  ---

  ## 1. コードに存在しない記述（削除が必要）

  | ファイル | 行番号 | 記述内容 | 対処 |
  |---|---|---|---|
  | docs/ARCHITECTURE.md | XX行 | `subdomain` カラムの説明 | 削除 |
  | ... | ... | ... | ... |

  ## 2. コードに存在するが未記載の機能・API

  | 機能/API | 追記先ドキュメント |
  |---|---|
  | POST /api/webhooks/line | docs/API_SPECIFICATION.md |
  | ... | ... |

  ## 3. 具体的な修正指示

  ### docs/ARCHITECTURE.md
  - XX行目: `subdomain`・`custom_domain` カラム記述を削除
  - YY行目: `basic_info.notice` フィールドの説明を追記
  - ...

  ### docs/API_SPECIFICATION.md
  - LINE Webhook セクションを追加（POST /api/webhooks/line）
  - Google Calendar OAuth セクションを追加
  - CRM API セクションを追加
  - ...

  （以下、各ドキュメントの修正指示）
  ```

- [ ] **Step 7: audit-report.md が作成されたことを確認する**

  ```bash
  ls docs/audit-report.md
  wc -l docs/audit-report.md
  ```
  期待出力: ファイルが存在し、50行以上あること

---

## Chunk 2: Phase 2 — アーカイブ & リンク確認

### Task 2: アーカイブ対象ファイルへの参照チェック

**Files:**
- Read only: 全 `.md` ファイル

- [ ] **Step 1: アーカイブ対象ファイルへの内部リンクを検索する**

  ```bash
  grep -rn "DEV_BRANCH_SETUP\|DEV_TO_STAGING_MERGE_GUIDE\|STAGING_VS_DEV_CONFLICT\|SETUP _SUPERBASE\|SETUP%20_SUPERBASE\|URL_MIGRATION_SUMMARY" docs/ CLAUDE.md AGENTS.md README.md --include="*.md" 2>/dev/null
  ```
  期待出力: リンクが存在する場合はファイル名・行番号が表示される。存在する場合は次の Step でリンク先を `docs/archive/` に更新する。

- [ ] **Step 2: リンクが存在する場合、参照先パスを更新する**

  例: `[DEV_BRANCH_SETUP](DEV_BRANCH_SETUP.md)` → `[DEV_BRANCH_SETUP](archive/DEV_BRANCH_SETUP.md)`
  変更が不要な場合はこの Step をスキップする。

### Task 3: `docs/archive/` ディレクトリを作成してファイルを移動する

**Files:**
- Create dir: `docs/archive/`
- Move: `docs/DEV_BRANCH_SETUP.md` → `docs/archive/`
- Move: `docs/DEV_TO_STAGING_MERGE_GUIDE.md` → `docs/archive/`
- Move: `docs/STAGING_VS_DEV_CONFLICT_DIFFERENCES.md` → `docs/archive/`
- Move: `docs/SETUP _SUPERBASE.md` → `docs/archive/`
- Move: `./URL_MIGRATION_SUMMARY.md` → `docs/archive/`

- [ ] **Step 1: `docs/archive/` ディレクトリを作成する**

  ```bash
  mkdir docs/archive
  ```

- [ ] **Step 2: 5ファイルを git mv で移動する**

  ```bash
  git mv docs/DEV_BRANCH_SETUP.md docs/archive/DEV_BRANCH_SETUP.md
  git mv docs/DEV_TO_STAGING_MERGE_GUIDE.md docs/archive/DEV_TO_STAGING_MERGE_GUIDE.md
  git mv docs/STAGING_VS_DEV_CONFLICT_DIFFERENCES.md docs/archive/STAGING_VS_DEV_CONFLICT_DIFFERENCES.md
  git mv "docs/SETUP _SUPERBASE.md" "docs/archive/SETUP _SUPERBASE.md"
  git mv URL_MIGRATION_SUMMARY.md docs/archive/URL_MIGRATION_SUMMARY.md
  ```

- [ ] **Step 3: 移動を確認する**

  ```bash
  ls docs/archive/
  git status
  ```
  期待出力: `docs/archive/` 内に5ファイルが存在し、git status で renamed として表示される

- [ ] **Step 4: `AGENTS.md` の Cursor rules 記述内容をメモする**

  `AGENTS.md` を読んで Cursor rules / `.cursorrules` に関する記述を特定し、Phase 3 の CLAUDE.md 更新作業で統合するためメモとして保持する。
  **注意**: `AGENTS.md` 自体の削除は Phase 3 完了後に行う（Task 7 を参照）。

- [ ] **Step 5: アーカイブをコミットする**

  ```bash
  git add -A
  git commit -m "docs: 廃止・一時的なドキュメントを docs/archive/ へアーカイブ"
  ```

---

## Chunk 3: Phase 3 — CLAUDE.md 全面書き直し

### Task 4: `CLAUDE.md` を全面書き直しする（**単独・逐次処理**）

**Files:**
- Modify: `CLAUDE.md`（プロジェクトルート直下）
- Read reference: `docs/audit-report.md`, `AGENTS.md`, `src/types/store.ts`, `src/lib/customer-utils.ts`

- [ ] **Step 1: 現行 CLAUDE.md のすべての `subdomain`・`custom_domain` 記述箇所を特定する**

  ```bash
  grep -n "subdomain\|custom_domain" CLAUDE.md
  ```

- [ ] **Step 2: 現行 CLAUDE.md の `VercelBlobDeployer` 記述を確認する**

  ```bash
  grep -n "VercelBlob\|vercel-blob" CLAUDE.md
  ```

- [ ] **Step 3: `AGENTS.md` から統合すべき内容を確認する**

  `AGENTS.md` を全文読み、CLAUDE.md に統合すべき Cursor rules 参照や AI エージェント向けガイドラインを特定する。

- [ ] **Step 3b: `hide_price` と `common_options` がコードに存在するか確認する**

  ```bash
  grep -rn "hide_price" src/types/ src/lib/ src/components/
  grep -rn "common_options" src/types/ src/lib/ src/components/
  ```
  期待出力: 存在するなら後の Step 4 の追記対象に含める。存在しない場合は追記しない。

- [ ] **Step 3c: `.claude/CLAUDE.md` の Superpowers 指示を確認する**

  ```bash
  cat .claude/CLAUDE.md 2>/dev/null || cat CLAUDE.md | grep -A5 "Superpowers"
  ```
  プロジェクトルートの CLAUDE.md に Superpowers 記述がない場合は、`.claude/CLAUDE.md` または既存のプロジェクト設定から内容を把握する。

- [ ] **Step 4: CLAUDE.md を書き直す**

  以下の変更をすべて反映した新しい CLAUDE.md を作成する:

  **削除する内容:**
  - `subdomain`・`custom_domain` カラムへの言及を全て削除
  - middleware の subdomain 検出ロジックの説明（Step 1 で確認した箇所）

  **更新する内容:**
  - `VercelBlobDeployer` の記述: 「削除予定（`src/lib/vercel-blob-deployer.ts` に残存。実ファイル削除は今回スコープ外）」に更新
  - `stores` テーブルのスキーマ説明を現行の `src/types/store.ts` に合わせる
  - Git ブランチ戦略を現行の `staging` ブランチ構成に合わせる

  **追記する内容:**
  - `basic_info.notice`: フォーム上部に表示する注意書きフィールド
  - `hide_price` per-item: Step 3b でコードへの存在が確認された場合のみ追記
  - カテゴリー共通オプション: Step 3b でコードへの存在が確認された場合のみ追記
  - CRM 機能の説明: `customer-utils.ts`・`customers` テーブル・`customer_visits` テーブル・セグメント分類
  - `AGENTS.md` から抽出した Cursor rules 参照・AI エージェントガイドライン（Step 3 で特定した内容）
  - LINE Webhook の概要説明

  **維持する内容:**
  - Superpowers 活用指示（Step 3c で確認した内容。存在しない場合は追記不要）
  - 必須コマンド・環境変数・TDD ルール・コード整理ポリシー

- [ ] **Step 5: `.github/copilot-instructions.md` との整合性を確認して更新する**

  `.github/copilot-instructions.md` を読み、CLAUDE.md と矛盾する記述（subdomain 等）を修正する。

- [ ] **Step 6: 変更を検証する**

  ```bash
  grep -n "subdomain\|custom_domain" CLAUDE.md
  ```
  期待出力: ゼロ件

  ```bash
  grep -n "notice\|customer-utils\|customer_visits" CLAUDE.md
  ```
  期待出力: 各キーワードの記述が存在する

- [ ] **Step 7: `AGENTS.md` を削除する（Phase 3 完了後）**

  CLAUDE.md への統合が完了したことを確認してから実行する:

  ```bash
  git rm AGENTS.md
  ```

- [ ] **Step 8: コミットする**

  `git rm AGENTS.md`（Step 7）はすでに staging されている。追加で `CLAUDE.md` と `.github/copilot-instructions.md` を add してコミットする:

  ```bash
  git add CLAUDE.md .github/copilot-instructions.md
  git commit -m "docs: CLAUDE.md を全面書き直し（最新コードと整合、AGENTS.md 統合）"
  ```

---

## Chunk 4: Phase 4 — 主要ドキュメント並列更新

> **Note:** Task 5（エージェントA）と Task 6（エージェントB）は並列実行可能。どちらも `docs/audit-report.md` を読んでから作業を開始すること。

### Task 5: エージェントA — ARCHITECTURE.md + API_SPECIFICATION.md + DATABASE_MIGRATION.md

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/API_SPECIFICATION.md`
- Modify: `docs/DATABASE_MIGRATION.md`
- Read: `docs/audit-report.md`, `src/app/api/` 配下の各 route.ts

- [ ] **Step 0: Phase 3（CLAUDE.md 書き直し）が完了していることを確認する**

  ```bash
  git log --oneline -5 | grep "CLAUDE.md"
  ```
  期待出力: "CLAUDE.md を全面書き直し" のコミットが存在する。存在しない場合は Phase 3 の完了を待つ。

- [ ] **Step 1: `docs/audit-report.md` を読んで ARCHITECTURE.md の修正指示を確認する**

- [ ] **Step 2: `docs/ARCHITECTURE.md` を更新する**

  **削除:**
  - `stores` テーブルの `subdomain`・`custom_domain` カラム説明
  - サブドメインルーティングに関するアーキテクチャ説明

  **追記:**
  - `basic_info.notice` フィールドの説明（フォーム上部注意書き）
  - カテゴリー共通オプション（コードに存在する場合）
  - CRM 機能のアーキテクチャ説明（`customer-utils.ts`・セグメント分類）
  - LINE Webhook の役割
  - `vercel-blob-deployer.ts` を廃止予定として明記

- [ ] **Step 3: 変更を検証する**

  ```bash
  grep -n "subdomain\|custom_domain" docs/ARCHITECTURE.md
  ```
  期待出力: ゼロ件（または文脈上問題ない履歴説明のみ）

  ```bash
  grep -n "notice\|customer" docs/ARCHITECTURE.md
  ```
  期待出力: 記述あり

- [ ] **Step 4: `docs/API_SPECIFICATION.md` を更新する**

  **削除:**
  - subdomain / custom_domain 関連の API 記述（存在する場合）

  **追記（以下のセクションが未記載なら追加）:**

  ```markdown
  ### LINE Webhook
  POST /api/webhooks/line
  - LINE Messaging API からの Webhook イベントを受信
  - リクエストボディ: LINE Webhook イベントペイロード
  - 署名検証: `LINE_CHANNEL_SECRET` で HMAC-SHA256 検証

  ### Google Calendar OAuth
  GET /api/integrations/google-calendar/connect?store_id={storeId}
  - OAuth 認証フローを開始（Google へリダイレクト）

  GET /api/integrations/google-calendar/callback
  - OAuth コールバック処理、リフレッシュトークンを暗号化して保存

  GET /api/stores/{storeId}/calendar
  - カレンダー連携状態取得

  PUT /api/stores/{storeId}/calendar
  - カレンダー ID を設定

  POST /api/stores/{storeId}/calendar/disconnect
  - カレンダー連携解除

  GET /api/stores/{storeId}/calendar/availability
  - カレンダー空き状況取得

  ### CRM API（顧客管理）
  GET /api/stores/{storeId}/customers
  - 顧客一覧（ページネーション・検索対応）

  POST /api/stores/{storeId}/customers
  - 顧客作成

  GET /api/stores/{storeId}/customers/{customerId}
  - 顧客詳細（来店履歴含む）

  PUT /api/stores/{storeId}/customers/{customerId}
  - 顧客更新

  DELETE /api/stores/{storeId}/customers/{customerId}
  - 顧客削除

  GET /api/stores/{storeId}/customers/analytics
  - 顧客分析データ

  ### 予約分析 API
  GET /api/stores/{storeId}/reservations/analytics
  - 予約統計データ（日別・週別・月別）

  ### 店舗管理者 API
  GET /api/stores/{storeId}/admins
  - 管理者一覧

  POST /api/stores/{storeId}/admins
  - 管理者追加（メールアドレス招待）

  DELETE /api/stores/{storeId}/admins/{userId}
  - 管理者削除
  ```

- [ ] **Step 5: API_SPECIFICATION.md の変更を検証する**

  ```bash
  grep -n "webhooks/line\|customers\|google-calendar\|admins" docs/API_SPECIFICATION.md
  ```
  期待出力: 各 API の記述が存在する

- [ ] **Step 6: `docs/DATABASE_MIGRATION.md` を更新する**

  まず現行のマイグレーションファイルを確認する:

  ```bash
  ls supabase/migrations/ | sort
  ```

  subdomain・custom_domain カラムに関する記述（存在する場合）を削除または「削除済み（`20260308000000_remove_subdomain_columns.sql` で削除）」と注記する。
  上記 `ls` の出力と照合し、ドキュメントに記載のマイグレーション履歴が実態と一致していることを確認する。

- [ ] **Step 7: コミットする**

  ```bash
  git add docs/ARCHITECTURE.md docs/API_SPECIFICATION.md docs/DATABASE_MIGRATION.md
  git commit -m "docs: ARCHITECTURE.md・API_SPECIFICATION.md・DATABASE_MIGRATION.md を最新コードに合わせて更新"
  ```

---

### Task 6: エージェントB — WORKFLOW.md + BRANCH_PROTECTION.md + STORE_ADMIN_MANAGEMENT.md

**Files:**
- Modify: `docs/WORKFLOW.md`
- Modify: `docs/BRANCH_PROTECTION.md`
- Modify: `docs/STORE_ADMIN_MANAGEMENT.md`
- Read: `docs/audit-report.md`, `docs/archive/DEV_BRANCH_SETUP.md`, `docs/archive/DEV_TO_STAGING_MERGE_GUIDE.md`

- [ ] **Step 0: Phase 3（CLAUDE.md 書き直し）が完了していることを確認する**

  ```bash
  git log --oneline -5 | grep "CLAUDE.md"
  ```
  期待出力: "CLAUDE.md を全面書き直し" のコミットが存在する。存在しない場合は Phase 3 の完了を待つ。

- [ ] **Step 1: `docs/audit-report.md` を読んで WORKFLOW.md の修正指示を確認する**

- [ ] **Step 2: 現行ブランチ構成を確認する**

  ```bash
  git branch -a | head -20
  ```
  期待出力: `dev`・`staging`・`main` の存在有無を確認

- [ ] **Step 3: `docs/WORKFLOW.md` を更新する**

  - `docs/archive/DEV_BRANCH_SETUP.md` を読み、WORKFLOW.md に未記載の有用情報（ブランチ作成手順等）を吸収する
  - `docs/archive/DEV_TO_STAGING_MERGE_GUIDE.md` を読み、PR 作成・マージ手順のうち有用なものを吸収する
  - Step 2 で確認したブランチ構成に合わせて `dev` ブランチの扱いを更新する
  - subdomain 関連の記述があれば削除する

- [ ] **Step 3b: WORKFLOW.md の更新を検証する**

  ```bash
  wc -l docs/WORKFLOW.md
  grep -c "subdomain\|custom_domain" docs/WORKFLOW.md
  ```
  期待出力: 行数が更新前と同等以上（吸収により増加想定）、subdomain は0件

- [ ] **Step 4: `docs/BRANCH_PROTECTION.md` を更新する**

  現行のブランチ保護設定と照合し、古い記述（dev ブランチ前提等）を修正する。

- [ ] **Step 5: `docs/STORE_ADMIN_MANAGEMENT.md` を更新する**

  audit-report.md に指摘がある場合はそれに従う。指摘がない場合でも以下を必ず確認・追記する:
  - `GET|POST /api/stores/{storeId}/admins` エンドポイントの記述
  - `DELETE /api/stores/{storeId}/admins/{userId}` エンドポイントの記述
  - `StoreAdminManager.tsx` コンポーネントへの参照

- [ ] **Step 6: コミットする**

  ```bash
  git add docs/WORKFLOW.md docs/BRANCH_PROTECTION.md docs/STORE_ADMIN_MANAGEMENT.md
  git commit -m "docs: WORKFLOW.md・BRANCH_PROTECTION.md・STORE_ADMIN_MANAGEMENT.md を更新"
  ```

---

## Chunk 5: Phase 5 — 残りドキュメント検証 & Phase 6 新規スペック

> **Note:** Task 7（エージェントC）と Task 8（エージェントD）は並列実行可能。Task 9 は Task 7/8 完了後に実行する。

### Task 7: エージェントC — SETUP.md + SUPABASE_BEST_PRACTICES.md + SUPABASE_STORAGE_SETUP.md

**Files:**
- Modify: `docs/SETUP.md`
- Modify: `docs/SUPABASE_BEST_PRACTICES.md`
- Modify: `docs/SUPABASE_STORAGE_SETUP.md`
- Read: `docs/archive/SETUP _SUPERBASE.md`, `docs/audit-report.md`

- [ ] **Step 1: `docs/archive/SETUP _SUPERBASE.md` を読んで有用情報を抽出する**

  `SUPABASE_BEST_PRACTICES.md` に未記載の情報を特定する。

- [ ] **Step 2: `docs/SUPABASE_BEST_PRACTICES.md` に有用情報を吸収する**

  `SETUP _SUPERBASE.md` から抽出した情報のうち、現行コードと一致する内容のみ追記する。

- [ ] **Step 3: `docs/SETUP.md` を検証・修正する**

  コマンド・ファイルパス・設定値を現行コードと照合し、古い記述を修正する。
  修正後、以下で環境変数の完全性を確認する:

  ```bash
  grep -n "GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY\|GOOGLE_OAUTH_CLIENT_ID\|LINE_CHANNEL_SECRET\|SUPABASE_SERVICE_ROLE_KEY" docs/SETUP.md
  ```
  期待出力: 上記4つの環境変数がすべて記載されている

  ```bash
  grep -n "pnpm type-check\|pnpm seed:" docs/SETUP.md
  ```
  期待出力: `pnpm type-check` と `pnpm seed:*` コマンドが記載されている

- [ ] **Step 4: `docs/SUPABASE_STORAGE_SETUP.md` を検証・修正する**

  ストレージパス構造（`reservations/{storeId}/{formId}/index.html`）の正確性を確認する。

- [ ] **Step 5: コミットする**

  ```bash
  git add docs/SETUP.md docs/SUPABASE_BEST_PRACTICES.md docs/SUPABASE_STORAGE_SETUP.md
  git commit -m "docs: SETUP.md・SUPABASE_BEST_PRACTICES.md・SUPABASE_STORAGE_SETUP.md を検証・更新"
  ```

---

### Task 8: エージェントD — MCP_SETUP_GUIDE.md + 全ドキュメントのリンク確認

**Files:**
- Read: `docs/MCP_SETUP_GUIDE.md`（問題なければ変更なし）
- Read: 全 `.md` ファイル（リンク確認）

- [ ] **Step 1: `docs/MCP_SETUP_GUIDE.md` を通読する**

  明らかな誤り（存在しないファイルパス・コマンド等）があれば修正する。問題なければ変更なし。

- [ ] **Step 2: 全 `.md` ファイルの内部リンクを確認する**

  ```bash
  grep -rn "\[.*\](\..*\.md)" docs/ CLAUDE.md --include="*.md" | grep -v "archive/"
  ```
  表示されたリンク先ファイルが実際に存在するか確認する。

- [ ] **Step 3: リンク切れを修正する**

  存在しないファイルへのリンクがあれば、正しいパスに更新するか削除する。

- [ ] **Step 4: 変更があればコミットする**

  ```bash
  git add docs/MCP_SETUP_GUIDE.md
  # 他に変更があればそのファイルも add
  git commit -m "docs: MCP_SETUP_GUIDE.md 検証・リンク切れ修正"
  ```
  変更がない場合はスキップ。

---

### Task 9: Phase 6 — `docs/superpowers/specs/2026-03-15-system-overview-design.md` 新規作成

**Files:**
- Create: `docs/superpowers/specs/2026-03-15-system-overview-design.md`
- Read: `CLAUDE.md`（更新済み版）、`docs/ARCHITECTURE.md`（更新済み版）

- [ ] **Step 1: 更新済みの CLAUDE.md と ARCHITECTURE.md を読んで正確な情報を把握する**

- [ ] **Step 2: システム概要仕様書を作成する**

  以下の構成で記述する:

  ```markdown
  # システム概要仕様書

  **作成日**: 2026-03-15
  **対象読者**: 新規開発者・AIエージェント

  ---

  ## 1. システム目的
  （1-2文で要約）

  ## 2. 3層アーキテクチャ
  - サービス管理者層: /admin で全店舗管理
  - 店舗管理者層: /{storeId}/admin で自店舗管理
  - 顧客層: 静的 HTML フォーム（LINE LIFF 経由）

  ## 3. データ層戦略
  - Local: JSON ファイル（data/ ディレクトリ）
  - Staging/Production: Supabase PostgreSQL（RLS 必須）
  - 環境切り替え: NEXT_PUBLIC_APP_ENV

  ## 4. 主要データフロー
  - フォーム作成 → normalizeForm() → DB 保存
  - フォームデプロイ → 静的 HTML 生成 → Supabase Storage アップロード
  - 顧客アクセス → /api/public-form/* プロキシ → 静的 HTML 表示
  - 予約受付 → LINE LIFF → POST /api/reservations → CRM 自動紐付け

  ## 5. 主要コンポーネント（src/lib/ 配下の役割）

  以下を最低限すべて記載する（省略禁止）:
  - `form-normalizer.ts` — 後方互換性正規化（normalizeForm()）
  - `static-generator-reservation.ts` — 予約フォーム静的 HTML 生成
  - `static-generator-survey.ts` — アンケートフォーム静的 HTML 生成
  - `supabase-storage-deployer.ts` — Storage アップロード/デプロイ
  - `customer-utils.ts` — CRM 顧客管理・セグメント分類
  - `google-calendar.ts` — Google Calendar API 操作
  - `google-calendar-token.ts` — OAuth トークン暗号化
  - `auth-helper.ts` — 認証ヘルパー（getCurrentUser()）
  - `env.ts` — 環境検出（getAppEnvironment()・shouldSkipAuth()）
  - `supabase.ts` — Supabase クライアントファクトリ

  ## 6. 環境別挙動

  以下3環境の違いをすべて記載する（省略禁止）:
  - **Local（NEXT_PUBLIC_APP_ENV=local）**: JSON ファイル（data/）・認証スキップ・Storage モック
  - **Staging**: 既存 Supabase プロジェクト・RLS 有効・実 Storage 使用
  - **Production**: 独立 Supabase プロジェクト・RLS 有効・実 Storage 使用

  ## 7. 重要な制約（新規参加者・AIエージェントが犯しやすいミス）

  以下をすべて記載する（省略禁止）:
  - pnpm 必須（npm/yarn 禁止）
  - 任意ソースからフォームを読む際は必ず normalizeForm() を通す
  - PUT リクエストはフォームオブジェクト全体を送る（部分更新なし）
  - src/ 配下の JSON 直接編集禁止（API ルート経由のみ）
  - Vercel Blob 使用禁止（Supabase Storage のみ）
  - コミット前に pnpm type-check 必須
  ```

- [ ] **Step 3: ファイル作成を確認する**

  ```bash
  ls docs/superpowers/specs/2026-03-15-system-overview-design.md
  wc -l docs/superpowers/specs/2026-03-15-system-overview-design.md
  ```
  期待出力: ファイルが存在し、60行以上あること

- [ ] **Step 4: コミットする**

  ```bash
  git add docs/superpowers/specs/2026-03-15-system-overview-design.md
  git commit -m "docs: システム概要仕様書を新規作成（新規開発者・AIエージェント向け）"
  ```

---

## Chunk 6: Phase 7 — 最終検証とコミット

### Task 10: 成功基準の検証

**Files:**
- Read only（検証のみ）

- [ ] **Step 1: subdomain/custom_domain の記述がないことを確認する**

  ```bash
  grep -r "subdomain\|custom_domain" docs/ CLAUDE.md .github/copilot-instructions.md --include="*.md" | grep -v "docs/archive/" | grep -v "docs/audit-report.md"
  ```
  期待出力: **ゼロ件**（`.github/copilot-instructions.md` も含めて確認する）

- [ ] **Step 2: 新機能の記述があることを確認する**

  ```bash
  grep "notice\|hide_price\|common_options\|customer_visits\|customer-utils" CLAUDE.md docs/ARCHITECTURE.md
  ```
  期待出力: 記述あり（`notice`・`customer_visits`・`customer-utils` は最低限存在すること）

- [ ] **Step 3: アーカイブ5ファイルの存在を確認する**

  ```bash
  ls docs/archive/DEV_BRANCH_SETUP.md \
     docs/archive/DEV_TO_STAGING_MERGE_GUIDE.md \
     docs/archive/STAGING_VS_DEV_CONFLICT_DIFFERENCES.md \
     "docs/archive/SETUP _SUPERBASE.md" \
     docs/archive/URL_MIGRATION_SUMMARY.md
  ```
  期待出力: 5ファイルすべてが存在する

- [ ] **Step 4: AGENTS.md が削除されていることを確認する**

  ```bash
  ls AGENTS.md 2>/dev/null && echo "STILL EXISTS - 要削除" || echo "OK: 削除済み"
  ```
  期待出力: `OK: 削除済み`

- [ ] **Step 5: audit-report.md と system-overview-design.md が存在することを確認する**

  ```bash
  ls docs/audit-report.md docs/superpowers/specs/2026-03-15-system-overview-design.md
  ```
  期待出力: 両ファイルが存在する

- [ ] **Step 6: API_SPECIFICATION.md に LINE Webhook・CRM・Google Calendar の記述があることを確認する**

  ```bash
  grep "webhooks/line\|customers\|google-calendar" docs/API_SPECIFICATION.md
  ```
  期待出力: 記述あり

- [ ] **Step 7: `pnpm type-check` を実行する**

  ```bash
  pnpm type-check
  ```
  期待出力: エラーゼロ。もし `src/` ファイルが誤って変更されていた場合はここで検知できる。

- [ ] **Step 8: 最終コミット（未コミットの変更がある場合）**

  ```bash
  git status
  # 未コミットの変更がある場合のみ実行:
  git add -A
  git commit -m "docs: ドキュメント整理・最新化 完了（全成功基準クリア）"
  ```
