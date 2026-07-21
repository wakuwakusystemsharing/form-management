-- ==========================================
-- 外部予約メール連携（予約通知メール → Googleカレンダー自動登録）
-- 設計書: docs/メールに届いた予約通知を自動的にGoogleカレンダーに予定を作成する資料/外部予約メール連携_実装設計.md
-- ==========================================

-- 店舗ごとの連携設定
CREATE TABLE IF NOT EXISTS external_mail_integrations (
  store_id TEXT PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  inbound_token TEXT NOT NULL UNIQUE,          -- 受信アドレスの rsv-{token} 部分（推測不可なランダム文字列）
  default_duration_minutes INTEGER NOT NULL DEFAULT 60,
  target_calendar_id TEXT,                     -- 空/NULL なら stores.google_calendar_id を使用
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- メニュー名キーワード → 所要時間のルール（sort_order の昇順で最初に一致したものを使用）
CREATE TABLE IF NOT EXISTS menu_duration_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_menu_duration_rules_store ON menu_duration_rules(store_id, sort_order);

-- 受信・解析した外部予約（重複防止と受信ログを兼ねる）
CREATE TABLE IF NOT EXISTS external_reservations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  source TEXT NOT NULL,                        -- 'salonboard' | 'ekiten' | 'gmail_forwarding' | 'unknown'
  reservation_number TEXT,                     -- 媒体の予約番号（重複防止キー）
  reservation_date DATE,
  reservation_time TEXT,
  duration_minutes INTEGER,
  customer_name TEXT,
  customer_phone TEXT,
  menu_text TEXT,
  staff_text TEXT,
  google_calendar_event_id TEXT,               -- 作成したイベントID（キャンセル対応用）
  status TEXT NOT NULL DEFAULT 'created',      -- 'created' | 'parse_failed' | 'skipped_duplicate' | 'cancelled' | 'unknown'
  mail_subject TEXT,
  mail_from TEXT,
  raw_body TEXT,                               -- 解析失敗時の調査用に原文保持（90日で自動削除予定: Phase 3）
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_external_reservations_store ON external_reservations(store_id, created_at DESC);
-- 同じ店舗×媒体×予約番号は1件のみ（メール再送・Webhookリトライへの耐性）
CREATE UNIQUE INDEX IF NOT EXISTS uniq_external_reservation
  ON external_reservations(store_id, source, reservation_number)
  WHERE reservation_number IS NOT NULL AND status IN ('created', 'cancelled');

-- ==========================================
-- RLS（書き込みは service role のみ。管理者は自店舗の参照可）
-- ==========================================
ALTER TABLE external_mail_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_duration_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_reservations ENABLE ROW LEVEL SECURITY;

-- マスター管理者: フルアクセス
CREATE POLICY master_admin_external_mail_integrations ON external_mail_integrations FOR ALL TO public
  USING (is_master_admin()) WITH CHECK (is_master_admin());
CREATE POLICY master_admin_menu_duration_rules ON menu_duration_rules FOR ALL TO public
  USING (is_master_admin()) WITH CHECK (is_master_admin());
CREATE POLICY master_admin_external_reservations ON external_reservations FOR ALL TO public
  USING (is_master_admin()) WITH CHECK (is_master_admin());

-- システム管理者: 同テナント内の店舗のみ
CREATE POLICY system_admin_external_mail_integrations ON external_mail_integrations FOR ALL TO public
  USING (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()))
  WITH CHECK (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()));
CREATE POLICY system_admin_menu_duration_rules ON menu_duration_rules FOR ALL TO public
  USING (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()))
  WITH CHECK (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()));
CREATE POLICY system_admin_external_reservations ON external_reservations FOR ALL TO public
  USING (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()))
  WITH CHECK (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()));

-- 店舗管理者: 自店舗のみ（設定・ルールは編集可、受信ログは参照のみ）
CREATE POLICY store_admin_external_mail_integrations ON external_mail_integrations FOR ALL TO public
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));
CREATE POLICY store_admin_menu_duration_rules ON menu_duration_rules FOR ALL TO public
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));
CREATE POLICY store_admin_external_reservations_select ON external_reservations FOR SELECT TO public
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));
