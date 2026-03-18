-- reservation_forms に draft_config カラムを追加
-- survey_forms との構造的整合性確保（両テーブルに draft_config を持つ）

ALTER TABLE reservation_forms
  ADD COLUMN IF NOT EXISTS draft_config jsonb;
