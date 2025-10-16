-- draft_status カラムの値とデフォルト値を更新
-- 'none' | 'draft' | 'ready_to_publish' に対応

ALTER TABLE forms 
DROP CONSTRAINT IF EXISTS forms_draft_status_check;

ALTER TABLE forms 
ALTER COLUMN draft_status SET DEFAULT 'none';

ALTER TABLE forms 
ADD CONSTRAINT forms_draft_status_check 
CHECK (draft_status IN ('none', 'draft', 'ready_to_publish'));

