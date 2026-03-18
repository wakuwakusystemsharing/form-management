-- ==========================================
-- Initial Schema for Form Management System
-- Supabase Migration (staging/production)
-- ==========================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- 1. stores テーブル (店舗)
-- ==========================================
CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY DEFAULT REPLACE(uuid_generate_v4()::TEXT, '-', '')::TEXT,
  name TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  description TEXT,
  website_url TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 店舗テーブルのインデックス
CREATE INDEX IF NOT EXISTS idx_stores_created_at ON stores(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stores_status ON stores(status);

-- 店舗テーブルの updated_at 自動更新トリガー
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_stores_updated_at BEFORE UPDATE ON stores
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==========================================
-- 2. forms テーブル (フォーム)
-- ==========================================
CREATE TABLE IF NOT EXISTS forms (
  id TEXT PRIMARY KEY DEFAULT REPLACE(uuid_generate_v4()::TEXT, '-', '')::TEXT,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ('active', 'inactive')),
  draft_status TEXT NOT NULL DEFAULT 'draft' CHECK (draft_status IN ('draft', 'published')),
  config JSONB NOT NULL DEFAULT '{}'::JSONB,
  static_deploy JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_published_at TIMESTAMPTZ
);

-- フォームテーブルのインデックス
CREATE INDEX IF NOT EXISTS idx_forms_store_id ON forms(store_id);
CREATE INDEX IF NOT EXISTS idx_forms_status ON forms(status);
CREATE INDEX IF NOT EXISTS idx_forms_created_at ON forms(created_at DESC);

-- フォームテーブルの updated_at 自動更新トリガー
CREATE TRIGGER update_forms_updated_at BEFORE UPDATE ON forms
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==========================================
-- 3. reservations テーブル (予約)
-- ==========================================
CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY DEFAULT REPLACE(uuid_generate_v4()::TEXT, '-', '')::TEXT,
  form_id TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  reservation_date DATE NOT NULL,
  reservation_time TIME NOT NULL,
  menu_name TEXT NOT NULL,
  submenu_name TEXT,
  gender TEXT,
  visit_count TEXT,
  coupon TEXT,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 予約テーブルのインデックス
CREATE INDEX IF NOT EXISTS idx_reservations_store_id ON reservations(store_id);
CREATE INDEX IF NOT EXISTS idx_reservations_form_id ON reservations(form_id);
CREATE INDEX IF NOT EXISTS idx_reservations_date ON reservations(reservation_date DESC);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);
CREATE INDEX IF NOT EXISTS idx_reservations_created_at ON reservations(created_at DESC);

-- 予約テーブルの updated_at 自動更新トリガー
CREATE TRIGGER update_reservations_updated_at BEFORE UPDATE ON reservations
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==========================================
-- 4. store_admins テーブル (店舗管理者)
-- ==========================================
CREATE TABLE IF NOT EXISTS store_admins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'staff')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, store_id)
);

-- 店舗管理者テーブルのインデックス
CREATE INDEX IF NOT EXISTS idx_store_admins_user_id ON store_admins(user_id);
CREATE INDEX IF NOT EXISTS idx_store_admins_store_id ON store_admins(store_id);

-- 店舗管理者テーブルの updated_at 自動更新トリガー
CREATE TRIGGER update_store_admins_updated_at BEFORE UPDATE ON store_admins
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==========================================
-- 5. Row Level Security (RLS) 設定
-- ==========================================

-- stores テーブルの RLS
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;

-- Store admins can view only their own stores
CREATE POLICY "store_admin_stores_select" ON stores
  FOR SELECT
  USING (
    id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

-- forms table RLS
ALTER TABLE forms ENABLE ROW LEVEL SECURITY;

-- Store admins can CRUD forms for their own stores only
CREATE POLICY "store_admin_forms_select" ON forms
  FOR SELECT
  USING (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "store_admin_forms_insert" ON forms
  FOR INSERT
  WITH CHECK (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "store_admin_forms_update" ON forms
  FOR UPDATE
  USING (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "store_admin_forms_delete" ON forms
  FOR DELETE
  USING (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

-- reservations table RLS
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;

-- Store admins can view reservations for their own stores only
CREATE POLICY "store_admin_reservations_select" ON reservations
  FOR SELECT
  USING (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

-- Public access for reservation creation from customer forms (no authentication required)
CREATE POLICY "public_reservations_insert" ON reservations
  FOR INSERT
  WITH CHECK (true);

-- Store admins can update reservations for their own stores
CREATE POLICY "store_admin_reservations_update" ON reservations
  FOR UPDATE
  USING (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

-- store_admins table RLS
ALTER TABLE store_admins ENABLE ROW LEVEL SECURITY;

-- Store admins can view only their own information
CREATE POLICY "store_admin_store_admins_select" ON store_admins
  FOR SELECT
  USING (user_id = auth.uid());

-- ==========================================
-- 6. サンプルデータ (開発用)
-- ==========================================

-- サンプル店舗
INSERT INTO stores (id, name, owner_name, owner_email, description, status) VALUES
  ('st0001', 'サンプル店舗A', 'サンプルオーナーA', 'owner-a@example.com', 'テスト用の店舗データです', 'active'),
  ('st0002', 'サンプル店舗B', 'サンプルオーナーB', 'owner-b@example.com', 'テスト用の店舗データです', 'active')
ON CONFLICT (id) DO NOTHING;

-- サンプルフォーム (店舗 st0001 用)
INSERT INTO forms (id, store_id, status, config) VALUES
  ('sample_form_001', 'st0001', 'active', '{
    "basic_info": {
      "form_name": "サンプル予約フォーム",
      "store_name": "サンプル店舗A",
      "liff_id": "",
      "theme_color": "#3B82F6"
    },
    "gender_selection": {
      "enabled": true,
      "required": false,
      "options": [
        {"value": "male", "label": "男性"},
        {"value": "female", "label": "女性"}
      ]
    },
    "menu_structure": {
      "structure_type": "category_based",
      "categories": [
        {
          "id": "cat001",
          "name": "カット",
          "menus": [
            {
              "id": "menu001",
              "name": "カット",
              "price": 3000,
              "duration": 30,
              "has_submenu": false
            }
          ]
        }
      ],
      "display_options": {
        "show_price": true,
        "show_duration": true,
        "show_description": true,
        "show_treatment_info": false
      }
    },
    "calendar_settings": {
      "business_hours": {
        "monday": {"open": "09:00", "close": "18:00", "closed": false},
        "tuesday": {"open": "09:00", "close": "18:00", "closed": false},
        "wednesday": {"open": "09:00", "close": "18:00", "closed": false},
        "thursday": {"open": "09:00", "close": "18:00", "closed": false},
        "friday": {"open": "09:00", "close": "18:00", "closed": false},
        "saturday": {"open": "09:00", "close": "18:00", "closed": false},
        "sunday": {"open": "09:00", "close": "18:00", "closed": true}
      },
      "advance_booking_days": 30
    },
    "gas_endpoint": ""
  }'::jsonb)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE stores IS '店舗マスタ';
COMMENT ON TABLE forms IS 'フォーム設定 (店舗ごと)';
COMMENT ON TABLE reservations IS '予約データ (全店舗共通)';
COMMENT ON TABLE store_admins IS '店舗管理者マッピング';
