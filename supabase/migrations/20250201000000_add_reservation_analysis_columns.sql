-- ==========================================
-- Add Analysis Columns to Reservations Table
-- 2025-02-01: 予約データの分析・集計対応のためJSONBカラムを追加
-- ==========================================

-- ==========================================
-- reservations テーブルに分析用カラムを追加
-- ==========================================

-- selected_menus: 選択されたメニュー情報の配列（JSONB）
-- メニューID、名前、カテゴリー、価格、サブメニュー情報などを構造化して保存
ALTER TABLE reservations 
ADD COLUMN IF NOT EXISTS selected_menus JSONB DEFAULT '[]'::JSONB;

-- selected_options: 選択されたオプション情報の配列（JSONB）
-- オプションID、名前、メニューIDなどを構造化して保存
ALTER TABLE reservations 
ADD COLUMN IF NOT EXISTS selected_options JSONB DEFAULT '[]'::JSONB;

-- customer_info: 顧客属性情報（JSONB）
-- 性別、来店回数、クーポン使用などの属性を保存
ALTER TABLE reservations 
ADD COLUMN IF NOT EXISTS customer_info JSONB DEFAULT '{}'::JSONB;

-- インデックスを追加（JSONBクエリのパフォーマンス向上）
-- selected_menus内のmenu_idで検索する場合のインデックス
CREATE INDEX IF NOT EXISTS idx_reservations_selected_menus_gin 
ON reservations USING GIN (selected_menus);

-- selected_options内のoption_idで検索する場合のインデックス
CREATE INDEX IF NOT EXISTS idx_reservations_selected_options_gin 
ON reservations USING GIN (selected_options);

-- customer_info内の属性で検索する場合のインデックス
CREATE INDEX IF NOT EXISTS idx_reservations_customer_info_gin 
ON reservations USING GIN (customer_info);

-- コメントを更新
COMMENT ON COLUMN reservations.selected_menus IS '選択されたメニュー情報の配列（JSONB）。メニューID、名前、カテゴリー、価格、サブメニュー情報を含む';
COMMENT ON COLUMN reservations.selected_options IS '選択されたオプション情報の配列（JSONB）。オプションID、名前、メニューIDを含む';
COMMENT ON COLUMN reservations.customer_info IS '顧客属性情報（JSONB）。性別、来店回数、クーポン使用などの属性を含む';

COMMENT ON TABLE reservations IS '予約データ (分析・集計対応版)';

