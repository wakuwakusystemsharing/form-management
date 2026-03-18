-- ==========================================
-- CRM Tables Migration
-- 2025-02-04: Add customer management tables for CRM functionality
-- ==========================================

-- ==========================================
-- 1. customers テーブル (顧客マスタ)
-- ==========================================
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY DEFAULT REPLACE(uuid_generate_v4()::TEXT, '-', '')::TEXT,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  line_user_id TEXT,

  -- 基本情報
  name TEXT NOT NULL,
  name_kana TEXT,
  phone TEXT,
  email TEXT,
  birthday DATE,
  gender TEXT CHECK (gender IN ('male', 'female', 'other', 'unknown')),

  -- LINE連携情報
  line_display_name TEXT,
  line_picture_url TEXT,
  line_status_message TEXT,
  line_email TEXT,
  line_friend_flag BOOLEAN DEFAULT false,
  line_friend_added_at TIMESTAMPTZ,
  line_language TEXT,
  line_os TEXT CHECK (line_os IN ('ios', 'android', 'web')),

  -- 顧客属性
  customer_type TEXT DEFAULT 'regular' CHECK (customer_type IN ('new', 'regular', 'vip', 'inactive')),
  preferred_contact_method TEXT,
  allergies TEXT,
  medical_history TEXT,
  notes TEXT,
  tags TEXT[],

  -- 統計情報（自動更新）
  total_visits INTEGER DEFAULT 0,
  total_spent NUMERIC(10, 2) DEFAULT 0,
  first_visit_date DATE,
  last_visit_date DATE,
  average_visit_interval_days INTEGER,

  -- タイムスタンプ
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_customers_store_id ON customers(store_id);
CREATE INDEX IF NOT EXISTS idx_customers_line_user_id ON customers(line_user_id) WHERE line_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_customer_type ON customers(customer_type);
CREATE INDEX IF NOT EXISTS idx_customers_last_visit_date ON customers(last_visit_date DESC);
CREATE INDEX IF NOT EXISTS idx_customers_created_at ON customers(created_at DESC);

-- Partial unique index: 同一店舗内でLINEユーザーIDは一意（NULLは複数可）
CREATE UNIQUE INDEX IF NOT EXISTS unique_customers_store_line_user
ON customers(store_id, line_user_id)
WHERE line_user_id IS NOT NULL;

-- updated_at 自動更新トリガー
CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- コメント
COMMENT ON TABLE customers IS '顧客マスタ（CRM）';
COMMENT ON COLUMN customers.line_user_id IS 'LINEユーザーID（重複不可）';
COMMENT ON COLUMN customers.customer_type IS '顧客タイプ: new, regular, vip, inactive';
COMMENT ON COLUMN customers.total_visits IS '来店回数（自動更新）';
COMMENT ON COLUMN customers.total_spent IS '総利用金額（自動更新）';

-- ==========================================
-- 2. customer_visits テーブル (来店履歴)
-- ==========================================
CREATE TABLE IF NOT EXISTS customer_visits (
  id TEXT PRIMARY KEY DEFAULT REPLACE(uuid_generate_v4()::TEXT, '-', '')::TEXT,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  reservation_id TEXT REFERENCES reservations(id) ON DELETE SET NULL,

  -- 来店情報
  visit_date DATE NOT NULL,
  visit_time TIME,
  visit_type TEXT DEFAULT 'reservation' CHECK (visit_type IN ('reservation', 'walk_in', 'follow_up')),

  -- 施術情報
  treatment_menus JSONB,
  treatment_notes TEXT,
  therapist_name TEXT,
  satisfaction_score INTEGER CHECK (satisfaction_score BETWEEN 1 AND 5),

  -- 金額情報
  amount NUMERIC(10, 2),
  payment_method TEXT,

  -- タイムスタンプ
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_customer_visits_customer_id ON customer_visits(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_visits_store_id ON customer_visits(store_id);
CREATE INDEX IF NOT EXISTS idx_customer_visits_reservation_id ON customer_visits(reservation_id) WHERE reservation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customer_visits_visit_date ON customer_visits(visit_date DESC);
CREATE INDEX IF NOT EXISTS idx_customer_visits_created_at ON customer_visits(created_at DESC);

-- updated_at 自動更新トリガー
CREATE TRIGGER update_customer_visits_updated_at BEFORE UPDATE ON customer_visits
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- コメント
COMMENT ON TABLE customer_visits IS '来店履歴';
COMMENT ON COLUMN customer_visits.visit_type IS '来店種別: reservation（予約）, walk_in（飛び込み）, follow_up（フォローアップ）';

-- ==========================================
-- 3. customer_interactions テーブル (顧客とのやり取り履歴)
-- ==========================================
CREATE TABLE IF NOT EXISTS customer_interactions (
  id TEXT PRIMARY KEY DEFAULT REPLACE(uuid_generate_v4()::TEXT, '-', '')::TEXT,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

  -- やり取り情報
  interaction_type TEXT NOT NULL CHECK (interaction_type IN ('call', 'email', 'line_message', 'sms', 'note', 'reminder')),
  direction TEXT CHECK (direction IN ('inbound', 'outbound')),
  subject TEXT,
  content TEXT,

  -- LINE連携
  line_message_id TEXT,

  -- 作成者
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_customer_interactions_customer_id ON customer_interactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_interactions_store_id ON customer_interactions(store_id);
CREATE INDEX IF NOT EXISTS idx_customer_interactions_created_at ON customer_interactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_interactions_type ON customer_interactions(interaction_type);

-- コメント
COMMENT ON TABLE customer_interactions IS '顧客とのやり取り履歴';
COMMENT ON COLUMN customer_interactions.interaction_type IS 'やり取り種別: call, email, line_message, sms, note, reminder';
COMMENT ON COLUMN customer_interactions.direction IS '方向: inbound（受信）, outbound（送信）';

-- ==========================================
-- 4. 既存テーブルの拡張
-- ==========================================

-- reservations テーブルに customer_id カラムを追加
ALTER TABLE reservations
ADD COLUMN IF NOT EXISTS customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL;

-- インデックスを追加
CREATE INDEX IF NOT EXISTS idx_reservations_customer_id
ON reservations(customer_id)
WHERE customer_id IS NOT NULL;

-- コメントを追加
COMMENT ON COLUMN reservations.customer_id IS '顧客ID（CRM連携）';

-- surveys テーブルに customer_id カラムを追加（surveysテーブルが存在する場合）
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'surveys') THEN
    ALTER TABLE surveys
    ADD COLUMN IF NOT EXISTS customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL;

    -- インデックスを追加
    CREATE INDEX IF NOT EXISTS idx_surveys_customer_id
    ON surveys(customer_id)
    WHERE customer_id IS NOT NULL;

    -- コメントを追加
    COMMENT ON COLUMN surveys.customer_id IS '顧客ID（CRM連携）';
  END IF;
END $$;

-- ==========================================
-- 5. Row Level Security (RLS) 設定
-- ==========================================

-- customers テーブルの RLS
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

-- 店舗管理者は自店舗の顧客のみ閲覧可能
CREATE POLICY "store_admin_customers_select" ON customers
  FOR SELECT
  USING (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

-- 店舗管理者は自店舗の顧客を作成可能
CREATE POLICY "store_admin_customers_insert" ON customers
  FOR INSERT
  WITH CHECK (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

-- 店舗管理者は自店舗の顧客を更新可能
CREATE POLICY "store_admin_customers_update" ON customers
  FOR UPDATE
  USING (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

-- 店舗管理者は自店舗の顧客を削除可能
CREATE POLICY "store_admin_customers_delete" ON customers
  FOR DELETE
  USING (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

-- customer_visits テーブルの RLS
ALTER TABLE customer_visits ENABLE ROW LEVEL SECURITY;

-- 店舗管理者は自店舗の来店履歴のみ閲覧可能
CREATE POLICY "store_admin_customer_visits_select" ON customer_visits
  FOR SELECT
  USING (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

-- 店舗管理者は自店舗の来店履歴を作成可能
CREATE POLICY "store_admin_customer_visits_insert" ON customer_visits
  FOR INSERT
  WITH CHECK (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

-- 店舗管理者は自店舗の来店履歴を更新可能
CREATE POLICY "store_admin_customer_visits_update" ON customer_visits
  FOR UPDATE
  USING (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

-- customer_interactions テーブルの RLS
ALTER TABLE customer_interactions ENABLE ROW LEVEL SECURITY;

-- 店舗管理者は自店舗の顧客とのやり取り履歴のみ閲覧可能
CREATE POLICY "store_admin_customer_interactions_select" ON customer_interactions
  FOR SELECT
  USING (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

-- 店舗管理者は自店舗の顧客とのやり取り履歴を作成可能
CREATE POLICY "store_admin_customer_interactions_insert" ON customer_interactions
  FOR INSERT
  WITH CHECK (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

-- ==========================================
-- 6. サンプルデータ（開発・テスト用）
-- ==========================================

-- サンプル顧客データ（店舗 st0001 用）
INSERT INTO customers (
  id,
  store_id,
  line_user_id,
  name,
  name_kana,
  phone,
  email,
  gender,
  customer_type,
  total_visits,
  first_visit_date,
  last_visit_date
) VALUES
  (
    'cust_sample_001',
    'st0001',
    'U1234567890abcdef',
    '山田太郎',
    'ヤマダタロウ',
    '090-1234-5678',
    'yamada@example.com',
    'male',
    'regular',
    3,
    '2025-01-15',
    '2025-02-03'
  ),
  (
    'cust_sample_002',
    'st0001',
    NULL,
    '佐藤花子',
    'サトウハナコ',
    '080-9876-5432',
    'sato@example.com',
    'female',
    'new',
    1,
    '2025-02-01',
    '2025-02-01'
  )
ON CONFLICT (id) DO NOTHING;

-- サンプル来店履歴データ
INSERT INTO customer_visits (
  id,
  customer_id,
  store_id,
  visit_date,
  visit_time,
  visit_type,
  treatment_menus,
  amount
) VALUES
  (
    'visit_sample_001',
    'cust_sample_001',
    'st0001',
    '2025-01-15',
    '14:00',
    'reservation',
    '[{"menu_name": "カット", "price": 3000}]'::jsonb,
    3000
  ),
  (
    'visit_sample_002',
    'cust_sample_001',
    'st0001',
    '2025-02-03',
    '15:00',
    'reservation',
    '[{"menu_name": "カラー", "price": 5000}]'::jsonb,
    5000
  )
ON CONFLICT (id) DO NOTHING;
