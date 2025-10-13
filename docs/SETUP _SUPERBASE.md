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

1. https://supabase.com/dashboard にアクセス
2. **New Project** をクリック
3. 以下を設定：
   - **Name**: `form-management-staging` (開発用) / `form-management-prod` (本番用)
   - **Database Password**: 強力なパスワードを生成
   - **Region**: `Northeast Asia (Tokyo)` を選択
   - **Pricing Plan**: `Free` (開発時)

### 2. Email Provider の有効化

1. 左メニュー → **Authentication** → **Providers**
2. **Email** を見つけて **Enable** をオン
3. **Confirm email** をオフにする（開発時のみ、本番はオン推奨）
4. **Save** をクリック

---

## データベーステーブル作成

### SQL Editor でテーブル作成

1. 左メニュー → **SQL Editor**
2. **New Query** をクリック
3. 以下の SQL をコピー＆ペーストして実行（▶ ボタン）：

```sql
-- 1. stores テーブル（店舗情報）
CREATE TABLE IF NOT EXISTS stores (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_name TEXT NOT NULL,
    owner_email TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    description TEXT,
    website_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 2. store_admins テーブル（店舗管理者）
CREATE TABLE IF NOT EXISTS store_admins (
    id TEXT PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    UNIQUE(user_id, store_id)
);

-- 3. forms テーブル（予約フォーム）
CREATE TABLE IF NOT EXISTS forms (
    id TEXT PRIMARY KEY,
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 4. reservations テーブル（予約データ）
CREATE TABLE IF NOT EXISTS reservations (
    id TEXT PRIMARY KEY,
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE,
    form_id TEXT REFERENCES forms(id) ON DELETE CASCADE,
    customer_name TEXT NOT NULL,
    customer_email TEXT,
    customer_phone TEXT,
    reservation_date DATE NOT NULL,
    reservation_time TIME NOT NULL,
    menu_items JSONB NOT NULL DEFAULT '[]'::jsonb,
    options JSONB NOT NULL DEFAULT '[]'::jsonb,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 5. updated_at 自動更新トリガー
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = TIMEZONE('utc'::text, NOW());
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_stores_updated_at BEFORE UPDATE ON stores
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_forms_updated_at BEFORE UPDATE ON forms
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_reservations_updated_at BEFORE UPDATE ON reservations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

4. **▶ Run** をクリックして実行
5. 成功メッセージ「Success. No rows returned」が表示されることを確認

### テーブル確認

1. 左メニュー → **Table Editor**
2. 以下のテーブルが表示されていることを確認：
   - `stores`
   - `store_admins`
   - `forms`
   - `reservations`

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

1. Vercel Dashboard → **Settings** → **Environment Variables**
2. **Preview** 環境（staging ブランチ用）：
   ```
   NEXT_PUBLIC_APP_ENV=staging
   NEXT_PUBLIC_SUPABASE_URL=<staging の URL>
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<staging の anon key>
   SUPABASE_SERVICE_ROLE_KEY=<staging の service role key>
   ```

3. **Production** 環境（main ブランチ用）：
   ```
   NEXT_PUBLIC_APP_ENV=production
   NEXT_PUBLIC_SUPABASE_URL=<production の URL>
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<production の anon key>
   SUPABASE_SERVICE_ROLE_KEY=<production の service role key>
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