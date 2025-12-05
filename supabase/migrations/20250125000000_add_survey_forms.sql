-- ==========================================
-- Add survey_forms table
-- ==========================================
CREATE TABLE IF NOT EXISTS survey_forms (
  id TEXT PRIMARY KEY DEFAULT REPLACE(uuid_generate_v4()::TEXT, '-', '')::TEXT,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ('active', 'inactive', 'paused')),
  draft_status TEXT NOT NULL DEFAULT 'none' CHECK (draft_status IN ('none', 'draft', 'ready_to_publish')),
  config JSONB NOT NULL DEFAULT '{}'::JSONB,
  draft_config JSONB,
  static_deploy JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_published_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_survey_forms_store_id ON survey_forms(store_id);
CREATE INDEX IF NOT EXISTS idx_survey_forms_status ON survey_forms(status);
CREATE INDEX IF NOT EXISTS idx_survey_forms_created_at ON survey_forms(created_at DESC);

-- Trigger for updated_at
CREATE TRIGGER update_survey_forms_updated_at BEFORE UPDATE ON survey_forms
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==========================================
-- RLS Settings for survey_forms
-- ==========================================
ALTER TABLE survey_forms ENABLE ROW LEVEL SECURITY;

-- 店舗管理者は自店舗のフォームのみ CRUD 可能
CREATE POLICY "店舗管理者は自店舗のアンケートフォームを閲覧可能" ON survey_forms
  FOR SELECT
  USING (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "店舗管理者は自店舗のアンケートフォームを作成可能" ON survey_forms
  FOR INSERT
  WITH CHECK (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "店舗管理者は自店舗のアンケートフォームを更新可能" ON survey_forms
  FOR UPDATE
  USING (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "店舗管理者は自店舗のアンケートフォームを削除可能" ON survey_forms
  FOR DELETE
  USING (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = auth.uid()
    )
  );

COMMENT ON TABLE survey_forms IS 'アンケートフォーム設定 (店舗ごと)';
