-- 店舗の郵便番号カラム追加
-- Web 予約フォームのお客様確認メールに「〒xxx-xxxx 住所」として差し込むため
ALTER TABLE stores ADD COLUMN IF NOT EXISTS postal_code TEXT;
