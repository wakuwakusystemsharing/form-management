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
- `static_deploy` (jsonb) - Vercel Blob デプロイ情報
- `last_published_at` (timestamptz) - 最終公開日時
- `form_name` (text) - フォーム名（新形式）
- `line_settings` (jsonb) - LINE設定（LIFF ID等）
- `gas_endpoint` (text) - Google Apps Script エンドポイント
- `ui_settings` (jsonb) - UI設定（テーマカラー等）

#### 変更されたカラム
- `name` カラム - NULL許可に変更（後方互換性のため）

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
gas_endpoint        | text        |                              | YES
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

