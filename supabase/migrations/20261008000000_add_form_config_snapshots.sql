-- 予約フォーム設定のスナップショット（元に戻す用）
-- 「更新」や「他のフォームにも反映」でフォームの config を上書きする直前に、上書き前の config 全体を保存する。
-- 編集モーダルの「更新履歴から戻す」/ 反映結果の「元に戻す」で、この行の config を書き戻して再デプロイする。
-- 操作履歴（form_audit_logs）は差分の記録、こちらは復元用の完全な状態、と役割を分ける。
CREATE TABLE IF NOT EXISTS form_config_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id TEXT NOT NULL,
  form_id TEXT NOT NULL,                       -- フォーム削除後は API 側で参照されないだけ。FK は付けない
  form_type TEXT NOT NULL DEFAULT 'reservation' CHECK (form_type IN ('reservation')),
  config JSONB NOT NULL,                       -- 上書き前の config 全体
  reason TEXT NOT NULL,                        -- update / sync / restore（人が読める説明は reason_label）
  reason_label TEXT,                           -- 例: 「LINE予約」から反映 / 更新前 / 復元前
  source_form_id TEXT,                         -- reason = sync のとき反映元のフォーム ID
  actor_user_id UUID,
  actor_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_form_config_snapshots_form ON form_config_snapshots(form_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_form_config_snapshots_store ON form_config_snapshots(store_id, created_at DESC);

-- RLS を有効化し、ポリシーを作らないことで anon / authenticated からの直接アクセスを全拒否。
-- 書き込み・閲覧は service_role（API サーバー。店舗アクセスを authorizeStoreAccess で確認）経由のみ。
ALTER TABLE form_config_snapshots ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE form_config_snapshots IS '予約フォーム config のスナップショット（更新 / 反映 / 復元の直前の状態。元に戻す用。フォームごとに直近 20 件を保持）';
