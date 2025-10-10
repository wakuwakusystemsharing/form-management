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
  id TEXT PRIMARY KEY DEFAULT 'st' || LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0'),
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 店舗テーブルのインデックス
CREATE INDEX IF NOT EXISTS idx_stores_created_at ON stores(created_at DESC);

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

-- 店舗管理者は自分の店舗のみ閲覧可能
CREATE POLICY "店舗管理者は自店舗を閲覧可能" ON stores
  FOR SELECT
  USING (
    id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

-- forms テーブルの RLS
ALTER TABLE forms ENABLE ROW LEVEL SECURITY;

-- 店舗管理者は自店舗のフォームのみ CRUD 可能
CREATE POLICY "店舗管理者は自店舗のフォームを閲覧可能" ON forms
  FOR SELECT
  USING (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "店舗管理者は自店舗のフォームを作成可能" ON forms
  FOR INSERT
  WITH CHECK (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "店舗管理者は自店舗のフォームを更新可能" ON forms
  FOR UPDATE
  USING (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "店舗管理者は自店舗のフォームを削除可能" ON forms
  FOR DELETE
  USING (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

-- reservations テーブルの RLS
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;

-- 店舗管理者は自店舗の予約のみ閲覧可能
CREATE POLICY "店舗管理者は自店舗の予約を閲覧可能" ON reservations
  FOR SELECT
  USING (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

-- 顧客フォームからの予約作成は公開アクセス許可 (認証不要)
CREATE POLICY "顧客フォームから予約作成可能" ON reservations
  FOR INSERT
  WITH CHECK (true);

-- 店舗管理者は自店舗の予約を更新可能
CREATE POLICY "店舗管理者は自店舗の予約を更新可能" ON reservations
  FOR UPDATE
  USING (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

-- store_admins テーブルの RLS
ALTER TABLE store_admins ENABLE ROW LEVEL SECURITY;

-- 店舗管理者は自分の情報のみ閲覧可能
CREATE POLICY "店舗管理者は自分の情報を閲覧可能" ON store_admins
  FOR SELECT
  USING (user_id = auth.uid());

-- ==========================================
-- 6. サンプルデータ (開発用)
-- ==========================================

-- サンプル店舗
INSERT INTO stores (id, name, description) VALUES
  ('st0001', 'サンプル店舗A', 'テスト用の店舗データです'),
  ('st0002', 'サンプル店舗B', 'テスト用の店舗データです')
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
