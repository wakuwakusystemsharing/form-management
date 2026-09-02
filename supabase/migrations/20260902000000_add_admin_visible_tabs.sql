-- 店舗管理者ページ（/{storeId}/admin）で店舗管理者に表示するタブ
-- NULL / 未設定 = すべて表示（後方互換）。値は JSON 配列:
-- ["dashboard", "reservations", "customers", "surveys", "settings"] のうち表示するもの
-- マスター管理者・システム管理者には常にすべて表示される（アプリ側で制御）
ALTER TABLE stores ADD COLUMN IF NOT EXISTS admin_visible_tabs JSONB;
