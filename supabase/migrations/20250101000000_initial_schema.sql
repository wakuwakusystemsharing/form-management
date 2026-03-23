-- ==========================================
-- Initial Schema for Form Management System
-- Consolidated from all legacy migrations
-- ==========================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- Shared function: update_updated_at_column
-- ==========================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ==========================================
-- 1. stores テーブル (店舗)
-- ==========================================
CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  description TEXT,
  website_url TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  google_calendar_id TEXT,
  google_calendar_source TEXT NOT NULL DEFAULT 'system' CHECK (google_calendar_source IN ('system', 'store_oauth')),
  google_calendar_refresh_token TEXT,
  line_channel_access_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stores_created_at ON stores(created_at DESC);

CREATE TRIGGER update_stores_updated_at BEFORE UPDATE ON stores
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE stores IS '店舗マスタ';
COMMENT ON COLUMN stores.id IS '店舗ID: 6文字のランダム文字列（アプリケーション側で必ず指定）';
COMMENT ON COLUMN stores.created_by IS '作成者のユーザーID';
COMMENT ON COLUMN stores.updated_by IS '更新者のユーザーID';
COMMENT ON COLUMN stores.google_calendar_source IS 'system: SA-created calendar; store_oauth: store-linked Google account';
COMMENT ON COLUMN stores.google_calendar_refresh_token IS 'Encrypted OAuth refresh token when google_calendar_source = store_oauth';

-- ==========================================
-- 2. reservation_forms テーブル (予約フォーム)
-- ==========================================
CREATE TABLE IF NOT EXISTS reservation_forms (
  id TEXT PRIMARY KEY DEFAULT REPLACE(uuid_generate_v4()::TEXT, '-', '')::TEXT,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ('active', 'inactive')),
  draft_status TEXT NOT NULL DEFAULT 'none' CHECK (draft_status IN ('none', 'draft', 'ready_to_publish')),
  config JSONB NOT NULL DEFAULT '{}'::JSONB,
  draft_config JSONB,
  static_deploy JSONB,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_reservation_forms_store_id ON reservation_forms(store_id);
CREATE INDEX IF NOT EXISTS idx_reservation_forms_status ON reservation_forms(status);
CREATE INDEX IF NOT EXISTS idx_reservation_forms_created_at ON reservation_forms(created_at DESC);

CREATE TRIGGER update_reservation_forms_updated_at BEFORE UPDATE ON reservation_forms
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE reservation_forms IS '予約フォーム設定 (店舗ごと)';
COMMENT ON COLUMN reservation_forms.created_by IS '作成者のユーザーID';
COMMENT ON COLUMN reservation_forms.updated_by IS '更新者のユーザーID';

-- ==========================================
-- 3. survey_forms テーブル (アンケートフォーム)
-- ==========================================
CREATE TABLE IF NOT EXISTS survey_forms (
  id TEXT PRIMARY KEY DEFAULT REPLACE(uuid_generate_v4()::TEXT, '-', '')::TEXT,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('active', 'inactive', 'paused', 'draft')),
  draft_status TEXT NOT NULL DEFAULT 'none' CHECK (draft_status IN ('none', 'draft', 'ready_to_publish')),
  config JSONB NOT NULL DEFAULT '{}'::JSONB,
  draft_config JSONB,
  static_deploy JSONB,
  public_url TEXT,
  storage_url TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_survey_forms_store_id ON survey_forms(store_id);
CREATE INDEX IF NOT EXISTS idx_survey_forms_status ON survey_forms(status);
CREATE INDEX IF NOT EXISTS idx_survey_forms_created_at ON survey_forms(created_at DESC);

CREATE TRIGGER update_survey_forms_updated_at BEFORE UPDATE ON survey_forms
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE survey_forms IS 'アンケートフォーム設定 (店舗ごと)';
COMMENT ON COLUMN survey_forms.created_by IS '作成者のユーザーID';
COMMENT ON COLUMN survey_forms.updated_by IS '更新者のユーザーID';

-- ==========================================
-- 4. reservations テーブル (予約)
-- ==========================================
CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY DEFAULT REPLACE(uuid_generate_v4()::TEXT, '-', '')::TEXT,
  form_id TEXT NOT NULL REFERENCES reservation_forms(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT,
  reservation_date DATE NOT NULL,
  reservation_time TIME NOT NULL,
  menu_name TEXT NOT NULL,
  submenu_name TEXT,
  gender TEXT,
  visit_count TEXT,
  coupon TEXT,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed')),
  selected_menus JSONB DEFAULT '[]'::JSONB,
  selected_options JSONB DEFAULT '[]'::JSONB,
  customer_info JSONB DEFAULT '{}'::JSONB,
  line_user_id TEXT,
  customer_id TEXT,
  google_calendar_event_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reservations_store_id ON reservations(store_id);
CREATE INDEX IF NOT EXISTS idx_reservations_form_id ON reservations(form_id);
CREATE INDEX IF NOT EXISTS idx_reservations_date ON reservations(reservation_date DESC);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);
CREATE INDEX IF NOT EXISTS idx_reservations_created_at ON reservations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reservations_selected_menus_gin ON reservations USING GIN (selected_menus);
CREATE INDEX IF NOT EXISTS idx_reservations_selected_options_gin ON reservations USING GIN (selected_options);
CREATE INDEX IF NOT EXISTS idx_reservations_customer_info_gin ON reservations USING GIN (customer_info);
CREATE INDEX IF NOT EXISTS idx_reservations_line_user_id ON reservations(line_user_id) WHERE line_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reservations_customer_id ON reservations(customer_id) WHERE customer_id IS NOT NULL;

CREATE TRIGGER update_reservations_updated_at BEFORE UPDATE ON reservations
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE reservations IS '予約データ';
COMMENT ON COLUMN reservations.line_user_id IS 'LINEユーザーID（LIFFから取得）';
COMMENT ON COLUMN reservations.customer_id IS '顧客ID（CRM連携）';
COMMENT ON COLUMN reservations.google_calendar_event_id IS 'Google Calendar event ID; used to delete the event on cancel.';
COMMENT ON COLUMN reservations.selected_menus IS '選択されたメニュー情報の配列（JSONB）';
COMMENT ON COLUMN reservations.selected_options IS '選択されたオプション情報の配列（JSONB）';
COMMENT ON COLUMN reservations.customer_info IS '顧客属性情報（JSONB）';

-- ==========================================
-- 5. surveys テーブル (アンケート回答)
-- ==========================================
CREATE TABLE IF NOT EXISTS surveys (
  id TEXT PRIMARY KEY DEFAULT REPLACE(uuid_generate_v4()::TEXT, '-', '')::TEXT,
  responses JSONB NOT NULL DEFAULT '{}',
  survey_form_id TEXT NOT NULL REFERENCES survey_forms(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  line_user_id TEXT,
  customer_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_surveys_survey_form_id ON surveys(survey_form_id);
CREATE INDEX IF NOT EXISTS idx_surveys_store_id ON surveys(store_id);
CREATE INDEX IF NOT EXISTS idx_surveys_submitted_at ON surveys(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_surveys_line_user_id ON surveys(line_user_id) WHERE line_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_surveys_customer_id ON surveys(customer_id) WHERE customer_id IS NOT NULL;

COMMENT ON TABLE surveys IS 'アンケート回答データ';
COMMENT ON COLUMN surveys.responses IS '回答データ（JSONB形式）';
COMMENT ON COLUMN surveys.line_user_id IS 'LINEユーザーID（LIFFから取得）';
COMMENT ON COLUMN surveys.customer_id IS '顧客ID（CRM連携）';

-- ==========================================
-- 6. store_admins テーブル (店舗管理者)
-- ==========================================
CREATE TABLE IF NOT EXISTS store_admins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, store_id)
);

CREATE INDEX IF NOT EXISTS idx_store_admins_user_id ON store_admins(user_id);
CREATE INDEX IF NOT EXISTS idx_store_admins_store_id ON store_admins(store_id);

COMMENT ON TABLE store_admins IS '店舗管理者マッピング';

-- ==========================================
-- 7. customers テーブル (顧客マスタ / CRM)
-- ==========================================
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY DEFAULT REPLACE(uuid_generate_v4()::TEXT, '-', ''),
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  line_user_id TEXT,
  name TEXT NOT NULL,
  name_kana TEXT,
  phone TEXT,
  email TEXT,
  birthday DATE,
  gender TEXT CHECK (gender IN ('male', 'female', 'other', 'unknown')),
  line_display_name TEXT,
  line_picture_url TEXT,
  line_status_message TEXT,
  line_email TEXT,
  line_friend_flag BOOLEAN DEFAULT false,
  line_friend_added_at TIMESTAMPTZ,
  line_language TEXT,
  line_os TEXT CHECK (line_os IN ('ios', 'android', 'web')),
  customer_type TEXT DEFAULT 'regular' CHECK (customer_type IN ('new', 'regular', 'vip', 'inactive')),
  preferred_contact_method TEXT,
  allergies TEXT,
  medical_history TEXT,
  notes TEXT,
  tags TEXT[],
  total_visits INTEGER DEFAULT 0,
  total_spent NUMERIC(10, 2) DEFAULT 0,
  first_visit_date DATE,
  last_visit_date DATE,
  average_visit_interval_days INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_store_id ON customers(store_id);
CREATE INDEX IF NOT EXISTS idx_customers_line_user_id ON customers(line_user_id) WHERE line_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_customer_type ON customers(customer_type);
CREATE INDEX IF NOT EXISTS idx_customers_last_visit_date ON customers(last_visit_date DESC);
CREATE INDEX IF NOT EXISTS idx_customers_created_at ON customers(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS unique_customers_store_line_user ON customers(store_id, line_user_id) WHERE line_user_id IS NOT NULL;

CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE customers IS '顧客マスタ（CRM）';
COMMENT ON COLUMN customers.line_user_id IS 'LINEユーザーID（重複不可）';
COMMENT ON COLUMN customers.customer_type IS '顧客タイプ: new, regular, vip, inactive';
COMMENT ON COLUMN customers.total_visits IS '来店回数（自動更新）';
COMMENT ON COLUMN customers.total_spent IS '総利用金額（自動更新）';

-- ==========================================
-- 8. customer_visits テーブル (来店履歴)
-- ==========================================
CREATE TABLE IF NOT EXISTS customer_visits (
  id TEXT PRIMARY KEY DEFAULT REPLACE(uuid_generate_v4()::TEXT, '-', ''),
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  reservation_id TEXT REFERENCES reservations(id) ON DELETE SET NULL,
  visit_date DATE NOT NULL,
  visit_time TIME,
  visit_type TEXT DEFAULT 'reservation' CHECK (visit_type IN ('reservation', 'walk_in', 'follow_up')),
  treatment_menus JSONB,
  treatment_notes TEXT,
  therapist_name TEXT,
  satisfaction_score INTEGER CHECK (satisfaction_score BETWEEN 1 AND 5),
  amount NUMERIC(10, 2),
  payment_method TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_visits_customer_id ON customer_visits(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_visits_store_id ON customer_visits(store_id);
CREATE INDEX IF NOT EXISTS idx_customer_visits_reservation_id ON customer_visits(reservation_id) WHERE reservation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customer_visits_visit_date ON customer_visits(visit_date DESC);
CREATE INDEX IF NOT EXISTS idx_customer_visits_created_at ON customer_visits(created_at DESC);

CREATE TRIGGER update_customer_visits_updated_at BEFORE UPDATE ON customer_visits
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE customer_visits IS '来店履歴';
COMMENT ON COLUMN customer_visits.visit_type IS '来店種別: reservation, walk_in, follow_up';

-- ==========================================
-- 9. customer_interactions テーブル (顧客やり取り履歴)
-- ==========================================
CREATE TABLE IF NOT EXISTS customer_interactions (
  id TEXT PRIMARY KEY DEFAULT REPLACE(uuid_generate_v4()::TEXT, '-', ''),
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  interaction_type TEXT NOT NULL CHECK (interaction_type IN ('call', 'email', 'line_message', 'sms', 'note', 'reminder')),
  direction TEXT CHECK (direction IN ('inbound', 'outbound')),
  subject TEXT,
  content TEXT,
  line_message_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_interactions_customer_id ON customer_interactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_interactions_store_id ON customer_interactions(store_id);
CREATE INDEX IF NOT EXISTS idx_customer_interactions_created_at ON customer_interactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_interactions_type ON customer_interactions(interaction_type);

COMMENT ON TABLE customer_interactions IS '顧客とのやり取り履歴';
COMMENT ON COLUMN customer_interactions.interaction_type IS 'やり取り種別: call, email, line_message, sms, note, reminder';
COMMENT ON COLUMN customer_interactions.direction IS '方向: inbound（受信）, outbound（送信）';

-- ==========================================
-- 10. admin_settings テーブル (サービス全体設定)
-- ==========================================
CREATE TABLE IF NOT EXISTS admin_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key TEXT NOT NULL UNIQUE,
  value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE admin_settings ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- 11. Foreign keys (deferred to avoid circular deps)
-- ==========================================
-- reservations.customer_id → customers
ALTER TABLE reservations
  ADD CONSTRAINT reservations_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;

-- surveys.customer_id → customers
ALTER TABLE surveys
  ADD CONSTRAINT surveys_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;

-- ==========================================
-- 12. Row Level Security (RLS)
-- ==========================================

-- Enable RLS on all tables
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservation_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE surveys ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_interactions ENABLE ROW LEVEL SECURITY;

-- ===== Admin bypass policies (email whitelist) =====
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

-- ===== Store admin policies =====

-- stores: store admins can access their own stores
CREATE POLICY store_admin_stores ON stores FOR ALL TO public
  USING (EXISTS (
    SELECT 1 FROM store_admins
    WHERE store_admins.store_id = stores.id
      AND store_admins.user_id = (SELECT auth.uid())
  ));

-- reservation_forms: store admins CRUD
CREATE POLICY store_admin_reservation_forms_select ON reservation_forms FOR SELECT
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));
CREATE POLICY store_admin_reservation_forms_insert ON reservation_forms FOR INSERT
  WITH CHECK (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));
CREATE POLICY store_admin_reservation_forms_update ON reservation_forms FOR UPDATE
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));
CREATE POLICY store_admin_reservation_forms_delete ON reservation_forms FOR DELETE
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));

-- reservations: store admins read/update, public insert
CREATE POLICY store_admin_reservations_select ON reservations FOR SELECT
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));
CREATE POLICY public_reservations_insert ON reservations FOR INSERT WITH CHECK (true);
CREATE POLICY store_admin_reservations_update ON reservations FOR UPDATE
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));

-- store_admins: users can see their own records
CREATE POLICY store_admin_store_admins_select ON store_admins FOR SELECT
  USING (user_id = (SELECT auth.uid()));

-- survey_forms: store admins CRUD
CREATE POLICY store_admin_survey_forms_select ON survey_forms FOR SELECT
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));
CREATE POLICY store_admin_survey_forms_insert ON survey_forms FOR INSERT
  WITH CHECK (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));
CREATE POLICY store_admin_survey_forms_update ON survey_forms FOR UPDATE
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));
CREATE POLICY store_admin_survey_forms_delete ON survey_forms FOR DELETE
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));

-- surveys: store admins read, public insert
CREATE POLICY store_admin_surveys_select ON surveys FOR SELECT
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));
CREATE POLICY public_surveys_insert ON surveys FOR INSERT WITH CHECK (true);

-- customers: store admins CRUD
CREATE POLICY store_admin_customers_select ON customers FOR SELECT
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));
CREATE POLICY store_admin_customers_insert ON customers FOR INSERT
  WITH CHECK (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));
CREATE POLICY store_admin_customers_update ON customers FOR UPDATE
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));
CREATE POLICY store_admin_customers_delete ON customers FOR DELETE
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));

-- customer_visits: store admins read/write/update
CREATE POLICY store_admin_customer_visits_select ON customer_visits FOR SELECT
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));
CREATE POLICY store_admin_customer_visits_insert ON customer_visits FOR INSERT
  WITH CHECK (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));
CREATE POLICY store_admin_customer_visits_update ON customer_visits FOR UPDATE
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));

-- customer_interactions: store admins read/write
CREATE POLICY store_admin_customer_interactions_select ON customer_interactions FOR SELECT
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));
CREATE POLICY store_admin_customer_interactions_insert ON customer_interactions FOR INSERT
  WITH CHECK (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));

-- ==========================================
-- 13. Storage policies
-- ==========================================
-- Store admins can upload to their own store path in the 'forms' bucket
CREATE POLICY "Store admins can upload to their own store path"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'forms'
    AND EXISTS (
      SELECT 1 FROM public.store_admins
      WHERE store_id = (storage.foldername(name))[2]
        AND user_id = (SELECT auth.uid())
    )
  );
