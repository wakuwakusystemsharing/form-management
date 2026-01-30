-- ==========================================
-- Add LINE User ID to Reservations and Surveys Tables
-- 2025-02-03: LINEユーザーIDを取得してデータベースに保存するため
-- ==========================================

-- ==========================================
-- reservations テーブルに line_user_id カラムを追加
-- ==========================================
ALTER TABLE reservations 
ADD COLUMN IF NOT EXISTS line_user_id TEXT;

-- インデックスを追加（LINEユーザーIDでの検索を高速化）
CREATE INDEX IF NOT EXISTS idx_reservations_line_user_id 
ON reservations(line_user_id) 
WHERE line_user_id IS NOT NULL;

-- コメントを追加
COMMENT ON COLUMN reservations.line_user_id IS 'LINEユーザーID（LIFFから取得）';

-- ==========================================
-- surveys テーブルに line_user_id カラムを追加
-- ==========================================
ALTER TABLE surveys 
ADD COLUMN IF NOT EXISTS line_user_id TEXT;

-- インデックスを追加（LINEユーザーIDでの検索を高速化）
CREATE INDEX IF NOT EXISTS idx_surveys_line_user_id 
ON surveys(line_user_id) 
WHERE line_user_id IS NOT NULL;

-- コメントを追加
COMMENT ON COLUMN surveys.line_user_id IS 'LINEユーザーID（LIFFから取得）';

