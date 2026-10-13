-- 直前リマインダー: 予約時間の N 分前（30 分刻み。既定 60）に LINE で知らせる
-- 前日（reminder_*）・当日（reminder_same_day_*）とは独立に ON/OFF。文面は reminder_template を共通で使う
-- （既定文言だけ「【ご予約1時間前のお知らせ】/ 1時間後にご予約のお時間です」）。
-- 予約時刻を過ぎた予約・予定時刻を過ぎてから入った予約・時刻の無い予約には送らない。
-- ※ 分単位で送るため pg_cron の send_reservation_reminders は 10 分おき（*/10 * * * *）に変更する（手順: docs/フォローメッセージ_リリース手順.md）

-- 1. 店舗設定
ALTER TABLE stores ADD COLUMN IF NOT EXISTS reminder_before_time_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS reminder_before_time_minutes INTEGER NOT NULL DEFAULT 60;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stores_reminder_before_time_minutes_check') THEN
    ALTER TABLE stores ADD CONSTRAINT stores_reminder_before_time_minutes_check
      CHECK (reminder_before_time_minutes IN (30, 60, 90, 120, 180, 240, 360, 720)) NOT VALID;
  END IF;
END $$;

COMMENT ON COLUMN stores.reminder_before_time_enabled IS '直前リマインダー（予約時間の reminder_before_time_minutes 分前に送信）。前日・当日とは独立';
COMMENT ON COLUMN stores.reminder_before_time_minutes IS '直前リマインダーの「何分前」（30 分刻み）';

-- 2. 送信記録の種別に before_time を追加
ALTER TABLE reminder_logs DROP CONSTRAINT IF EXISTS reminder_logs_kind_check;
ALTER TABLE reminder_logs ADD CONSTRAINT reminder_logs_kind_check
  CHECK (kind IN ('before', 'same_day', 'before_time'));

COMMENT ON COLUMN reminder_logs.kind IS 'before = 何日前 / same_day = 当日 / before_time = 直前（予約時間の N 分前）';
