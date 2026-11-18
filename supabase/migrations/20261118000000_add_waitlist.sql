-- 空き待ち（キャンセル待ち）機能
-- 満席の枠に登録したお客様へ、枠が空いたら LINE で知らせる。
-- 設定はフォームの config.calendar_settings.waitlist（既定 OFF）。ここは登録と通知の記録だけ。
-- どちらのテーブルも API（service_role）からだけ読み書きする（RLS のポリシーは作らない）

CREATE TABLE IF NOT EXISTS waitlist_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  form_id TEXT NOT NULL,
  customer_id TEXT,                                   -- customers.id（顧客を削除しても空き待ちは残す）
  line_user_id TEXT NOT NULL,
  customer_name TEXT,
  reservation_date DATE NOT NULL,
  reservation_time TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 0,
  selected_menus JSONB NOT NULL DEFAULT '[]'::jsonb,
  selected_options JSONB NOT NULL DEFAULT '[]'::jsonb,
  menu_text TEXT,
  staff_id TEXT,
  staff_name TEXT,
  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'notified', 'fulfilled', 'expired', 'cancelled', 'inactive')),
  notified_at TIMESTAMPTZ,
  notify_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 同じ人が同じ条件（フォーム・日時・スタッフ）で二重に登録できないようにする（有効な空き待ちだけ）
CREATE UNIQUE INDEX IF NOT EXISTS unique_waitlist_active_entry
  ON waitlist_entries (store_id, form_id, line_user_id, reservation_date, reservation_time, COALESCE(staff_id, ''))
  WHERE status IN ('waiting', 'notified');

CREATE INDEX IF NOT EXISTS idx_waitlist_entries_active
  ON waitlist_entries (store_id, reservation_date)
  WHERE status IN ('waiting', 'notified');

CREATE INDEX IF NOT EXISTS idx_waitlist_entries_store_created
  ON waitlist_entries (store_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_waitlist_entries_user
  ON waitlist_entries (store_id, line_user_id);

CREATE TABLE IF NOT EXISTS waitlist_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  waitlist_entry_id UUID NOT NULL REFERENCES waitlist_entries(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('slot_opened', 'slot_filled')),
  slot_start_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  result TEXT NOT NULL CHECK (result IN ('success', 'failed')),
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_waitlist_notifications_entry
  ON waitlist_notifications (waitlist_entry_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_waitlist_notifications_store
  ON waitlist_notifications (store_id, sent_at DESC);

ALTER TABLE waitlist_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE waitlist_notifications ENABLE ROW LEVEL SECURITY;
