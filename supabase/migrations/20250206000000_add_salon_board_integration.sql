-- ==========================================
-- Salon Board Integration Tables Migration
-- 2025-02-06: Add tables for Hot Pepper Salon Board integration
-- ==========================================

-- ==========================================
-- 1. salon_board_credentials テーブル (認証情報)
-- ==========================================
CREATE TABLE IF NOT EXISTS salon_board_credentials (
  id TEXT PRIMARY KEY DEFAULT REPLACE(uuid_generate_v4()::TEXT, '-', '')::TEXT,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

  -- 認証情報（暗号化して保存）
  encrypted_login_id TEXT NOT NULL,
  encrypted_password TEXT NOT NULL,

  -- サロンボード情報
  salon_board_salon_id TEXT,
  hotpepper_salon_id TEXT,

  -- 接続状態
  connection_status TEXT DEFAULT 'pending' CHECK (connection_status IN ('pending', 'connected', 'failed', 'expired')),
  last_connection_test_at TIMESTAMPTZ,
  last_connection_error TEXT,

  -- 同期設定
  sync_enabled BOOLEAN DEFAULT true,
  auto_sync_reservations BOOLEAN DEFAULT true,
  auto_sync_cancellations BOOLEAN DEFAULT true,

  -- タイムスタンプ
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(store_id)
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_salon_board_credentials_store_id ON salon_board_credentials(store_id);
CREATE INDEX IF NOT EXISTS idx_salon_board_credentials_status ON salon_board_credentials(connection_status);

-- updated_at 自動更新トリガー
CREATE TRIGGER update_salon_board_credentials_updated_at BEFORE UPDATE ON salon_board_credentials
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- コメント
COMMENT ON TABLE salon_board_credentials IS 'サロンボード認証情報';
COMMENT ON COLUMN salon_board_credentials.encrypted_login_id IS '暗号化されたログインID';
COMMENT ON COLUMN salon_board_credentials.encrypted_password IS '暗号化されたパスワード';
COMMENT ON COLUMN salon_board_credentials.hotpepper_salon_id IS 'ホットペッパー公開ページ用ID (H000691688形式)';
COMMENT ON COLUMN salon_board_credentials.connection_status IS '接続状態: pending, connected, failed, expired';

-- ==========================================
-- 2. salon_board_stylists テーブル (スタッフ)
-- ==========================================
CREATE TABLE IF NOT EXISTS salon_board_stylists (
  id TEXT PRIMARY KEY DEFAULT REPLACE(uuid_generate_v4()::TEXT, '-', '')::TEXT,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  stylist_id TEXT NOT NULL,

  -- 基本情報
  name TEXT NOT NULL,
  name_kana TEXT,
  custom_name TEXT,
  custom_name_kana TEXT,

  -- 画像
  image_url TEXT,
  original_image_url TEXT,

  -- 予約関連
  reservation_url TEXT,
  nomination_fee INTEGER,

  -- 表示設定
  is_hidden BOOLEAN DEFAULT false,

  -- 同期情報
  last_synced_at TIMESTAMPTZ,

  -- タイムスタンプ
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,

  UNIQUE(store_id, stylist_id)
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_salon_board_stylists_store_id ON salon_board_stylists(store_id);
CREATE INDEX IF NOT EXISTS idx_salon_board_stylists_stylist_id ON salon_board_stylists(stylist_id);

-- updated_at 自動更新トリガー
CREATE TRIGGER update_salon_board_stylists_updated_at BEFORE UPDATE ON salon_board_stylists
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- コメント
COMMENT ON TABLE salon_board_stylists IS 'サロンボードスタッフ情報';
COMMENT ON COLUMN salon_board_stylists.stylist_id IS 'サロンボード上のスタッフID (W...)';
COMMENT ON COLUMN salon_board_stylists.nomination_fee IS '指名料';

-- ==========================================
-- 3. salon_board_menu_categories テーブル (メニューカテゴリ)
-- ==========================================
CREATE TABLE IF NOT EXISTS salon_board_menu_categories (
  id TEXT PRIMARY KEY DEFAULT REPLACE(uuid_generate_v4()::TEXT, '-', '')::TEXT,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

  -- カテゴリ情報
  title TEXT NOT NULL,
  thumbnail TEXT,
  display_order INTEGER DEFAULT 0,
  description TEXT,
  type TEXT DEFAULT 'menu' CHECK (type IN ('menu', 'coupon')),
  text_content TEXT,

  -- 表示設定
  is_hidden BOOLEAN DEFAULT false,

  -- タイムスタンプ
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_salon_board_menu_categories_store_id ON salon_board_menu_categories(store_id);

-- updated_at 自動更新トリガー
CREATE TRIGGER update_salon_board_menu_categories_updated_at BEFORE UPDATE ON salon_board_menu_categories
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- コメント
COMMENT ON TABLE salon_board_menu_categories IS 'サロンボードメニューカテゴリ';

-- ==========================================
-- 4. salon_board_menus テーブル (メニュー・クーポン)
-- ==========================================
CREATE TABLE IF NOT EXISTS salon_board_menus (
  id TEXT PRIMARY KEY DEFAULT REPLACE(uuid_generate_v4()::TEXT, '-', '')::TEXT,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  menu_id TEXT NOT NULL,

  -- 基本情報
  title TEXT NOT NULL,
  custom_title TEXT,
  description TEXT,
  custom_description TEXT,

  -- 画像
  image_url TEXT,
  original_image_url TEXT,

  -- 予約関連
  reservation_url TEXT,

  -- メニュー種別
  type TEXT NOT NULL CHECK (type IN ('coupon', 'menu')),

  -- 料金・時間
  price TEXT,
  custom_price TEXT,
  treatment_time INTEGER,

  -- 条件・制限
  visit_date_conditions TEXT,
  other_condition TEXT,
  menu_category_cd TEXT,
  class TEXT,

  -- 表示設定
  is_hidden BOOLEAN DEFAULT false,

  -- カスタマイズフラグ
  is_custom_title BOOLEAN DEFAULT false,
  is_custom_description BOOLEAN DEFAULT false,
  is_custom_price BOOLEAN DEFAULT false,
  is_price_range BOOLEAN DEFAULT false,

  -- 同期情報
  sync_source TEXT DEFAULT 'salonboard',
  display_order INTEGER DEFAULT 0,
  last_synced_at TIMESTAMPTZ,

  -- タイムスタンプ
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(store_id, menu_id)
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_salon_board_menus_store_id ON salon_board_menus(store_id);
CREATE INDEX IF NOT EXISTS idx_salon_board_menus_menu_id ON salon_board_menus(menu_id);
CREATE INDEX IF NOT EXISTS idx_salon_board_menus_type ON salon_board_menus(type);

-- updated_at 自動更新トリガー
CREATE TRIGGER update_salon_board_menus_updated_at BEFORE UPDATE ON salon_board_menus
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- コメント
COMMENT ON TABLE salon_board_menus IS 'サロンボードメニュー・クーポン';
COMMENT ON COLUMN salon_board_menus.menu_id IS 'サロンボード上のメニューID (CP... or MN...)';
COMMENT ON COLUMN salon_board_menus.type IS 'メニュー種別: coupon, menu';
COMMENT ON COLUMN salon_board_menus.treatment_time IS '施術時間（分）';
COMMENT ON COLUMN salon_board_menus.menu_category_cd IS 'メニューカテゴリコード (MC21, MC31, OFF等)';

-- ==========================================
-- 5. salon_board_menu_category_relations テーブル (メニュー⇔カテゴリ関連)
-- ==========================================
CREATE TABLE IF NOT EXISTS salon_board_menu_category_relations (
  menu_id TEXT NOT NULL REFERENCES salon_board_menus(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES salon_board_menu_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (menu_id, category_id)
);

-- コメント
COMMENT ON TABLE salon_board_menu_category_relations IS 'メニュー⇔カテゴリ関連';

-- ==========================================
-- 6. salon_board_menu_stylist_relations テーブル (メニュー⇔スタッフ関連)
-- ==========================================
CREATE TABLE IF NOT EXISTS salon_board_menu_stylist_relations (
  menu_id TEXT NOT NULL REFERENCES salon_board_menus(id) ON DELETE CASCADE,
  stylist_id TEXT NOT NULL REFERENCES salon_board_stylists(id) ON DELETE CASCADE,
  PRIMARY KEY (menu_id, stylist_id)
);

-- コメント
COMMENT ON TABLE salon_board_menu_stylist_relations IS 'メニュー⇔スタッフ関連（スタッフ限定メニュー用）';

-- ==========================================
-- 7. salon_board_sync_logs テーブル (同期ログ)
-- ==========================================
CREATE TABLE IF NOT EXISTS salon_board_sync_logs (
  id TEXT PRIMARY KEY DEFAULT REPLACE(uuid_generate_v4()::TEXT, '-', '')::TEXT,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  reservation_id TEXT REFERENCES reservations(id) ON DELETE SET NULL,

  -- 同期情報
  sync_type TEXT NOT NULL CHECK (sync_type IN (
    'reservation_create',
    'reservation_cancel',
    'reservation_modify',
    'menu_sync',
    'stylist_sync',
    'availability_fetch'
  )),
  sync_direction TEXT NOT NULL CHECK (sync_direction IN ('outbound', 'inbound')),

  -- 結果
  status TEXT NOT NULL CHECK (status IN ('pending', 'success', 'failed', 'retry')),
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,

  -- 詳細情報
  request_summary JSONB,
  response_summary JSONB,
  items_synced INTEGER,

  -- タイムスタンプ
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_salon_board_sync_logs_store_id ON salon_board_sync_logs(store_id);
CREATE INDEX IF NOT EXISTS idx_salon_board_sync_logs_reservation_id ON salon_board_sync_logs(reservation_id);
CREATE INDEX IF NOT EXISTS idx_salon_board_sync_logs_status ON salon_board_sync_logs(status);
CREATE INDEX IF NOT EXISTS idx_salon_board_sync_logs_sync_type ON salon_board_sync_logs(sync_type);
CREATE INDEX IF NOT EXISTS idx_salon_board_sync_logs_created_at ON salon_board_sync_logs(created_at DESC);

-- コメント
COMMENT ON TABLE salon_board_sync_logs IS 'サロンボード同期ログ';
COMMENT ON COLUMN salon_board_sync_logs.sync_type IS '同期種別: reservation_create, reservation_cancel, menu_sync, stylist_sync, availability_fetch';
COMMENT ON COLUMN salon_board_sync_logs.sync_direction IS '同期方向: outbound（→サロンボード）, inbound（←サロンボード）';
COMMENT ON COLUMN salon_board_sync_logs.items_synced IS '同期されたアイテム数';

-- ==========================================
-- 8. reservations テーブル拡張
-- ==========================================
ALTER TABLE reservations
ADD COLUMN IF NOT EXISTS salon_board_reservation_id TEXT,
ADD COLUMN IF NOT EXISTS salon_board_synced_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS salon_board_sync_status TEXT DEFAULT 'not_required' CHECK (salon_board_sync_status IN ('not_required', 'pending', 'synced', 'failed'));

-- インデックス
CREATE INDEX IF NOT EXISTS idx_reservations_salon_board_id ON reservations(salon_board_reservation_id) WHERE salon_board_reservation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reservations_salon_board_sync_status ON reservations(salon_board_sync_status) WHERE salon_board_sync_status != 'not_required';

-- コメント
COMMENT ON COLUMN reservations.salon_board_reservation_id IS 'サロンボード側の予約ID';
COMMENT ON COLUMN reservations.salon_board_synced_at IS 'サロンボードへの同期日時';
COMMENT ON COLUMN reservations.salon_board_sync_status IS 'サロンボード同期状態: not_required, pending, synced, failed';

-- ==========================================
-- 9. RLS (Row Level Security) ポリシー
-- ==========================================

-- salon_board_credentials
ALTER TABLE salon_board_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "store_admin_credentials_select" ON salon_board_credentials
  FOR SELECT
  USING (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "store_admin_credentials_insert" ON salon_board_credentials
  FOR INSERT
  WITH CHECK (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "store_admin_credentials_update" ON salon_board_credentials
  FOR UPDATE
  USING (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "store_admin_credentials_delete" ON salon_board_credentials
  FOR DELETE
  USING (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

-- salon_board_stylists
ALTER TABLE salon_board_stylists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "store_admin_stylists_select" ON salon_board_stylists
  FOR SELECT
  USING (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "store_admin_stylists_all" ON salon_board_stylists
  FOR ALL
  USING (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

-- salon_board_menu_categories
ALTER TABLE salon_board_menu_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "store_admin_categories_select" ON salon_board_menu_categories
  FOR SELECT
  USING (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "store_admin_categories_all" ON salon_board_menu_categories
  FOR ALL
  USING (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

-- salon_board_menus
ALTER TABLE salon_board_menus ENABLE ROW LEVEL SECURITY;

CREATE POLICY "store_admin_menus_select" ON salon_board_menus
  FOR SELECT
  USING (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "store_admin_menus_all" ON salon_board_menus
  FOR ALL
  USING (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

-- salon_board_sync_logs
ALTER TABLE salon_board_sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "store_admin_sync_logs_select" ON salon_board_sync_logs
  FOR SELECT
  USING (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

-- Service role policy for admin operations
CREATE POLICY "service_role_credentials_all" ON salon_board_credentials
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "service_role_stylists_all" ON salon_board_stylists
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "service_role_categories_all" ON salon_board_menu_categories
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "service_role_menus_all" ON salon_board_menus
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "service_role_sync_logs_all" ON salon_board_sync_logs
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');
