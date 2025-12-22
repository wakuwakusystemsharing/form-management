-- ==========================================
-- Sync Production with Staging Schema
-- 2025-01-28: staging 環境の構造を production に反映
-- ==========================================

-- ==========================================
-- 1. stores テーブル
-- ==========================================
-- status カラムを削除（staging には存在しない）
ALTER TABLE stores DROP COLUMN IF EXISTS status;

-- ==========================================
-- 2. survey_forms テーブル
-- ==========================================
-- name カラムを追加（staging には存在する）
ALTER TABLE survey_forms 
ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';

-- 既存データがある場合、config から name を設定
UPDATE survey_forms 
SET name = COALESCE(config->'basic_info'->>'title', 'アンケートフォーム')
WHERE name = '' OR name IS NULL;

-- name カラムのデフォルトを削除（NOT NULL 制約を維持）
ALTER TABLE survey_forms 
ALTER COLUMN name DROP DEFAULT;

-- public_url と storage_url カラムを追加（staging には存在する）
ALTER TABLE survey_forms 
ADD COLUMN IF NOT EXISTS public_url TEXT,
ADD COLUMN IF NOT EXISTS storage_url TEXT;

-- status のデフォルト値を 'draft' に変更（staging では 'draft'）
ALTER TABLE survey_forms 
ALTER COLUMN status SET DEFAULT 'draft';

-- status の CHECK 制約を更新（staging では 'active', 'inactive', 'paused' だが、実際は 'draft' がデフォルト）
-- 既存の制約を確認してから更新
DO $$
BEGIN
    -- 既存の制約を削除
    ALTER TABLE survey_forms DROP CONSTRAINT IF EXISTS survey_forms_status_check;
    
    -- 新しい制約を追加（staging の実際の値に合わせる）
    ALTER TABLE survey_forms 
    ADD CONSTRAINT survey_forms_status_check 
    CHECK (status IN ('active', 'inactive', 'paused', 'draft'));
END $$;

-- ==========================================
-- 3. forms テーブル
-- ==========================================
-- name カラムが存在することを確認（staging には存在する）
ALTER TABLE forms 
ADD COLUMN IF NOT EXISTS name TEXT;

-- form_name, line_settings, gas_endpoint, ui_settings カラムを追加（staging には存在する）
ALTER TABLE forms 
ADD COLUMN IF NOT EXISTS form_name TEXT,
ADD COLUMN IF NOT EXISTS line_settings JSONB,
ADD COLUMN IF NOT EXISTS gas_endpoint TEXT,
ADD COLUMN IF NOT EXISTS ui_settings JSONB;

-- ==========================================
-- 4. reservations テーブル
-- ==========================================
-- menu_items と options が JSONB であることを確認（staging では JSONB）
-- 既に存在する場合は何もしない

-- customer_email カラムを追加（staging には存在する）
ALTER TABLE reservations 
ADD COLUMN IF NOT EXISTS customer_email TEXT;

-- ==========================================
-- 5. store_admins テーブル
-- ==========================================
-- role カラムを削除（staging には存在しない）
ALTER TABLE store_admins DROP COLUMN IF EXISTS role;

-- updated_at カラムを削除（staging には存在しない）
ALTER TABLE store_admins DROP COLUMN IF EXISTS updated_at;

-- ==========================================
-- 6. 外部キー制約の確認
-- ==========================================
-- すべての外部キーが uuid 型を参照していることを確認
-- （既存の外部キーはそのまま維持）

-- ==========================================
-- 7. インデックスの確認
-- ==========================================
-- 必要なインデックスは既に存在するはず

COMMENT ON TABLE stores IS '店舗マスタ (staging 構造に同期済み)';
COMMENT ON TABLE forms IS 'フォーム設定 (staging 構造に同期済み)';
COMMENT ON TABLE survey_forms IS 'アンケートフォーム設定 (staging 構造に同期済み)';
COMMENT ON TABLE reservations IS '予約データ (staging 構造に同期済み)';
COMMENT ON TABLE store_admins IS '店舗管理者マッピング (staging 構造に同期済み)';

