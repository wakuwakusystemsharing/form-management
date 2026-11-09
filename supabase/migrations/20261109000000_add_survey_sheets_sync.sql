-- アンケート回答の Google スプレッドシート自動転記
--   line_display_name: 回答時の公式 LINE の表示名（LIFF の ID トークンから）
--   sheet_synced_at:   スプレッドシートへ転記した日時（NULL = 未転記。「過去の回答を書き出す」の対象）
-- staging / production へは Dashboard の SQL Editor で手動適用

ALTER TABLE surveys
  ADD COLUMN IF NOT EXISTS line_display_name TEXT,
  ADD COLUMN IF NOT EXISTS sheet_synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_surveys_sheet_unsynced
  ON surveys (survey_form_id, submitted_at)
  WHERE sheet_synced_at IS NULL;

COMMENT ON COLUMN surveys.line_display_name IS '回答時の公式 LINE 表示名（LIFF ID トークンの name）';
COMMENT ON COLUMN surveys.sheet_synced_at IS 'Google スプレッドシートへ転記した日時（NULL = 未転記）';
