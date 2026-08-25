-- フォーム操作履歴（監査ログ）
-- 予約フォーム / アンケートフォームに対する 作成・更新・保存＆デプロイ・複製・削除 を
-- 「いつ・誰が（メール/ロール）・どこから・何を変えたか」で記録する。
-- テナント管理画面の「履歴」ボタンから閲覧（システム管理者 / マスター管理者のみ）。
CREATE TABLE IF NOT EXISTS form_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id TEXT NOT NULL,
  form_id TEXT NOT NULL,                       -- フォーム削除後も履歴を残すため FK は付けない
  form_type TEXT NOT NULL CHECK (form_type IN ('reservation', 'survey')),
  action TEXT NOT NULL,                        -- create / update / deploy / duplicate / delete
  form_name TEXT,
  actor_user_id UUID,
  actor_email TEXT,
  actor_role TEXT,                             -- master / system / store / unknown
  source TEXT,                                 -- tenant_admin / master_admin / store_admin / unknown
  summary TEXT,                                -- 人が読める変更概要（例: メニュー構成、営業時間・ルール を変更）
  changes JSONB,                               -- 変更したセクションごとの before / after
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_form_audit_logs_form ON form_audit_logs(form_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_form_audit_logs_store ON form_audit_logs(store_id, created_at DESC);

-- RLS を有効化し、ポリシーを作らないことで anon / authenticated からの直接アクセスを全拒否。
-- 書き込み・閲覧は service_role（API サーバー）経由のみ。
ALTER TABLE form_audit_logs ENABLE ROW LEVEL SECURITY;
