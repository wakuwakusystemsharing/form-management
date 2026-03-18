# ドキュメント監査レポート

**生成日**: 2026-03-15
**対象**: fca7cc4 以降のコード変更とドキュメントの乖離

---

## 1. コードに存在しない記述（削除が必要）

### 1-1. `subdomain` / `custom_domain` カラム（マイグレーション `20260308000000_remove_subdomain_columns.sql` で削除済み）

コードの現状: `src/types/store.ts` の `Store` 型に `subdomain`・`custom_domain` フィールドは存在しない。`src/middleware.ts` もサブドメイン検出ロジックを持たない。

| ファイル | 行番号 | 記述内容 | 対処 |
|---|---|---|---|
| `CLAUDE.md` | 197 | `Middleware がホスト名からサブドメインを検出（{subdomain}.nas-rsv.com）` | 削除 |
| `CLAUDE.md` | 198 | `Supabase の subdomain または custom_domain カラムで店舗を検索` | 削除 |
| `CLAUDE.md` | 329 | `stores` テーブル説明に `subdomain、custom_domain` | 削除 |
| `docs/ARCHITECTURE.md` | 116 | `サブドメイン経由でのアクセス: {subdomain}.{base-domain} → /{storeId}/admin` | 削除 |
| `docs/ARCHITECTURE.md` | 117-119 | サブドメイン/カスタムドメインリダイレクト例 3行 | 削除 |
| `docs/ARCHITECTURE.md` | 198 | `stores` テーブル説明の `subdomain, custom_domain` | `subdomain`・`custom_domain` を除去 |
| `docs/ARCHITECTURE.md` | 356 | `subdomain?: string; // サブドメイン（例: st0001）` | 削除 |
| `docs/ARCHITECTURE.md` | 357 | `custom_domain?: string; // カスタムドメイン（例: example.com）` | 削除 |
| `docs/API_SPECIFICATION.md` | 49-50 | レスポンス例の `"subdomain": "st0001"`, `"custom_domain": null` | 削除 |
| `docs/API_SPECIFICATION.md` | 110-111 | PUT リクエストボディ例の `"subdomain"`, `"custom_domain"` | 削除 |
| `docs/API_SPECIFICATION.md` | 116-117 | `subdomain`・`custom_domain` のバリデーション規則説明 | 削除 |
| `docs/API_SPECIFICATION.md` | 602-603 | 環境比較表の「サブドメイン」「カスタムドメイン」行 | 削除 |
| `docs/DATABASE_MIGRATION.md` | 167-188 | `20250202000000_add_subdomain_columns.sql` のセクション全体 | 「`20260308000000_remove_subdomain_columns.sql` で削除済み」と注記するか削除 |

### 1-2. `VercelBlobDeployer` / Vercel Blob 言及

コードの現状: `src/lib/vercel-blob-deployer.ts` はファイルとして存在するが、CLAUDE.md は「削除予定」と記載。`src/lib/env.ts` の `shouldUseMockBlob()` は `BLOB_READ_WRITE_TOKEN` を参照しており、Vercel Blob への依存が完全には除去されていない。

| ファイル | 行番号 | 記述内容 | 対処 |
|---|---|---|---|
| `CLAUDE.md` | 209 | `VercelBlobDeployer は削除予定` | ファイルパス `src/lib/vercel-blob-deployer.ts` を明記し、実削除待ち状態であることを補強 |
| `src/lib/env.ts` | 37-39 | `shouldUseMockBlob()` 関数が `BLOB_READ_WRITE_TOKEN` を参照 | ドキュメント側で「env.ts に shouldUseMockBlob() が残存」と注記（コード変更はスコープ外） |

### 1-3. Next.js バージョン不一致

| ファイル | 行番号 | 記述内容 | 対処 |
|---|---|---|---|
| `docs/ARCHITECTURE.md` | 24 | `Next.js 15 (App Router)` | `Next.js 16 (App Router)` に修正 |

### 1-4. `static-generator-old.ts.bak` の残存

コードの現状: `src/lib/static-generator-old.ts.bak` がリポジトリに残存している。CLAUDE.md のコード整理ポリシーは「`*-old.ts` は即削除」と規定。

| ファイル | 行番号 | 記述内容 | 対処 |
|---|---|---|---|
| `CLAUDE.md` | 224 | 「`*-old.ts` … は即座に削除」と明記 | `src/lib/static-generator-old.ts.bak` の実削除をドキュメントに TODO として追記 |

### 1-5. `Form` 型の `form_name` / `line_settings` フィールド（docs/ARCHITECTURE.md のデータモデル）

コードの現状: `src/types/form.ts` の `Form` インターフェース（179-190行）には `form_name` および `line_settings` フィールドが存在しない。これらは `config.basic_info.form_name` 内に格納される。

| ファイル | 行番号 | 記述内容 | 対処 |
|---|---|---|---|
| `docs/ARCHITECTURE.md` | 308-309 | `Form` 型定義に `form_name: string` / `line_settings?: { liff_id: string }` | 実際の型と一致させる（フィールドは `config.basic_info` 内に存在） |

### 1-6. `CustomerSegment` の値不一致

コードの現状:
- `src/types/form.ts` 635行: `CustomerSegment = 'new' | 'repeat' | 'vip' | 'dormant'`
- `src/lib/customer-utils.ts` 334行: `return 'dormant'` を実際に使用

| ファイル | 行番号 | 記述内容 | 対処 |
|---|---|---|---|
| `CLAUDE.md` | 115 | `at_risk`（離脱リスク）として記載 | `dormant` に修正（コードは `dormant` を使用） |

### 1-7. `FormConfig.basic_info` の `notice` フィールド（docs での未記載ではなく誤った説明）

コードの現状: `src/types/form.ts` 75行に `notice?: string` が存在するが、`docs/ARCHITECTURE.md` の `FormConfig` 型記述（317-348行）には含まれていない。

| ファイル | 行番号 | 記述内容 | 対処 |
|---|---|---|---|
| `docs/ARCHITECTURE.md` | 317-325 | `FormConfig.basic_info` の定義に `notice` フィールドなし | `notice?: string` を追記 |

---

## 2. コードに存在するが未記載の機能・API

### 2-1. API エンドポイント（`docs/API_SPECIFICATION.md` に未掲載）

以下のルートファイルが `src/app/api/` に存在するが、`docs/API_SPECIFICATION.md` に記載がない:

| 機能/API | 追記先ドキュメント |
|---|---|
| `GET /api/integrations/google-calendar/connect` — Google OAuth 認証開始 | `docs/API_SPECIFICATION.md` に新セクション「Google Calendar 連携 API」追加 |
| `GET /api/integrations/google-calendar/callback` — Google OAuth コールバック | 同上 |
| `GET /api/stores/{storeId}/calendar` — カレンダー連携状態取得 | 同上 |
| `PUT /api/stores/{storeId}/calendar` — カレンダー ID 設定 | 同上 |
| `POST /api/stores/{storeId}/calendar/disconnect` — カレンダー連携解除 | 同上 |
| `GET /api/stores/{storeId}/calendar/availability` — 空き状況取得 | 同上 |
| `GET /api/stores/{storeId}/customers` — 顧客一覧 | `docs/API_SPECIFICATION.md` に新セクション「顧客管理（CRM）API」追加 |
| `POST /api/stores/{storeId}/customers` — 顧客作成 | 同上 |
| `GET /api/stores/{storeId}/customers/{customerId}` — 顧客詳細 | 同上 |
| `PUT /api/stores/{storeId}/customers/{customerId}` — 顧客更新 | 同上 |
| `DELETE /api/stores/{storeId}/customers/{customerId}` — 顧客削除 | 同上 |
| `GET /api/stores/{storeId}/customers/analytics` — 顧客分析 | 同上 |
| `POST /api/webhooks/line` — LINE Messaging API Webhook | `docs/API_SPECIFICATION.md` に新セクション「Webhook API」追加 |
| `GET /api/stores/{storeId}/surveys/responses` — アンケート回答一覧 | `docs/API_SPECIFICATION.md` のアンケートセクションに追加 |
| `POST /api/surveys/submit` — アンケート回答送信（顧客向け） | 同上 |
| `GET /api/admin/settings` — サービス管理者設定取得/更新 | `docs/API_SPECIFICATION.md` に新セクション「管理者設定 API」追加 |

### 2-2. `FormConfig` の未記載フィールド

| 機能/API | 追記先ドキュメント |
|---|---|
| `FormConfig.basic_info.notice` (フォーム上部注意書き) — `src/types/form.ts` L75 | `docs/ARCHITECTURE.md` の FormConfig 型説明、`docs/API_SPECIFICATION.md` |
| `MenuItem.hide_price` / `SubMenuItem.hide_price` / `MenuOption.hide_price` (料金非表示フラグ) — `src/types/form.ts` L9, L20, L39 | `docs/ARCHITECTURE.md` の型説明 |
| `FormConfig.calendar_settings.booking_mode` ('calendar' | 'multiple_dates') — `src/types/form.ts` L138 | `docs/ARCHITECTURE.md`, `docs/API_SPECIFICATION.md` |
| `FormConfig.calendar_settings.multiple_dates_settings` — `src/types/form.ts` L140-146 | `docs/ARCHITECTURE.md`, `docs/API_SPECIFICATION.md` |
| `FormConfig.security_secret` / `FormConfig.form_type` ('line' | 'web') — `src/types/form.ts` L164-165 | `docs/ARCHITECTURE.md`, `docs/API_SPECIFICATION.md` |

### 2-3. `Store` 型の未記載フィールド

| 機能/API | 追記先ドキュメント |
|---|---|
| `Store.google_calendar_source: 'system' \| 'store_oauth'` — `src/types/store.ts` L16 | `docs/ARCHITECTURE.md` の Store 型説明 |
| `Store.logo_url` / `Store.theme_color` — `src/types/store.ts` L12-13 | `docs/ARCHITECTURE.md` の Store 型説明 |

### 2-4. 環境モードの `development` の扱い

コードの現状: `src/lib/env.ts` L5 に `'development'` 環境値が定義されており、`getBaseUrl()` でも分岐している。

| 機能/API | 追記先ドキュメント |
|---|---|
| `NEXT_PUBLIC_APP_ENV=development` 環境値（4番目の環境） | `CLAUDE.md` の環境変数説明、`docs/SETUP.md`, `docs/ARCHITECTURE.md` |

### 2-5. CRM 関連テーブル・型

| 機能/API | 追記先ドキュメント |
|---|---|
| `customer_interactions` テーブル（`src/types/form.ts` L570-616 に型定義あり） | `docs/ARCHITECTURE.md` の DB テーブル一覧 |
| `CustomerType: 'new' \| 'regular' \| 'vip' \| 'inactive'`（DB カラム値） vs `CustomerSegment: 'new' \| 'repeat' \| 'vip' \| 'dormant'`（分類ロジック値）の区別 | `docs/ARCHITECTURE.md`, `CLAUDE.md` |

### 2-6. マイグレーション未記載

| 機能/API | 追記先ドキュメント |
|---|---|
| `20260308000000_remove_subdomain_columns.sql` — subdomain/custom_domain 削除 | `docs/DATABASE_MIGRATION.md` に新セクション追加 |
| `20250203000000_add_line_user_id_to_reservations_surveys.sql` | `docs/DATABASE_MIGRATION.md` |
| `20250204000000_add_crm_tables.sql` | `docs/DATABASE_MIGRATION.md` |
| `20250205000000_optimize_crm_rls_policies.sql` | `docs/DATABASE_MIGRATION.md` |
| `20250206000000_staging_sync_with_dev_schema.sql` | `docs/DATABASE_MIGRATION.md` |
| `20250211000000_add_google_calendar_oauth_columns.sql` | `docs/DATABASE_MIGRATION.md` |
| `20250212000000_add_reservations_google_calendar_event_id.sql` | `docs/DATABASE_MIGRATION.md` |
| `20250131000000_remove_store_id_default.sql` | `docs/DATABASE_MIGRATION.md` |
| `20250131000001_rename_rls_policies_to_english.sql` | `docs/DATABASE_MIGRATION.md` |
| `20250201000000_add_reservation_analysis_columns.sql` | `docs/DATABASE_MIGRATION.md` |
| `20250202000000_safe_add_forms_status.sql` | `docs/DATABASE_MIGRATION.md` |

---

## 3. 具体的な修正指示

### CLAUDE.md

1. **197-199行** サブドメイン検出ロジックの説明を削除。Middleware の実際の役割（UI ページアクセス制御のみ、サブドメイン検出なし）に差し替え。
2. **329行** `stores` テーブルの `subdomain`、`custom_domain` を除去。代わりに `google_calendar_source` の説明を補強。
3. **115行** `at_risk` を `dormant` に修正（`src/types/form.ts` L635 の `CustomerSegment` 型と整合）。
4. **209行** `VercelBlobDeployer は削除予定` を `src/lib/vercel-blob-deployer.ts` に残存・削除未了である旨を明記。
5. 環境変数セクションに `NEXT_PUBLIC_APP_ENV=development`（dev ブランチ向け Vercel プレビュー環境）の説明を追加。

### .github/copilot-instructions.md

- `subdomain`・`custom_domain` の言及なし（修正不要）。
- セクション 6「Supabase Storage デプロイ」内の `vercel-blob-deployer.ts は非推奨` 記述はそのまま維持。
- セクション 1「環境モードと挙動」に `development` 環境の記述が欠落しているため、`local/staging/production` の列挙に追加。

### docs/ARCHITECTURE.md

1. **24行** `Next.js 15` を `Next.js 16` に修正。
2. **115-119行** サブドメイン・カスタムドメインアクセス説明ブロックを削除。
3. **198行** `stores` テーブルの `subdomain, custom_domain` を削除し、`google_calendar_source` を追記。
4. **317-348行** `FormConfig` 型定義に `basic_info.notice`・`booking_mode`・`multiple_dates_settings`・`form_type`・`security_secret` を追記。
5. **354-383行** `Store` 型定義から `subdomain`・`custom_domain` を削除。`google_calendar_source`・`logo_url`・`theme_color` を追記。
6. **198-213行** DB テーブル一覧に `customers`・`customer_visits`・`customer_interactions` を追加。
7. **484行** 「最終更新: 2025年12月」を「最終更新: 2026年3月」に更新。

### docs/API_SPECIFICATION.md

1. **49-50行** `GET /api/stores` レスポンス例から `subdomain`・`custom_domain` フィールドを削除。
2. **110-117行** `PUT /api/stores/{storeId}` リクエストボディから `subdomain`・`custom_domain` とそのバリデーション説明を削除。
3. **602-603行** 環境比較表の「サブドメイン」「カスタムドメイン」行を削除。
4. 新セクション「Google Calendar 連携 API」を追加（6エンドポイント）。
5. 新セクション「顧客管理（CRM）API」を追加（6エンドポイント）。
6. 新セクション「Webhook API」を追加（`POST /api/webhooks/line`）。
7. アンケートセクションに `GET /api/stores/{storeId}/surveys/responses`・`POST /api/surveys/submit` を追記。
8. 新セクション「管理者設定 API」を追加（`GET/PUT /api/admin/settings`）。
9. **619行** 「最終更新: 2025年12月」を「最終更新: 2026年3月」に更新。

### docs/DATABASE_MIGRATION.md

1. **167-188行** `20250202000000_add_subdomain_columns.sql` セクションに「このカラムは `20260308000000_remove_subdomain_columns.sql`（2026-03-08 実行）で削除済み」の注記を追加。
2. 以下の未記載マイグレーションのセクションを新規追加（`supabase/migrations/` 内に実ファイルあり）:
   - `20250131000000_remove_store_id_default.sql`
   - `20250131000001_rename_rls_policies_to_english.sql`
   - `20250201000000_add_reservation_analysis_columns.sql`
   - `20250202000000_safe_add_forms_status.sql`
   - `20250203000000_add_line_user_id_to_reservations_surveys.sql`
   - `20250204000000_add_crm_tables.sql`
   - `20250205000000_optimize_crm_rls_policies.sql`
   - `20250206000000_staging_sync_with_dev_schema.sql`
   - `20250211000000_add_google_calendar_oauth_columns.sql`
   - `20250212000000_add_reservations_google_calendar_event_id.sql`
   - `20260308000000_remove_subdomain_columns.sql`（新規追加・削除内容を明記）

### docs/WORKFLOW.md

- `subdomain`・`custom_domain` の言及なし（修正不要）。
- 「最終更新」日付が古い場合は更新。

### docs/SETUP.md

- `subdomain`・`custom_domain` の言及なし（修正不要）。
- `NEXT_PUBLIC_APP_ENV` の値リストに `development` を追加（現状 `local/staging/production` のみ記載）。
- `src/lib/env.ts` L37-39 の `shouldUseMockBlob()` が参照する `BLOB_READ_WRITE_TOKEN` 環境変数が `.env.local.example` に含まれているか確認・追記。

### docs/SUPABASE_BEST_PRACTICES.md

- `subdomain`・`custom_domain` の言及なし（修正不要）。
- `anon` / `service_role` から `publishable` / `secret` キーへの移行状況をコードと照合し、現行の環境変数名（`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`）との整合を確認。

### docs/STORE_ADMIN_MANAGEMENT.md

- `subdomain`・`custom_domain` の言及なし（修正不要）。
- 管理者追加 UI の説明（40行付近）で「権限を選択（admin または staff）」と記載されているが、`store_admins` テーブルに `role` カラムが存在しないことをマイグレーション `20250128000000` で確認済み。権限選択説明を削除または「role カラムは削除済み・全員 admin 扱い」と修正。

### docs/BRANCH_PROTECTION.md

- `subdomain`・`custom_domain` の言及なし（修正不要）。
- 内容はコードと概ね整合しているため、大きな修正は不要。

### docs/SUPABASE_STORAGE_SETUP.md

- `subdomain`・`custom_domain` の言及なし（修正不要）。
- 内容はコードと概ね整合しているため、大きな修正は不要。

---

## 付記: 監査対象外ファイル

以下のファイルは過去の比較資料または作業計画であり、ユーザー向けリファレンスではないため今回の修正対象から除外する:

- `docs/DEV_TO_STAGING_MERGE_GUIDE.md`
- `docs/STAGING_VS_DEV_CONFLICT_DIFFERENCES.md`
- `docs/superpowers/` 以下のファイル群
