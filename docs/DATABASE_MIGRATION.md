# データベースマイグレーションガイド

このドキュメントでは、Supabaseデータベースのマイグレーション履歴と手順を説明します。

## 📋 マイグレーション履歴

### `20250101000000_initial_schema.sql` - 初期スキーマ

**実行状況**: ✅ 実行済み（一部カラム不足）

基本的なテーブル構造を作成：
- `stores` テーブル
- `forms` テーブル（基本構造）
- `reservations` テーブル
- `store_admins` テーブル

### `20250116000000_update_draft_status.sql` - formsテーブル拡張

**実行状況**: ✅ 自動実行済み（Supabase MCP経由）

#### 追加されたカラム

**`forms` テーブル**:
- `status` (text) - フォームステータス ('active' | 'inactive')
- `draft_status` (text) - 下書きステータス ('none' | 'draft' | 'ready_to_publish')
- `static_deploy` (jsonb) - Supabase Storage デプロイ情報（deploy_url, storage_url, deployed_at, status等）
- `last_published_at` (timestamptz) - 最終公開日時
- `form_name` (text) - フォーム名（新形式）
- `line_settings` (jsonb) - LINE設定（LIFF ID等）
- `ui_settings` (jsonb) - UI設定（テーマカラー等）

#### 変更されたカラム
- `name` カラム - NULL許可に変更（後方互換性のため）

### `20250125000000_add_survey_forms.sql` - survey_formsテーブル追加

**実行状況**: ✅ 実行済み

アンケートフォーム機能のためのテーブルを作成：
- `survey_forms` テーブル（基本構造）

### `20250127000000_add_stores_columns.sql` - storesテーブル拡張

**実行状況**: ✅ 実行済み

**目的**: storesテーブルに不足していたカラムを追加

#### 追加されたカラム

**`stores` テーブル**:
- `owner_name` (text, NOT NULL) - オーナー名
- `owner_email` (text, NOT NULL) - オーナーメールアドレス
- `phone` (text, nullable) - 電話番号
- `address` (text, nullable) - 住所
- `website_url` (text, nullable) - ウェブサイトURL
- `status` (text, NOT NULL, default 'active') - 店舗ステータス ('active' | 'inactive')

**インデックス**:
- `idx_stores_status` - statusカラム用インデックス

### `20250128000000_sync_production_with_staging.sql` - ProductionとStagingの構造同期

**実行状況**: ✅ 実行済み（2025-01-28）

**目的**: Production 環境のデータベース構造を Staging 環境と完全に一致させる

#### 主な変更点

**`stores` テーブル**:
- `status` カラムを削除（Staging には存在しない）- 注意: このマイグレーションは `20250127000000_add_stores_columns.sql` と矛盾する可能性があるため、実際の環境に応じて調整が必要

**`survey_forms` テーブル**:
- `name` カラムを追加（NOT NULL）- アンケートフォーム名
- `public_url` カラムを追加 - 公開URL（現在は使用されていない、`static_deploy`内の`deploy_url`を使用）
- `storage_url` カラムを追加 - ストレージURL（現在は使用されていない、`static_deploy`内の`storage_url`を使用）
- `status` のデフォルト値を `'draft'` に変更
- `status` の CHECK 制約を更新（'active', 'inactive', 'paused', 'draft' を許可）

**`forms` テーブル**:
- `name` カラムを追加（NULL許可）
- `form_name` カラムを追加
- `line_settings` カラムを追加（JSONB）
- Google Calendar 連携のため `stores.google_calendar_id` を追加
- LINE 連携のため `stores.line_channel_access_token` を追加
- 管理者設定 `admin_settings` テーブルを追加
- `ui_settings` カラムを追加（JSONB）

**`reservations` テーブル**:
- `customer_email` カラムを追加

**`store_admins` テーブル**:
- `role` カラムを削除（Staging には存在しない）
- `updated_at` カラムを削除（Staging には存在しない）

**重要**: このマイグレーションにより、Production と Staging のデータベース構造が完全に一致しました。

### `20250129000000_change_store_id_to_6chars.sql` - ストアID形式変更

**実行状況**: ✅ 実行済み

**目的**: ストアIDを6文字のランダム文字列に変更（既存データはUUID形式のまま維持）

#### 主な変更点

**`stores` テーブル**:
- IDカラムのコメントを更新: 「店舗ID: 6文字のランダム文字列（新規）またはUUID形式（既存データ）」

**注意**: 
- このマイグレーションはデータベースのデフォルト値を変更しません
- アプリケーション側で6文字のランダムIDを生成して挿入します
- 既存のUUID形式のIDを持つ店舗データはそのまま維持されます（後方互換性）
- ミドルウェアは両方の形式に対応（`/[a-z0-9]{6}/` または `/st\d{4}/`）

### `20250130000000_change_stores_id_to_text.sql` - ストアIDカラム型変更

**実行状況**: ✅ 実行済み（Staging）

**目的**: `stores.id` および関連テーブルの `store_id` カラムを `UUID` 型から `TEXT` 型に変更

#### 主な変更点

**`stores` テーブル**:
- `id` カラムを `UUID` 型から `TEXT` 型に変更

**関連テーブル**:
- `forms.store_id` を `UUID` 型から `TEXT` 型に変更
- `reservations.store_id` を `UUID` 型から `TEXT` 型に変更
- `store_admins.store_id` を `UUID` 型から `TEXT` 型に変更
- `survey_forms.store_id` を `UUID` 型から `TEXT` 型に変更

**RLSポリシー**:
- すべてのRLSポリシーを一時的に削除し、型変更後に再作成

**外部キー制約**:
- すべての外部キー制約を一時的に削除し、型変更後に再作成

**注意**: 
- 既存のUUIDデータは自動的にTEXT形式に変換されます（ハイフンなしの32文字）
- 新規作成される店舗は6文字のランダム文字列を使用
- 既存のUUID形式のIDを持つ店舗データはそのまま維持されます（後方互換性）

### `20251204000000_create_survey_forms.sql` - survey_formsテーブル作成（再作成）

**実行状況**: ✅ 実行済み

**目的**: survey_formsテーブルを再作成（`20250125000000_add_survey_forms.sql`と重複する可能性あり）

#### 主な変更点

**`survey_forms` テーブル**:
- テーブル作成（既に存在する場合はスキップ）
- `id` (text) - アンケートフォームID（12文字ランダム文字列）
- `store_id` (text, NOT NULL) - 店舗ID（外部キー）
- `status` (text, default 'inactive') - 'active' | 'inactive' | 'paused'
- `draft_status` (text, default 'draft') - 'none' | 'draft' | 'ready_to_publish'
- `config` (jsonb) - アンケート設定
- `draft_config` (jsonb, nullable) - 下書き設定
- `static_deploy` (jsonb, nullable) - デプロイ情報
- `created_at`, `updated_at` (timestamptz)
- `last_published_at` (timestamptz, nullable)

**インデックス**:
- `idx_survey_forms_store_id` - store_id用インデックス

**注意**: `20250125000000_add_survey_forms.sql` と重複する可能性がありますが、`IF NOT EXISTS` を使用しているため問題ありません

### `20250131000000_remove_store_id_default.sql` - stores.id デフォルト値削除

**実行状況**: ✅ 実行済み

**目的**: `stores.id` のデフォルト値（UUID 自動生成）を削除。アプリケーション側で 6 文字のランダム ID を必ず指定するため。

#### 主な変更点

**`stores` テーブル**:
- `id` カラムのデフォルト値を削除（`gen_random_uuid()` を除去）

---

### `20250131000001_rename_rls_policies_to_english.sql` - RLS ポリシー名を英語に統一

**実行状況**: ✅ 実行済み

**目的**: 日本語名の RLS ポリシーを英語名に変更し、国際化対応と可読性を向上。

#### 主な変更点
- `stores`、`forms`、`reservations`、`store_admins`、`survey_forms`、`surveys` テーブルの RLS ポリシーを全て英語名に再作成（例: `"store_admin_stores_select"`）

---

### `20250201000000_add_reservation_analysis_columns.sql` - 予約分析用カラム追加

**実行状況**: ✅ 実行済み

**目的**: 予約データの分析・集計に対応するため、構造化データを JSONB で保存。

#### 追加されたカラム

**`reservations` テーブル**:
- `selected_menus` (JSONB, default `[]`) - 選択メニュー情報（ID・名前・価格・サブメニュー等）
- `selected_options` (JSONB, default `[]`) - 選択オプション情報
- `customer_info` (JSONB, default `{}`) - 顧客属性（性別・来店回数・クーポン使用等）

**インデックス**:
- `idx_reservations_selected_menus_gin` - GIN インデックス（JSONB 検索高速化）
- `idx_reservations_selected_options_gin` - GIN インデックス
- `idx_reservations_customer_info_gin` - GIN インデックス

---

### `20250202000000_safe_add_forms_status.sql` - forms.status カラム安全追加

**実行状況**: ✅ 実行済み

**目的**: `forms` テーブルに `status` カラムが存在しない環境への安全な追加（既に存在する場合はスキップ）。

#### 追加されたカラム

**`forms` テーブル**:
- `status` (text, NOT NULL, default `'inactive'`) - チェック制約: `'active' | 'inactive'`

---

### `20250202000000_add_subdomain_columns.sql` - サブドメイン・カスタムドメインカラム追加

**実行状況**: ✅ 実行済み（⚠️ `20260308000000_remove_subdomain_columns.sql` で削除済み）

**目的**: 店舗ごとにサブドメインとカスタムドメインを設定可能にする（後に機能削除）

#### 追加されたカラム（現在は削除済み）

**`stores` テーブル**:
- `subdomain` (text, UNIQUE, nullable) - サブドメイン（例: st0001）※削除済み
- `custom_domain` (text, UNIQUE, nullable) - カスタムドメイン（例: example.com）※削除済み

**注意**: これらのカラムは `20260308000000_remove_subdomain_columns.sql`（2026-03-08 実行）で完全に削除されました。`src/types/store.ts` にも該当フィールドは存在しません。

### `20250203000000_add_line_user_id_to_reservations_surveys.sql` - LINE ユーザー ID カラム追加

**実行状況**: ✅ 実行済み

**目的**: LIFF から取得した LINE ユーザー ID を予約・アンケート回答に紐付けて保存。

#### 追加されたカラム

**`reservations` テーブル**:
- `line_user_id` (text, nullable) - LINE ユーザー ID（LIFF から取得）

**`surveys` テーブル**:
- `line_user_id` (text, nullable) - LINE ユーザー ID（LIFF から取得）

**インデックス**:
- `idx_reservations_line_user_id` (WHERE line_user_id IS NOT NULL)
- `idx_surveys_line_user_id` (WHERE line_user_id IS NOT NULL)

---

### `20250204000000_add_crm_tables.sql` - CRM テーブル追加

**実行状況**: ✅ 実行済み

**目的**: 顧客管理（CRM）機能のためのテーブルを追加。

#### 追加されたテーブル

**`customers` テーブル**（顧客マスタ）:
- `id` (text, PK) - 顧客 ID
- `store_id` (text, NOT NULL, FK → stores) - 店舗 ID
- `line_user_id` (text, nullable) - LINE ユーザー ID（同一店舗内でユニーク）
- `name` (text, NOT NULL) - 顧客名
- `name_kana` / `phone` / `email` / `birthday` / `gender` - 基本情報
- `customer_type` (text, default `'regular'`) - `'new' | 'regular' | 'vip' | 'inactive'`
- `total_visits` / `total_spent` / `first_visit_date` / `last_visit_date` - 統計情報
- LINE 連携情報（`line_display_name`, `line_picture_url` 等）

**`customer_visits` テーブル**（来店履歴）:
- 予約と顧客の紐付け、来店日・金額・メモ等を記録

**`customer_interactions` テーブル**（インタラクション履歴）:
- メモ・LINE 通知・スタッフコメント等を記録

RLS ポリシーを有効化（店舗管理者は自店舗の顧客データのみアクセス可）。

---

### `20250205000000_optimize_crm_rls_policies.sql` - CRM RLS ポリシー最適化

**実行状況**: ✅ 実行済み

**目的**: `auth.uid()` を各行で評価するパフォーマンス問題を修正。`(select auth.uid())` を使用してクエリあたり 1 回の評価に変更。

対象テーブル: `customers`、`customer_visits`、`customer_interactions`

---

### `20250206000000_staging_sync_with_dev_schema.sql` - Staging と Dev スキーマの同期

**実行状況**: ✅ 実行済み

**目的**: Staging DB を Dev スキーマに合わせて同期（`forms` テーブルの `reservation_forms` へのリネーム、CRM テーブル追加、LINE・subdomain カラム追加等）。

#### 主な変更点
- `forms` テーブルを `reservation_forms` にリネーム（一部環境）
- `stores` テーブルに `subdomain`、`custom_domain`、`created_by`、`updated_by` カラムを追加
- CRM テーブル（`customers`、`customer_visits` 等）の作成

**注意**: `subdomain`、`custom_domain` は後に `20260308000000_remove_subdomain_columns.sql` で削除済み。

---

### `20250211000000_add_google_calendar_oauth_columns.sql` - Google Calendar OAuth カラム追加

**実行状況**: ✅ 実行済み

**目的**: 店舗が自分の Google アカウントでカレンダーを連携できるよう、OAuth 関連カラムを追加。

#### 追加されたカラム

**`stores` テーブル**:
- `google_calendar_source` (text, NOT NULL, default `'system'`) - `'system' | 'store_oauth'`
- `google_calendar_refresh_token` (text, nullable) - 暗号化済み OAuth リフレッシュトークン（`google_calendar_source = 'store_oauth'` の場合）

---

### `20250212000000_add_reservations_google_calendar_event_id.sql` - 予約への Google Calendar イベント ID 追加

**実行状況**: ✅ 実行済み

**目的**: 予約キャンセル時に Google Calendar イベントを確実に削除できるよう、予約レコードにイベント ID を保存。

#### 追加されたカラム

**`reservations` テーブル**:
- `google_calendar_event_id` (text, nullable) - Google Calendar イベント ID

---

### `20260308000000_remove_subdomain_columns.sql` - サブドメイン・カスタムドメインカラム削除

**実行状況**: ✅ 実行済み（2026-03-08）

**目的**: サブドメイン・カスタムドメイン機能を廃止。関連する制約・インデックス・カラムを全て除去。

#### 削除された内容

**`stores` テーブル**:
- `subdomain` カラムを削除
- `custom_domain` カラムを削除

**制約・インデックス**:
- `stores_subdomain_unique` 制約を削除
- `stores_custom_domain_unique` 制約を削除
- `idx_stores_subdomain` インデックスを削除
- `idx_stores_custom_domain` インデックスを削除

**影響**:
- `src/types/store.ts` の `Store` 型からも `subdomain`・`custom_domain` フィールドが除去済み
- Middleware はサブドメイン検出を行わない（UI アクセス制御のみ）

---

## 🚀 新規環境へのマイグレーション手順

### 方法1: Supabase MCP経由（推奨）

`.cursor/mcp.json` を設定し、Cursor/Claude経由で実行：

```bash
# マイグレーションファイルを指定してCursorで実行
# 自動的に適用されます
```

### 方法2: Supabase Dashboard経由

1. [Supabase Dashboard](https://supabase.com/dashboard) にログイン
2. プロジェクトを選択 → **SQL Editor**
3. 以下の順番でマイグレーションを実行：

#### ステップ1: 初期スキーマ
```bash
# supabase/migrations/20250101000000_initial_schema.sql の内容をコピー
# SQL Editorに貼り付けて実行
```

#### ステップ2: formsテーブル拡張
```bash
# supabase/migrations/20250116000000_update_draft_status.sql の内容をコピー
# SQL Editorに貼り付けて実行
```

#### ステップ3: survey_formsテーブル追加
```bash
# supabase/migrations/20250125000000_add_survey_forms.sql の内容をコピー
# SQL Editorに貼り付けて実行
```

#### ステップ4: storesテーブル拡張
```bash
# supabase/migrations/20250127000000_add_stores_columns.sql の内容をコピー
# SQL Editorに貼り付けて実行
```

#### ステップ5: ストアID形式変更
```bash
# supabase/migrations/20250129000000_change_store_id_to_6chars.sql の内容をコピー
# SQL Editorに貼り付けて実行
```

#### ステップ6: survey_formsテーブル再作成（必要に応じて）
```bash
# supabase/migrations/20251204000000_create_survey_forms.sql の内容をコピー
# SQL Editorに貼り付けて実行
```

#### ステップ7: ProductionとStagingの構造同期（Production環境のみ）
```bash
# supabase/migrations/20250128000000_sync_production_with_staging.sql の内容をコピー
# SQL Editorに貼り付けて実行
# 注意: このマイグレーションは Production 環境で既に実行済み
```

### 方法3: Supabase CLI経由

```bash
# Supabase CLIをインストール
npm install -g supabase

# Supabaseにログイン
supabase login

# プロジェクトをリンク
supabase link --project-ref your-project-ref

# マイグレーションを適用
supabase db push
```

## 🔍 マイグレーション確認

### テーブル構造の確認

```sql
-- formsテーブルのカラム一覧
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'forms'
ORDER BY ordinal_position;
```

### 期待される結果

```
id                  | uuid        | gen_random_uuid()            | NO
store_id            | uuid        |                              | YES
name                | text        |                              | YES
form_name           | text        |                              | YES
config              | jsonb       | '{}'::jsonb                  | NO
status              | text        | 'inactive'::text             | NO
draft_status        | text        | 'none'::text                 | NO
static_deploy       | jsonb       |                              | YES
last_published_at   | timestamptz |                              | YES
line_settings       | jsonb       |                              | YES
ui_settings         | jsonb       |                              | YES
created_at          | timestamptz | timezone('utc', now())       | NO
updated_at          | timestamptz | timezone('utc', now())       | NO
```

## 🐛 トラブルシューティング

### エラー: "column does not exist"

**原因**: マイグレーションが未実行、または古いスキーマ

**解決策**:
1. 上記のマイグレーション確認SQLを実行
2. 不足しているカラムがある場合は、該当マイグレーションを再実行
3. Supabase MCP使用時は、自動で検出・適用される

### エラー: "constraint already exists"

**原因**: マイグレーションが既に実行済み

**解決策**:
- `DROP CONSTRAINT IF EXISTS` を使用しているため、通常は問題なし
- エラーが続く場合は、既存の constraint を手動削除:

```sql
ALTER TABLE forms DROP CONSTRAINT IF EXISTS forms_draft_status_check;
```

### エラー: "duplicate key value"

**原因**: 既存データとの競合

**解決策**:
1. 既存データを確認:
   ```sql
   SELECT id, form_name, status, draft_status FROM forms;
   ```
2. 必要に応じてデータをクリーンアップ

## 📝 マイグレーション作成ガイド

新しいマイグレーションを作成する場合：

1. ファイル名: `YYYYMMDDHHMMSS_description.sql`
2. 必ず `IF EXISTS` / `IF NOT EXISTS` を使用
3. ロールバック手順をコメントで記載
4. テストデータでの動作確認

例:
```sql
-- 20250120000000_add_new_feature.sql
-- 説明: 新機能のためのカラム追加

-- 追加
ALTER TABLE forms 
ADD COLUMN IF NOT EXISTS new_feature JSONB;

-- ロールバック（必要な場合）:
-- ALTER TABLE forms DROP COLUMN IF EXISTS new_feature;
```

## 🔗 関連ドキュメント

- [Supabaseベストプラクティス](./SUPABASE_BEST_PRACTICES.md)
- [セットアップガイド](./SETUP.md)
- [MCPセットアップガイド](./MCP_SETUP_GUIDE.md)

