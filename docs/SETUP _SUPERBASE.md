# Supabase Dashboard の設定ガイド

## 目次
1. [初期設定](#初期設定)
2. [データベーステーブル作成](#データベーステーブル作成)
3. [管理者アカウント作成](#管理者アカウント作成)
4. [RLS (Row Level Security) 設定](#rls-ポリシー設定)
5. [環境変数のコピー](#環境変数のコピー)
6. [動作確認](#動作確認)

---

## 初期設定

### 1. プロジェクト作成

> **📌 重要**: Staging と Production は **別々の Supabase プロジェクト** を使用します

#### Staging 用プロジェクト（既存プロジェクトを継続使用）

1. **既存の Supabase プロジェクトを staging 用として運用**
   - 既存プロジェクトをそのまま使用（新規作成不要）
   - プロジェクト名: `wakuwakusystemsharing-staging` など（既存のまま）

#### Production 用プロジェクト（新規作成）

1. https://supabase.com/dashboard にアクセス
2. **New Project** をクリック
3. 以下を設定：
   - **Name**: `wakuwakusystemsharing-prod` (本番用)
   - **Database Password**: 強力なパスワードを生成
   - **Region**: `Northeast Asia (Tokyo)` を選択
   - **Pricing Plan**: **Pro** (本番運用のため推奨)

### 2. Email Provider の有効化

1. 左メニュー → **Authentication** → **Providers**
2. **Email** を見つけて **Enable** をオン
3. **Confirm email** をオフにする（開発時のみ、本番はオン推奨）
4. **Save** をクリック

---

## データベーステーブル作成

> **📌 重要**: データベース構造は **マイグレーションファイル** を使用して作成・更新します。
> 手動で SQL を実行する場合は、以下のマイグレーションファイルを順番に実行してください。

### マイグレーションファイルの実行順序

1. **`20250101000000_initial_schema.sql`** - 初期スキーマ作成
2. **`20250116000000_update_draft_status.sql`** - forms テーブル拡張
3. **`20250125000000_add_survey_forms.sql`** - survey_forms テーブル追加
4. **`20250128000000_sync_production_with_staging.sql`** - Production と Staging の構造同期（Production 環境のみ）

### SQL Editor でマイグレーション実行

1. 左メニュー → **SQL Editor**
2. **New Query** をクリック
3. `supabase/migrations/` ディレクトリ内のマイグレーションファイルを順番にコピー＆ペーストして実行
4. **▶ Run** をクリックして実行
5. 成功メッセージが表示されることを確認

### テーブル構造の概要

#### `stores` テーブル（店舗情報）
- `id` (uuid) - 店舗ID（自動生成）
- `name` (text) - 店舗名
- `owner_name`, `owner_email` (text) - オーナー情報
- `phone`, `address`, `description`, `website_url` (text) - 店舗詳細
- `created_at`, `updated_at` (timestamptz)

#### `forms` テーブル（予約フォーム）
- `id` (uuid) - フォームID（自動生成）
- `store_id` (uuid) - 店舗ID（外部キー）
- `name` (text, nullable) - フォーム名（後方互換性のため）
- `form_name` (text, nullable) - フォーム名（新形式）
- `config` (jsonb) - フォーム設定
- `status` (text) - 'active' | 'inactive'
- `draft_status` (text) - 'none' | 'draft' | 'ready_to_publish'
- `static_deploy` (jsonb) - デプロイ情報
- `last_published_at` (timestamptz)
- `line_settings` (jsonb) - LINE設定
- `gas_endpoint` (text) - Google Apps Script URL
- `ui_settings` (jsonb) - UI設定
- `created_at`, `updated_at` (timestamptz)

#### `survey_forms` テーブル（アンケートフォーム）
- `id` (uuid) - アンケートフォームID（自動生成）
- `store_id` (uuid) - 店舗ID（外部キー、NOT NULL）
- `name` (text, NOT NULL) - アンケートフォーム名
- `config` (jsonb) - アンケート設定
- `status` (text, default 'draft') - 'active' | 'inactive' | 'paused' | 'draft'
- `draft_status` (text, default 'none') - 'none' | 'draft' | 'ready_to_publish'
- `public_url` (text, nullable) - 公開URL
- `storage_url` (text, nullable) - ストレージURL
- `static_deploy` (jsonb, nullable) - デプロイ情報
- `created_at`, `updated_at` (timestamptz)

#### `reservations` テーブル（予約データ）
- `id` (uuid) - 予約ID（自動生成）
- `form_id`, `store_id` (uuid) - 関連ID
- `customer_name` (text) - 顧客名
- `customer_email` (text, nullable) - 顧客メールアドレス
- `customer_phone` (text, nullable) - 顧客電話番号
- `reservation_date` (date) - 予約日
- `reservation_time` (time) - 予約時間
- `menu_items` (jsonb) - 選択メニュー
- `options` (jsonb) - 選択オプション
- `notes` (text, nullable) - 備考
- `created_at`, `updated_at` (timestamptz)

#### `store_admins` テーブル（店舗管理者）
- `id` (uuid) - 管理者ID（自動生成）
- `user_id` (uuid) - ユーザーID（外部キー）
- `store_id` (uuid) - 店舗ID（外部キー）
- `created_at` (timestamptz)

### テーブル確認

1. 左メニュー → **Table Editor**
2. 以下のテーブルが表示されていることを確認：
   - `stores`
   - `store_admins`
   - `forms`
   - `survey_forms`
   - `reservations`

> **📝 注意**: Production と Staging のデータベース構造は **完全に一致** しています（2025-01-28 に同期済み）。

---

## 管理者アカウント作成

### SQL で管理者アカウントを追加

1. 左メニュー → **SQL Editor** → **New Query**
2. 以下の SQL を実行：

```sql
-- サービス管理者アカウント作成
INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    recovery_token
) VALUES (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    'wakuwakusystemsharing@gmail.com',
    crypt('wakuwakuadmin', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now(),
    '',
    ''
) ON CONFLICT (email) DO NOTHING;
```

### アカウント確認

1. 左メニュー → **Authentication** → **Users**
2. `wakuwakusystemsharing@gmail.com` が表示されていることを確認

---

## RLS (Row-Level Security) 設定

### RLS ポリシーの設定

1. 左メニュー → **SQL Editor** → **New Query**
2. 以下の SQL を実行：

```sql
-- 1. RLS を有効化
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;

-- 2. サービス管理者用ポリシー（全データアクセス可能）
CREATE POLICY "admin_stores_all" ON stores
FOR ALL USING (
    auth.jwt() ->> 'email' IN (
        'wakuwakusystemsharing@gmail.com',
        'admin@wakuwakusystemsharing.com',
        'manager@wakuwakusystemsharing.com'
    )
);

CREATE POLICY "admin_forms_all" ON forms
FOR ALL USING (
    auth.jwt() ->> 'email' IN (
        'wakuwakusystemsharing@gmail.com',
        'admin@wakuwakusystemsharing.com',
        'manager@wakuwakusystemsharing.com'
    )
);

CREATE POLICY "admin_reservations_all" ON reservations
FOR ALL USING (
    auth.jwt() ->> 'email' IN (
        'wakuwakusystemsharing@gmail.com',
        'admin@wakuwakusystemsharing.com',
        'manager@wakuwakusystemsharing.com'
    )
);

CREATE POLICY "admin_store_admins_all" ON store_admins
FOR ALL USING (
    auth.jwt() ->> 'email' IN (
        'wakuwakusystemsharing@gmail.com',
        'admin@wakiwakusystemsharing.com',
        'manager@wakuwakusystemsharing.com'
    )
);

-- 3. 店舗管理者用ポリシー（自店舗のみアクセス可能）
CREATE POLICY "store_admin_stores" ON stores
FOR ALL USING (
    EXISTS (
        SELECT 1 FROM store_admins
        WHERE store_admins.store_id = stores.id
        AND store_admins.user_id = auth.uid()
    )
);

CREATE POLICY "store_admin_forms" ON forms
FOR ALL USING (
    EXISTS (
        SELECT 1 FROM store_admins
        WHERE store_admins.store_id = forms.store_id
        AND store_admins.user_id = auth.uid()
    )
);

CREATE POLICY "store_admin_reservations" ON reservations
FOR ALL USING (
    EXISTS (
        SELECT 1 FROM store_admins
        WHERE store_admins.store_id = reservations.store_id
        AND store_admins.user_id = auth.uid()
    )
);
```

---

## 環境変数のコピー

### 1. Supabase の接続情報を取得

1. 左メニュー → **Project Settings** (歯車アイコン)
2. **API** タブをクリック
3. 以下の情報をコピー：
   - **Project URL**: `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public**: `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role**: `SUPABASE_SERVICE_ROLE_KEY` (⚠️ 絶対に公開しない)

### 2. .env.local に追加

```.env
# Supabase (開発環境用)
NEXT_PUBLIC_SUPABASE_URL="https://xxxxxxxxxxxx.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### 3. Vercel 環境変数に追加

> **📌 重要**: Staging と Production は **別々の Supabase プロジェクト** を使用します
> - **Staging**: 既存の Supabase プロジェクトを継続使用
> - **Production**: 新規の Supabase プロジェクトを作成（Pro プラン推奨）

1. Vercel Dashboard → **Settings** → **Environment Variables**
2. **Preview** 環境（staging ブランチ用）：
   ```
   NEXT_PUBLIC_APP_ENV=staging
   NEXT_PUBLIC_SUPABASE_URL=<既存プロジェクトの URL>  # Staging 用 Supabase プロジェクト
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<既存プロジェクトの anon key>
   SUPABASE_SERVICE_ROLE_KEY=<既存プロジェクトの service role key>
   ```

3. **Production** 環境（main ブランチ用）：
   ```
   NEXT_PUBLIC_APP_ENV=production
   NEXT_PUBLIC_SUPABASE_URL=<新規プロジェクトの URL>  # Production 用 Supabase プロジェクト（新規作成）
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<新規プロジェクトの anon key>
   SUPABASE_SERVICE_ROLE_KEY=<新規プロジェクトの service role key>
   ```

---

## 動作確認

### 1. ローカルでログインテスト

```bash
# サーバー起動
pnpm dev

# ブラウザで http://localhost:3000/admin にアクセス
```

### 2. ログイン

- **メール**: `wakuwakusystemsharing@gmail.com`
- **パスワード**: `wakuwakuadmin`

### 3. ログイン成功後の確認

- ダッシュボードが表示される
- 「店舗管理」「予約データ」などのメニューが表示される

---

## トラブルシューティング

### ❌ ログインできない

- **Authentication** → **Users** でアカウントが存在するか確認
- **Email Confirmed** カラムが `null` でないことを確認
- パスワードが正しいか確認（`wakuwakuadmin`）

### ❌ テーブルが作成されない

- SQL Editor でエラーメッセージを確認
- **Table Editor** でテーブルが表示されるか確認

### ❌ データが取得できない

- **Table Editor** → **RLS が有効** になっているか確認
- **SQL Editor** で以下を実行してポリシーを確認：
  ```sql
  SELECT schemaname, tablename, policyname 
  FROM pg_policies 
  WHERE tablename IN ('stores', 'forms', 'reservations', 'store_admins');
  ```

---

## まとめ

これで Supabase の初期設定が完了しました！

次のステップ：
1. ✅ テーブル作成完了
2. ✅ 管理者アカウント作成完了
3. ✅ RLS 設定完了
4. ✅ 環境変数設定完了
5. 🚀 **次**: 店舗データ・フォームデータの Supabase 移行

不明点があれば、[SETUP.md](./SETUP.md) や [WORKFLOW.md](./WORKFLOW.md) も参照してください。