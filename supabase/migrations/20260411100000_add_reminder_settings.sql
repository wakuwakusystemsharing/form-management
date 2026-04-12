-- ==========================================
-- 店舗ごとのリマインダー設定カラム追加
-- reminder_enabled: 有効/無効（デフォルト有効）
-- reminder_time: 送信時刻（デフォルト19:00）
-- ==========================================

ALTER TABLE stores ADD COLUMN IF NOT EXISTS reminder_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS reminder_time TEXT NOT NULL DEFAULT '19:00';
