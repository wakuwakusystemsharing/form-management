-- 当日リマインダー: 予約当日の指定時刻（既定 09:00）に「本日の予約」を LINE で知らせる
-- 前日などの既存リマインダー（reminder_enabled / reminder_days_before / reminder_time）とは独立して ON/OFF できる。
-- 文面は reminder_template を共通で使う（デフォルト文言だけ「【予約当日メッセージ】/ 本日の予約をお知らせします」に変わる）。

-- 1. 店舗設定
ALTER TABLE stores ADD COLUMN IF NOT EXISTS reminder_same_day_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS reminder_same_day_time TEXT NOT NULL DEFAULT '09:00';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stores_reminder_same_day_time_check') THEN
    ALTER TABLE stores ADD CONSTRAINT stores_reminder_same_day_time_check
      CHECK (reminder_same_day_time ~ '^([01][0-9]|2[0-3]):00$') NOT VALID;
  END IF;
END $$;

COMMENT ON COLUMN stores.reminder_same_day_enabled IS '当日リマインダー（予約当日の reminder_same_day_time に送信）。前日などのリマインダーとは独立';
COMMENT ON COLUMN stores.reminder_same_day_time IS '当日リマインダーの送信時刻（HH:00、JST）。予約時刻を過ぎた予約には送らない';

-- 2. 送信記録に種別を追加（同じ予約・同じ対象日に「前日」と「当日」の 2 行を持てるようにする）
ALTER TABLE reminder_logs ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'before';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reminder_logs_kind_check') THEN
    ALTER TABLE reminder_logs ADD CONSTRAINT reminder_logs_kind_check
      CHECK (kind IN ('before', 'same_day'));
  END IF;
END $$;

DROP INDEX IF EXISTS uq_reminder_logs_reservation_target;
CREATE UNIQUE INDEX IF NOT EXISTS uq_reminder_logs_reservation_target_kind
  ON reminder_logs (reservation_id, target_date, kind);

COMMENT ON COLUMN reminder_logs.kind IS 'before = 何日前リマインダー / same_day = 当日リマインダー';
