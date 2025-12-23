-- ==========================================
-- Change all store_id columns from UUID to TEXT
-- 2025-01-30: すべてのstore_idカラムをUUID型からTEXT型に変更
-- ==========================================

-- 1. すべてのRLSポリシーを削除（CASCADEで依存関係も削除）
-- stores テーブル
DROP POLICY IF EXISTS "admin_stores_all" ON stores CASCADE;
DROP POLICY IF EXISTS "store_admin_stores" ON stores CASCADE;
DROP POLICY IF EXISTS "サービス管理者は全店舗アクセス可能" ON stores CASCADE;
DROP POLICY IF EXISTS "店舗管理者は自店舗のみアクセス可能" ON stores CASCADE;

-- forms テーブル
DROP POLICY IF EXISTS "store_admin_forms" ON forms CASCADE;
DROP POLICY IF EXISTS "admin_forms_all" ON forms CASCADE;
DROP POLICY IF EXISTS "サービス管理者は全フォームアクセス可能" ON forms CASCADE;
DROP POLICY IF EXISTS "店舗管理者は自店舗のフォームのみアクセス可" ON forms CASCADE;

-- reservations テーブル
DROP POLICY IF EXISTS "store_admin_reservations" ON reservations CASCADE;
DROP POLICY IF EXISTS "admin_reservations_all" ON reservations CASCADE;
DROP POLICY IF EXISTS "サービス管理者は全予約アクセス可能" ON reservations CASCADE;
DROP POLICY IF EXISTS "店舗管理者は自店舗の予約のみアクセス可能" ON reservations CASCADE;

-- store_admins テーブル
DROP POLICY IF EXISTS "store_admin_store_admins" ON store_admins CASCADE;
DROP POLICY IF EXISTS "admin_store_admins_all" ON store_admins CASCADE;
DROP POLICY IF EXISTS "サービス管理者は全管理者アクセス可能" ON store_admins CASCADE;

-- survey_forms テーブル
DROP POLICY IF EXISTS "store_admin_survey_forms" ON survey_forms CASCADE;
DROP POLICY IF EXISTS "admin_survey_forms_all" ON survey_forms CASCADE;
DROP POLICY IF EXISTS "サービス管理者は全アンケートフォームアクセス可能" ON survey_forms CASCADE;
DROP POLICY IF EXISTS "店舗管理者は自店舗アンケートフォームのみアクセス可能" ON survey_forms CASCADE;
DROP POLICY IF EXISTS "Enable read access for store admins" ON survey_forms CASCADE;
DROP POLICY IF EXISTS "Enable insert access for store admins" ON survey_forms CASCADE;
DROP POLICY IF EXISTS "Enable update access for store admins" ON survey_forms CASCADE;
DROP POLICY IF EXISTS "Enable delete access for store admins" ON survey_forms CASCADE;

-- 2. 外部キー制約を削除
ALTER TABLE forms DROP CONSTRAINT IF EXISTS forms_store_id_fkey;
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_store_id_fkey;
ALTER TABLE store_admins DROP CONSTRAINT IF EXISTS store_admins_store_id_fkey;
ALTER TABLE survey_forms DROP CONSTRAINT IF EXISTS survey_forms_store_id_fkey;

-- 3. stores.id を TEXT に変更
ALTER TABLE stores ALTER COLUMN id TYPE TEXT USING id::TEXT;

-- 4. 関連テーブルの store_id を TEXT に変更
ALTER TABLE forms ALTER COLUMN store_id TYPE TEXT USING store_id::TEXT;
ALTER TABLE reservations ALTER COLUMN store_id TYPE TEXT USING store_id::TEXT;
ALTER TABLE store_admins ALTER COLUMN store_id TYPE TEXT USING store_id::TEXT;
ALTER TABLE survey_forms ALTER COLUMN store_id TYPE TEXT USING store_id::TEXT;

-- 5. 外部キー制約を再作成
ALTER TABLE forms 
  ADD CONSTRAINT forms_store_id_fkey 
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE;

ALTER TABLE reservations 
  ADD CONSTRAINT reservations_store_id_fkey 
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE;

ALTER TABLE store_admins 
  ADD CONSTRAINT store_admins_store_id_fkey 
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE;

ALTER TABLE survey_forms 
  ADD CONSTRAINT survey_forms_store_id_fkey 
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE;

-- 6. RLSポリシーを再作成
-- stores テーブル
CREATE POLICY "admin_stores_all" ON stores
  FOR ALL
  USING (
    (auth.jwt() ->> 'email') = ANY (ARRAY[
      'wakuwakusystemsharing@gmail.com',
      'admin@wakuwakusystemsharing.com',
      'manager@wakuwakusystemsharing.com'
    ])
  );

CREATE POLICY "store_admin_stores" ON stores
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM store_admins
      WHERE store_admins.store_id = stores.id
      AND store_admins.user_id = auth.uid()
    )
  );

-- forms テーブル
CREATE POLICY "admin_forms_all" ON forms
  FOR ALL
  USING (
    (auth.jwt() ->> 'email') = ANY (ARRAY[
      'wakuwakusystemsharing@gmail.com',
      'admin@wakuwakusystemsharing.com',
      'manager@wakuwakusystemsharing.com'
    ])
  );

CREATE POLICY "store_admin_forms" ON forms
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM store_admins
      WHERE store_admins.store_id = forms.store_id
      AND store_admins.user_id = auth.uid()
    )
  );

-- reservations テーブル
CREATE POLICY "admin_reservations_all" ON reservations
  FOR ALL
  USING (
    (auth.jwt() ->> 'email') = ANY (ARRAY[
      'wakuwakusystemsharing@gmail.com',
      'admin@wakuwakusystemsharing.com',
      'manager@wakuwakusystemsharing.com'
    ])
  );

CREATE POLICY "store_admin_reservations" ON reservations
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM store_admins
      WHERE store_admins.store_id = reservations.store_id
      AND store_admins.user_id = auth.uid()
    )
  );

-- store_admins テーブル
CREATE POLICY "admin_store_admins_all" ON store_admins
  FOR ALL
  USING (
    (auth.jwt() ->> 'email') = ANY (ARRAY[
      'wakuwakusystemsharing@gmail.com',
      'admin@wakuwakusystemsharing.com',
      'manager@wakuwakusystemsharing.com'
    ])
  );

CREATE POLICY "store_admin_store_admins" ON store_admins
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM store_admins sa
      WHERE sa.store_id = store_admins.store_id
      AND sa.user_id = auth.uid()
    )
  );

-- survey_forms テーブル
CREATE POLICY "admin_survey_forms_all" ON survey_forms
  FOR ALL
  USING (
    (auth.jwt() ->> 'email') = ANY (ARRAY[
      'wakuwakusystemsharing@gmail.com',
      'admin@wakuwakusystemsharing.com',
      'manager@wakuwakusystemsharing.com'
    ])
  );

CREATE POLICY "store_admin_survey_forms" ON survey_forms
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM store_admins
      WHERE store_admins.store_id = survey_forms.store_id
      AND store_admins.user_id = auth.uid()
    )
  );

-- コメントを追加
COMMENT ON COLUMN stores.id IS '店舗ID: 6文字のランダム文字列（新規）またはUUID形式（既存データ）';

