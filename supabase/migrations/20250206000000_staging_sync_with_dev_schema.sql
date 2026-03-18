-- ==========================================
-- Staging Sync with Dev Schema
-- 2025-02-06: Bring staging DB to dev schema (forms→reservation_forms, CRM, LINE, subdomain, RLS)
-- ==========================================

-- ==========================================
-- 1. Rename forms → reservation_forms
-- ==========================================
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_form_id_fkey;
ALTER TABLE forms RENAME TO reservation_forms;
ALTER TABLE reservations ADD CONSTRAINT reservations_form_id_fkey
  FOREIGN KEY (form_id) REFERENCES reservation_forms(id) ON DELETE CASCADE;

-- ==========================================
-- 2. stores: subdomain, custom_domain, created_by, updated_by
-- ==========================================
ALTER TABLE stores ADD COLUMN IF NOT EXISTS subdomain TEXT;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS custom_domain TEXT;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

UPDATE stores SET subdomain = id WHERE subdomain IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stores_subdomain_unique') THEN
    ALTER TABLE stores ADD CONSTRAINT stores_subdomain_unique UNIQUE (subdomain);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stores_custom_domain_unique') THEN
    ALTER TABLE stores ADD CONSTRAINT stores_custom_domain_unique UNIQUE (custom_domain);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_stores_subdomain ON stores(subdomain);
CREATE INDEX IF NOT EXISTS idx_stores_custom_domain ON stores(custom_domain);
COMMENT ON COLUMN stores.subdomain IS 'サブドメイン（例: st0001）。UNIQUE制約あり。';
COMMENT ON COLUMN stores.custom_domain IS 'カスタムドメイン（例: myshop.com）。UNIQUE制約あり。';
COMMENT ON COLUMN stores.created_by IS '作成者のユーザーID';
COMMENT ON COLUMN stores.updated_by IS '更新者のユーザーID';

-- ==========================================
-- 3. reservations: line_user_id (customer_id added after customers table)
-- ==========================================
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS line_user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_reservations_line_user_id ON reservations(line_user_id) WHERE line_user_id IS NOT NULL;
COMMENT ON COLUMN reservations.line_user_id IS 'LINEユーザーID（LIFFから取得）';

-- ==========================================
-- 4. customers テーブル
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
-- 5. reservations: customer_id
-- ==========================================
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_reservations_customer_id ON reservations(customer_id) WHERE customer_id IS NOT NULL;
COMMENT ON COLUMN reservations.customer_id IS '顧客ID（CRM連携）';

-- ==========================================
-- 6. customer_visits テーブル
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
COMMENT ON COLUMN customer_visits.visit_type IS '来店種別: reservation（予約）, walk_in（飛び込み）, follow_up（フォローアップ）';

-- ==========================================
-- 7. customer_interactions テーブル
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
-- 8. surveys テーブル（アンケート回答）
-- ==========================================
CREATE TABLE IF NOT EXISTS surveys (
  id TEXT PRIMARY KEY DEFAULT REPLACE(uuid_generate_v4()::TEXT, '-', ''),
  responses JSONB NOT NULL DEFAULT '{}',
  survey_form_id TEXT NOT NULL REFERENCES survey_forms(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  line_user_id TEXT,
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_surveys_survey_form_id ON surveys(survey_form_id);
CREATE INDEX IF NOT EXISTS idx_surveys_store_id ON surveys(store_id);
CREATE INDEX IF NOT EXISTS idx_surveys_submitted_at ON surveys(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_surveys_line_user_id ON surveys(line_user_id) WHERE line_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_surveys_customer_id ON surveys(customer_id) WHERE customer_id IS NOT NULL;

COMMENT ON TABLE surveys IS 'アンケート回答データ';
COMMENT ON COLUMN surveys.responses IS '回答データ（JSONB形式）';
COMMENT ON COLUMN surveys.survey_form_id IS 'アンケートフォームID';
COMMENT ON COLUMN surveys.store_id IS '店舗ID';
COMMENT ON COLUMN surveys.submitted_at IS '送信日時';
COMMENT ON COLUMN surveys.line_user_id IS 'LINEユーザーID（LIFFから取得）';
COMMENT ON COLUMN surveys.customer_id IS '顧客ID（CRM連携）';

-- ==========================================
-- 9. survey_forms: created_by, updated_by
-- ==========================================
ALTER TABLE survey_forms ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE survey_forms ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
COMMENT ON COLUMN survey_forms.created_by IS '作成者のユーザーID';
COMMENT ON COLUMN survey_forms.updated_by IS '更新者のユーザーID';

-- ==========================================
-- 10. reservation_forms: created_by, updated_by (dev has these on reservation_forms)
-- ==========================================
ALTER TABLE reservation_forms ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE reservation_forms ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
COMMENT ON COLUMN reservation_forms.created_by IS '作成者のユーザーID';
COMMENT ON COLUMN reservation_forms.updated_by IS '更新者のユーザーID';

-- ==========================================
-- 11. RLS: Drop Japanese policies, create English (stores, reservation_forms, reservations, store_admins, survey_forms)
-- ==========================================
DROP POLICY IF EXISTS "店舗管理者は自店舗を閲覧可能" ON stores;
CREATE POLICY "store_admin_stores_select" ON stores FOR SELECT
  USING (id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "店舗管理者は自店舗のフォームを閲覧可能" ON reservation_forms;
DROP POLICY IF EXISTS "店舗管理者は自店舗のフォームを作成可能" ON reservation_forms;
DROP POLICY IF EXISTS "店舗管理者は自店舗のフォームを更新可能" ON reservation_forms;
DROP POLICY IF EXISTS "店舗管理者は自店舗のフォームを削除可能" ON reservation_forms;
DROP POLICY IF EXISTS "店舗管理者は自店舗の予約フォームを閲覧可能" ON reservation_forms;
DROP POLICY IF EXISTS "店舗管理者は自店舗の予約フォームを作成可能" ON reservation_forms;
DROP POLICY IF EXISTS "店舗管理者は自店舗の予約フォームを更新可能" ON reservation_forms;
DROP POLICY IF EXISTS "店舗管理者は自店舗の予約フォームを削除可能" ON reservation_forms;

CREATE POLICY "store_admin_reservation_forms_select" ON reservation_forms FOR SELECT
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));
CREATE POLICY "store_admin_reservation_forms_insert" ON reservation_forms FOR INSERT
  WITH CHECK (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));
CREATE POLICY "store_admin_reservation_forms_update" ON reservation_forms FOR UPDATE
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));
CREATE POLICY "store_admin_reservation_forms_delete" ON reservation_forms FOR DELETE
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "店舗管理者は自店舗の予約を閲覧可能" ON reservations;
DROP POLICY IF EXISTS "顧客フォームから予約作成可能" ON reservations;
DROP POLICY IF EXISTS "店舗管理者は自店舗の予約を更新可能" ON reservations;

CREATE POLICY "store_admin_reservations_select" ON reservations FOR SELECT
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));
CREATE POLICY "public_reservations_insert" ON reservations FOR INSERT WITH CHECK (true);
CREATE POLICY "store_admin_reservations_update" ON reservations FOR UPDATE
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "店舗管理者は自分の情報を閲覧可能" ON store_admins;
CREATE POLICY "store_admin_store_admins_select" ON store_admins FOR SELECT USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "店舗管理者は自店舗のアンケートフォームを閲覧可能" ON survey_forms;
DROP POLICY IF EXISTS "店舗管理者は自店舗のアンケートフォームを作成可能" ON survey_forms;
DROP POLICY IF EXISTS "店舗管理者は自店舗のアンケートフォームを更新可能" ON survey_forms;
DROP POLICY IF EXISTS "店舗管理者は自店舗のアンケートフォームを削除可能" ON survey_forms;

CREATE POLICY "store_admin_survey_forms_select" ON survey_forms FOR SELECT
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));
CREATE POLICY "store_admin_survey_forms_insert" ON survey_forms FOR INSERT
  WITH CHECK (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));
CREATE POLICY "store_admin_survey_forms_update" ON survey_forms FOR UPDATE
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));
CREATE POLICY "store_admin_survey_forms_delete" ON survey_forms FOR DELETE
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));

-- surveys RLS
CREATE POLICY "store_admin_surveys_select" ON surveys FOR SELECT
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));
CREATE POLICY "public_surveys_insert" ON surveys FOR INSERT WITH CHECK (true);

ALTER TABLE surveys ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- 12. CRM RLS (customers, customer_visits, customer_interactions)
-- ==========================================
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "store_admin_customers_select" ON customers FOR SELECT
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));
CREATE POLICY "store_admin_customers_insert" ON customers FOR INSERT
  WITH CHECK (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));
CREATE POLICY "store_admin_customers_update" ON customers FOR UPDATE
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));
CREATE POLICY "store_admin_customers_delete" ON customers FOR DELETE
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));

ALTER TABLE customer_visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "store_admin_customer_visits_select" ON customer_visits FOR SELECT
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));
CREATE POLICY "store_admin_customer_visits_insert" ON customer_visits FOR INSERT
  WITH CHECK (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));
CREATE POLICY "store_admin_customer_visits_update" ON customer_visits FOR UPDATE
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));

ALTER TABLE customer_interactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "store_admin_customer_interactions_select" ON customer_interactions FOR SELECT
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));
CREATE POLICY "store_admin_customer_interactions_insert" ON customer_interactions FOR INSERT
  WITH CHECK (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));
