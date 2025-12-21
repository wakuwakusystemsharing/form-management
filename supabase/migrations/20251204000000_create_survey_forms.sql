-- Create survey_forms table
CREATE TABLE IF NOT EXISTS survey_forms (
  id TEXT PRIMARY KEY DEFAULT REPLACE(uuid_generate_v4()::TEXT, '-', '')::TEXT,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ('active', 'inactive', 'paused')),
  draft_status TEXT NOT NULL DEFAULT 'draft' CHECK (draft_status IN ('none', 'draft', 'ready_to_publish')),
  config JSONB NOT NULL DEFAULT '{}'::JSONB,
  draft_config JSONB,
  static_deploy JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_published_at TIMESTAMPTZ
);

-- Create index for store_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_survey_forms_store_id ON survey_forms(store_id);

-- Add trigger to update updated_at timestamp
CREATE TRIGGER update_survey_forms_updated_at
    BEFORE UPDATE ON survey_forms
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
