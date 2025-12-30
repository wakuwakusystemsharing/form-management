-- ==========================================
-- Rename RLS Policies from Japanese to English
-- ==========================================

-- Drop existing Japanese-named policies and recreate with English names

-- ==========================================
-- stores table policies
-- ==========================================
DROP POLICY IF EXISTS "店舗管理者は自店舗を閲覧可能" ON stores;
CREATE POLICY "store_admin_stores_select" ON stores
  FOR SELECT
  USING (
    id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

-- ==========================================
-- forms (reservation_forms) table policies
-- ==========================================
-- Drop Japanese policies from forms table (if it still exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'forms') THEN
    DROP POLICY IF EXISTS "店舗管理者は自店舗のフォームを閲覧可能" ON forms;
    DROP POLICY IF EXISTS "店舗管理者は自店舗のフォームを作成可能" ON forms;
    DROP POLICY IF EXISTS "店舗管理者は自店舗のフォームを更新可能" ON forms;
    DROP POLICY IF EXISTS "店舗管理者は自店舗のフォームを削除可能" ON forms;
  END IF;
END $$;

-- Drop Japanese policies from reservation_forms table (if it exists)
DROP POLICY IF EXISTS "店舗管理者は自店舗の予約フォームを閲覧可能" ON reservation_forms;
DROP POLICY IF EXISTS "店舗管理者は自店舗の予約フォームを作成可能" ON reservation_forms;
DROP POLICY IF EXISTS "店舗管理者は自店舗の予約フォームを更新可能" ON reservation_forms;
DROP POLICY IF EXISTS "店舗管理者は自店舗の予約フォームを削除可能" ON reservation_forms;

-- Create English policies for reservation_forms (if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'reservation_forms') THEN
    CREATE POLICY "store_admin_reservation_forms_select" ON reservation_forms
      FOR SELECT
      USING (
        store_id IN (
          SELECT store_id FROM store_admins WHERE user_id = auth.uid()
        )
      );

    CREATE POLICY "store_admin_reservation_forms_insert" ON reservation_forms
      FOR INSERT
      WITH CHECK (
        store_id IN (
          SELECT store_id FROM store_admins WHERE user_id = auth.uid()
        )
      );

    CREATE POLICY "store_admin_reservation_forms_update" ON reservation_forms
      FOR UPDATE
      USING (
        store_id IN (
          SELECT store_id FROM store_admins WHERE user_id = auth.uid()
        )
      );

    CREATE POLICY "store_admin_reservation_forms_delete" ON reservation_forms
      FOR DELETE
      USING (
        store_id IN (
          SELECT store_id FROM store_admins WHERE user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- ==========================================
-- reservations table policies
-- ==========================================
DROP POLICY IF EXISTS "店舗管理者は自店舗の予約を閲覧可能" ON reservations;
DROP POLICY IF EXISTS "顧客フォームから予約作成可能" ON reservations;
DROP POLICY IF EXISTS "店舗管理者は自店舗の予約を更新可能" ON reservations;

CREATE POLICY "store_admin_reservations_select" ON reservations
  FOR SELECT
  USING (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "public_reservations_insert" ON reservations
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "store_admin_reservations_update" ON reservations
  FOR UPDATE
  USING (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

-- ==========================================
-- store_admins table policies
-- ==========================================
DROP POLICY IF EXISTS "店舗管理者は自分の情報を閲覧可能" ON store_admins;
CREATE POLICY "store_admin_store_admins_select" ON store_admins
  FOR SELECT
  USING (user_id = auth.uid());

-- ==========================================
-- survey_forms table policies
-- ==========================================
DROP POLICY IF EXISTS "店舗管理者は自店舗のアンケートフォームを閲覧可能" ON survey_forms;
DROP POLICY IF EXISTS "店舗管理者は自店舗のアンケートフォームを作成可能" ON survey_forms;
DROP POLICY IF EXISTS "店舗管理者は自店舗のアンケートフォームを更新可能" ON survey_forms;
DROP POLICY IF EXISTS "店舗管理者は自店舗のアンケートフォームを削除可能" ON survey_forms;

CREATE POLICY "store_admin_survey_forms_select" ON survey_forms
  FOR SELECT
  USING (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "store_admin_survey_forms_insert" ON survey_forms
      FOR INSERT
  WITH CHECK (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "store_admin_survey_forms_update" ON survey_forms
  FOR UPDATE
  USING (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "store_admin_survey_forms_delete" ON survey_forms
  FOR DELETE
  USING (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

-- ==========================================
-- surveys table policies (if table exists)
-- ==========================================
-- Drop Japanese policies from surveys table (if it exists)
DROP POLICY IF EXISTS "店舗管理者は自店舗のアンケート回答を閲覧可能" ON surveys;
DROP POLICY IF EXISTS "顧客はアンケート回答を送信可能" ON surveys;
DROP POLICY IF EXISTS "サービス管理者は全てのアンケート回答を閲覧可能" ON surveys;

-- Create English policies for surveys (if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'surveys') THEN
    CREATE POLICY "store_admin_surveys_select" ON surveys
      FOR SELECT
      USING (
        store_id IN (
          SELECT store_id FROM store_admins WHERE user_id = auth.uid()
        )
      );

    CREATE POLICY "public_surveys_insert" ON surveys
      FOR INSERT
      WITH CHECK (true);

    -- Service admin policy (using service_role, so this is handled at application level)
    -- Note: Service admin policies are typically handled via service_role bypass
  END IF;
END $$;
