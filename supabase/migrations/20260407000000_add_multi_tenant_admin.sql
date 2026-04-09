-- ==========================================
-- マルチテナント管理者階層の追加
-- マスター管理者 > システム管理者 > 店舗管理者
-- ==========================================

-- ==========================================
-- 1. 新テーブル作成
-- ==========================================

-- マスター管理者テーブル
CREATE TABLE IF NOT EXISTS master_admins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE master_admins ENABLE ROW LEVEL SECURITY;

-- システム管理者テーブル
CREATE TABLE IF NOT EXISTS system_admins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_system_admins_user_id ON system_admins(user_id);
ALTER TABLE system_admins ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- 2. ヘルパー関数
-- ==========================================

-- マスター管理者チェック
CREATE OR REPLACE FUNCTION public.is_master_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM master_admins WHERE user_id = (SELECT auth.uid())
  );
$$;

-- システム管理者チェック
CREATE OR REPLACE FUNCTION public.is_system_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM system_admins WHERE user_id = (SELECT auth.uid())
  );
$$;

-- システム管理者が所有する店舗IDを返す
CREATE OR REPLACE FUNCTION public.system_admin_store_ids()
RETURNS SETOF TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT id FROM stores WHERE created_by = (SELECT auth.uid());
$$;

-- ==========================================
-- 3. 旧ハードコードメールベースポリシーを削除
-- ==========================================

DROP POLICY IF EXISTS admin_stores_all ON stores;
DROP POLICY IF EXISTS admin_forms_all ON reservation_forms;
DROP POLICY IF EXISTS admin_reservations_all ON reservations;
DROP POLICY IF EXISTS admin_store_admins_all ON store_admins;
DROP POLICY IF EXISTS admin_survey_forms_all ON survey_forms;
DROP POLICY IF EXISTS admin_admin_settings_all ON admin_settings;

-- ==========================================
-- 4. マスター管理者ポリシー（全テーブルフルアクセス）
-- ==========================================

CREATE POLICY master_admin_stores ON stores FOR ALL TO public
  USING (is_master_admin())
  WITH CHECK (is_master_admin());

CREATE POLICY master_admin_reservation_forms ON reservation_forms FOR ALL TO public
  USING (is_master_admin())
  WITH CHECK (is_master_admin());

CREATE POLICY master_admin_reservations ON reservations FOR ALL TO public
  USING (is_master_admin())
  WITH CHECK (is_master_admin());

CREATE POLICY master_admin_store_admins ON store_admins FOR ALL TO public
  USING (is_master_admin())
  WITH CHECK (is_master_admin());

CREATE POLICY master_admin_survey_forms ON survey_forms FOR ALL TO public
  USING (is_master_admin())
  WITH CHECK (is_master_admin());

CREATE POLICY master_admin_surveys ON surveys FOR ALL TO public
  USING (is_master_admin())
  WITH CHECK (is_master_admin());

CREATE POLICY master_admin_customers ON customers FOR ALL TO public
  USING (is_master_admin())
  WITH CHECK (is_master_admin());

CREATE POLICY master_admin_customer_visits ON customer_visits FOR ALL TO public
  USING (is_master_admin())
  WITH CHECK (is_master_admin());

CREATE POLICY master_admin_customer_interactions ON customer_interactions FOR ALL TO public
  USING (is_master_admin())
  WITH CHECK (is_master_admin());

CREATE POLICY master_admin_admin_settings ON admin_settings FOR ALL TO public
  USING (is_master_admin())
  WITH CHECK (is_master_admin());

-- ==========================================
-- 5. システム管理者ポリシー（自分が作成した店舗のみ）
-- ==========================================

-- stores: 自分が作成した店舗のみ
CREATE POLICY system_admin_stores ON stores FOR ALL TO public
  USING (is_system_admin() AND created_by = (SELECT auth.uid()))
  WITH CHECK (is_system_admin() AND created_by = (SELECT auth.uid()));

-- reservation_forms: 自分の店舗のフォームのみ
CREATE POLICY system_admin_reservation_forms ON reservation_forms FOR ALL TO public
  USING (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()))
  WITH CHECK (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()));

-- reservations: 自分の店舗の予約のみ
CREATE POLICY system_admin_reservations ON reservations FOR ALL TO public
  USING (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()))
  WITH CHECK (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()));

-- store_admins: 自分の店舗の管理者のみ
CREATE POLICY system_admin_store_admins ON store_admins FOR ALL TO public
  USING (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()))
  WITH CHECK (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()));

-- survey_forms: 自分の店舗のアンケートのみ
CREATE POLICY system_admin_survey_forms ON survey_forms FOR ALL TO public
  USING (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()))
  WITH CHECK (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()));

-- surveys: 自分の店舗の回答のみ
CREATE POLICY system_admin_surveys ON surveys FOR ALL TO public
  USING (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()))
  WITH CHECK (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()));

-- customers: 自分の店舗の顧客のみ
CREATE POLICY system_admin_customers ON customers FOR ALL TO public
  USING (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()))
  WITH CHECK (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()));

-- customer_visits: 自分の店舗の来店履歴のみ
CREATE POLICY system_admin_customer_visits ON customer_visits FOR ALL TO public
  USING (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()))
  WITH CHECK (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()));

-- customer_interactions: 自分の店舗の顧客インタラクションのみ
CREATE POLICY system_admin_customer_interactions ON customer_interactions FOR ALL TO public
  USING (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()))
  WITH CHECK (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()));

-- admin_settings: システム管理者は読み取りのみ
CREATE POLICY system_admin_settings_read ON admin_settings FOR SELECT TO public
  USING (is_system_admin());

-- ==========================================
-- 6. master_admins / system_admins テーブルのRLS
-- ==========================================

-- master_admins: マスター管理者のみ全操作可能
CREATE POLICY master_admin_master_admins ON master_admins FOR ALL TO public
  USING (is_master_admin())
  WITH CHECK (is_master_admin());

-- system_admins: マスター管理者は全操作、システム管理者は自分のレコードのみ読み取り
CREATE POLICY master_admin_system_admins ON system_admins FOR ALL TO public
  USING (is_master_admin())
  WITH CHECK (is_master_admin());

CREATE POLICY system_admin_self_read ON system_admins FOR SELECT TO public
  USING (user_id = (SELECT auth.uid()));

-- ==========================================
-- 7. データ移行（既存管理者をmaster_adminsに登録）
-- ==========================================
-- 注意: この部分はstaging/production環境で手動実行が必要
-- auth.usersテーブルからuser_idを取得して挿入する
--
-- 実行例（Supabase SQL Editorで）:
-- INSERT INTO master_admins (user_id, email, name)
-- SELECT id, email, 'Master Admin'
-- FROM auth.users
-- WHERE email IN (
--   'wakuwakusystemsharing@gmail.com',
--   'admin@wakuwakusystemsharing.com',
--   'manager@wakuwakusystemsharing.com'
-- )
-- ON CONFLICT (user_id) DO NOTHING;
--
-- UPDATE stores SET created_by = (
--   SELECT id FROM auth.users WHERE email = 'wakuwakusystemsharing@gmail.com' LIMIT 1
-- ) WHERE created_by IS NULL;
