-- 店舗ごとの LINE リマインダー文面カスタマイズ
-- NULL / 未設定 = 従来のデフォルト文面で送信。値は JSON:
-- { header_title, header_color, body_text, text_color, show_details, footer_text, show_footer }
-- body_text では {LINE名} {お名前} {予約日時} {予約日} {予約時間} {メニュー名} {担当スタッフ} {店舗名} が差し込まれる
ALTER TABLE stores ADD COLUMN IF NOT EXISTS reminder_template JSONB;
