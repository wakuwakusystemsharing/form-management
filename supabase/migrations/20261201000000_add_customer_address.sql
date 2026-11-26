-- 顧客の住所（アンケートの「住所入力」の回答を顧客情報に入れるため）
-- 未適用でも既存の機能は動く（住所だけ保存されない。ほかの項目は保存される）
-- staging / production へは Dashboard の SQL Editor で手動適用する

ALTER TABLE customers ADD COLUMN IF NOT EXISTS address TEXT;

COMMENT ON COLUMN customers.address IS '住所（郵便番号を含む 1 つの文字列。アンケートの回答または店舗が入力）';
