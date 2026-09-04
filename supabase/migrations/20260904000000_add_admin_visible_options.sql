-- 店舗管理者に表示するメニューの「項目単位」の表示設定
-- admin_visible_tabs（タブの ON/OFF）に加えて、タブ内の項目を個別に表示 / 非表示にする。
-- JSONB。キーが無い（未設定）項目は親タブの表示状態に連動する（src/lib/store-admin-tabs.ts の resolveAdminVisibleOptions）。
--   reservation_forms            : 予約管理タブの「フォーム管理」（既定: 予約管理タブに連動）
--   survey_forms                 : アンケート管理タブの「フォーム管理」（既定: アンケート管理タブに連動）
--   lottery_forms                : 抽選管理タブの「フォーム管理」（既定: 抽選管理タブに連動）
--   customer_reservation_history : 顧客詳細の「予約履歴・来店履歴・統計情報」（既定: 予約管理タブに連動）
--   customer_lottery_history     : 顧客詳細の「抽選履歴」（既定: 抽選管理タブに連動）
ALTER TABLE stores ADD COLUMN IF NOT EXISTS admin_visible_options JSONB;

COMMENT ON COLUMN stores.admin_visible_options IS '店舗管理者に表示する項目の個別設定（JSONB。未設定キーは親タブに連動）';
