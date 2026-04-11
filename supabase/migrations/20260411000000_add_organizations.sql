-- ==========================================
-- テナント（組織）ベースのマルチテナント対応
-- organizations テーブル追加、system_admins/stores に org_id 追加
-- ==========================================

-- ==========================================
-- 1. organizations テーブル作成
-- ==========================================
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- 2. system_admins に org_id カラム追加
-- ==========================================
ALTER TABLE system_admins ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_system_admins_org_id ON system_admins(org_id);

-- ==========================================
-- 3. stores に org_id カラム追加
-- ==========================================
ALTER TABLE stores ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_stores_org_id ON stores(org_id);

-- ==========================================
-- 4. ヘルパー関数の更新
-- ==========================================

-- ユーザーの所属テナントIDを返す
CREATE OR REPLACE FUNCTION public.system_admin_org_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT org_id FROM system_admins WHERE user_id = (SELECT auth.uid()) LIMIT 1;
$$;

-- テナント内の店舗IDを返す（既存関数の中身を更新: created_by → org_id）
CREATE OR REPLACE FUNCTION public.system_admin_store_ids()
RETURNS SETOF TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT id FROM stores WHERE org_id = (
    SELECT org_id FROM system_admins WHERE user_id = (SELECT auth.uid()) LIMIT 1
  );
$$;

-- ==========================================
-- 5. stores テーブルのRLSポリシー更新（created_by → org_id）
-- ==========================================
DROP POLICY IF EXISTS system_admin_stores ON stores;
CREATE POLICY system_admin_stores ON stores FOR ALL TO public
  USING (is_system_admin() AND org_id = (SELECT system_admin_org_id()))
  WITH CHECK (is_system_admin() AND org_id = (SELECT system_admin_org_id()));

-- ==========================================
-- 6. organizations テーブルのRLSポリシー
-- ==========================================
CREATE POLICY master_admin_organizations ON organizations FOR ALL TO public
  USING (is_master_admin())
  WITH CHECK (is_master_admin());

CREATE POLICY system_admin_organizations_read ON organizations FOR SELECT TO public
  USING (id = (SELECT system_admin_org_id()));

-- ==========================================
-- 7. system_admins の自己参照ポリシー更新（同テナントメンバーが見える）
-- ==========================================
DROP POLICY IF EXISTS system_admin_self_read ON system_admins;
CREATE POLICY system_admin_org_read ON system_admins FOR SELECT TO public
  USING (org_id = (SELECT system_admin_org_id()));

-- ==========================================
-- 8. デフォルト組織の作成 & 既存データ移行
-- ==========================================
INSERT INTO organizations (name, slug) VALUES ('Default', 'default')
ON CONFLICT (slug) DO NOTHING;

UPDATE stores SET org_id = (SELECT id FROM organizations WHERE slug = 'default')
WHERE org_id IS NULL;

UPDATE system_admins SET org_id = (SELECT id FROM organizations WHERE slug = 'default')
WHERE org_id IS NULL;
