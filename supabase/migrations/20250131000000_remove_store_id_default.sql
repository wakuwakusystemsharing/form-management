-- ==========================================
-- Remove default UUID from stores.id
-- 店舗IDのデフォルト値（UUID）を削除
-- アプリケーション側で6文字のランダムIDを必ず指定するため
-- ==========================================

-- stores.id のデフォルト値を削除
ALTER TABLE stores 
ALTER COLUMN id DROP DEFAULT;

-- コメントを更新
COMMENT ON COLUMN stores.id IS '店舗ID: 6文字のランダム文字列（アプリケーション側で必ず指定）';



