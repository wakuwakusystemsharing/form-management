-- RLS ポリシー整理: 旧ポリシー削除 + init plan 最適化
-- 重複ポリシー（旧 ALL + 新操作別）を統一し、auth.uid() を (SELECT auth.uid()) パターンに変更

-- ===== reservation_forms: 旧ポリシー削除 =====
DROP POLICY IF EXISTS admin_forms_all ON reservation_forms;
DROP POLICY IF EXISTS store_admin_forms ON reservation_forms;

-- ===== reservations: 旧 ALL ポリシー削除 =====
DROP POLICY IF EXISTS store_admin_reservations ON reservations;

-- ===== store_admins: 旧 ALL ポリシー削除 =====
DROP POLICY IF EXISTS store_admin_store_admins ON store_admins;

-- ===== init plan 最適化: admin_* ポリシーを (select auth.jwt()) 形式に再作成 =====

-- stores
DROP POLICY IF EXISTS admin_stores_all ON stores;
CREATE POLICY admin_stores_all ON stores FOR ALL TO public
  USING ((SELECT auth.jwt() ->> 'email') = ANY (ARRAY[
    'wakuwakusystemsharing@gmail.com',
    'admin@wakuwakusystemsharing.com',
    'manager@wakuwakusystemsharing.com'
  ]::text[]))
  WITH CHECK ((SELECT auth.jwt() ->> 'email') = ANY (ARRAY[
    'wakuwakusystemsharing@gmail.com',
    'admin@wakuwakusystemsharing.com',
    'manager@wakuwakusystemsharing.com'
  ]::text[]));

DROP POLICY IF EXISTS store_admin_stores ON stores;
CREATE POLICY store_admin_stores ON stores FOR ALL TO public
  USING (EXISTS (
    SELECT 1 FROM store_admins
    WHERE store_admins.store_id = stores.id
      AND store_admins.user_id = (SELECT auth.uid())
  ));

-- reservation_forms (admin)
DROP POLICY IF EXISTS admin_forms_all ON reservation_forms;
CREATE POLICY admin_forms_all ON reservation_forms FOR ALL TO public
  USING ((SELECT auth.jwt() ->> 'email') = ANY (ARRAY[
    'wakuwakusystemsharing@gmail.com',
    'admin@wakuwakusystemsharing.com',
    'manager@wakuwakusystemsharing.com'
  ]::text[]))
  WITH CHECK ((SELECT auth.jwt() ->> 'email') = ANY (ARRAY[
    'wakuwakusystemsharing@gmail.com',
    'admin@wakuwakusystemsharing.com',
    'manager@wakuwakusystemsharing.com'
  ]::text[]));

-- reservations (admin)
DROP POLICY IF EXISTS admin_reservations_all ON reservations;
CREATE POLICY admin_reservations_all ON reservations FOR ALL TO public
  USING ((SELECT auth.jwt() ->> 'email') = ANY (ARRAY[
    'wakuwakusystemsharing@gmail.com',
    'admin@wakuwakusystemsharing.com',
    'manager@wakuwakusystemsharing.com'
  ]::text[]))
  WITH CHECK ((SELECT auth.jwt() ->> 'email') = ANY (ARRAY[
    'wakuwakusystemsharing@gmail.com',
    'admin@wakuwakusystemsharing.com',
    'manager@wakuwakusystemsharing.com'
  ]::text[]));

-- store_admins (admin)
DROP POLICY IF EXISTS admin_store_admins_all ON store_admins;
CREATE POLICY admin_store_admins_all ON store_admins FOR ALL TO public
  USING ((SELECT auth.jwt() ->> 'email') = ANY (ARRAY[
    'wakuwakusystemsharing@gmail.com',
    'admin@wakuwakusystemsharing.com',
    'manager@wakuwakusystemsharing.com'
  ]::text[]))
  WITH CHECK ((SELECT auth.jwt() ->> 'email') = ANY (ARRAY[
    'wakuwakusystemsharing@gmail.com',
    'admin@wakuwakusystemsharing.com',
    'manager@wakuwakusystemsharing.com'
  ]::text[]));

-- survey_forms (admin)
DROP POLICY IF EXISTS admin_survey_forms_all ON survey_forms;
CREATE POLICY admin_survey_forms_all ON survey_forms FOR ALL TO public
  USING ((SELECT auth.jwt() ->> 'email') = ANY (ARRAY[
    'wakuwakusystemsharing@gmail.com',
    'admin@wakuwakusystemsharing.com',
    'manager@wakuwakusystemsharing.com'
  ]::text[]))
  WITH CHECK ((SELECT auth.jwt() ->> 'email') = ANY (ARRAY[
    'wakuwakusystemsharing@gmail.com',
    'admin@wakuwakusystemsharing.com',
    'manager@wakuwakusystemsharing.com'
  ]::text[]));

-- admin_settings (admin)
DROP POLICY IF EXISTS admin_admin_settings_all ON admin_settings;
CREATE POLICY admin_admin_settings_all ON admin_settings FOR ALL TO public
  USING ((SELECT auth.jwt() ->> 'email') = ANY (ARRAY[
    'wakuwakusystemsharing@gmail.com',
    'admin@wakuwakusystemsharing.com',
    'manager@wakuwakusystemsharing.com'
  ]::text[]))
  WITH CHECK ((SELECT auth.jwt() ->> 'email') = ANY (ARRAY[
    'wakuwakusystemsharing@gmail.com',
    'admin@wakuwakusystemsharing.com',
    'manager@wakuwakusystemsharing.com'
  ]::text[]));
