-- 朝の「今日の予約まとめ」・月次レポート（店舗スタッフへメール / LINE で自動送信）
-- 設計: docs/朝のまとめ・月次レポート_実装設計.md
-- 3 つのテーブルは API（service_role）からだけ読み書きする（RLS のポリシーは作らない）
-- cron の登録はこのマイグレーションに含めない（Dashboard から手動登録。docs/朝のまとめ・月次レポート_リリース手順.md）

-- 店舗ごとの設定（行が無い = すべて OFF）
CREATE TABLE IF NOT EXISTS store_digest_settings (
  store_id TEXT PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,        -- { morning: { enabled, time }, monthly: { enabled }, channels: { email, line }, emails: [] }
  staff_code TEXT,                                    -- スタッフ登録の合言葉（4 桁。NULL = 無効）
  code_failures INTEGER NOT NULL DEFAULT 0,           -- 合言葉を続けて間違えた回数（5 回で合言葉を無効にする）
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- LINE で受け取るスタッフ（公式 LINE に「スタッフ登録 合言葉」と送った人）
CREATE TABLE IF NOT EXISTS store_digest_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  line_user_id TEXT NOT NULL,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_store_digest_staff UNIQUE (store_id, line_user_id)
);

-- 送信の記録（店舗 × 種類 × 対象日 / 対象月 = 1 行。送る前に行を確保して二重送信を防ぐ）
CREATE TABLE IF NOT EXISTS store_digest_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('morning', 'monthly')),
  target_key TEXT NOT NULL,                           -- morning = YYYY-MM-DD / monthly = YYYY-MM
  status TEXT NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'skipped', 'failed')),
  email_sent INTEGER NOT NULL DEFAULT 0,
  line_sent INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_store_digest_log UNIQUE (store_id, kind, target_key)
);

CREATE INDEX IF NOT EXISTS idx_store_digest_logs_store_created
  ON store_digest_logs (store_id, created_at DESC);

ALTER TABLE store_digest_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_digest_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_digest_logs ENABLE ROW LEVEL SECURITY;
