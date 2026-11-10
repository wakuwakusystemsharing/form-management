-- 公式 LINE 配信機能（セグメント配信 / 自動配信）
-- 仕様: docs/LINE配信機能_仕様書.md
--
--   broadcasts                  … 配信（1 回配信 / 自動配信の日ごとの実行）。payloads = 保存時にサーバーで組み立てた送信用メッセージ
--   broadcast_recipients        … 配信ごとの宛先と結果（1 人 1 行。sent の行数 = 消費した通数）
--   broadcast_automations       … 自動配信のルール
--   broadcast_automation_sends  … ルール × 顧客 × きっかけ（marker）の送信記録（二重送信防止）
--   broadcast_stickers          … スタンプ風イラスト（store_id NULL = 全店舗共通の同梱分）
--   stores.broadcast_*          … 月間上限・超過時の扱い・配信停止 / 再開キーワード・自動配信の実行時刻
--   customers.line_opt_out_at   … 配信停止（NULL = 配信する）。予約確認・リマインダー・フォローは対象外
--
-- staging / production へは Dashboard の SQL Editor で手動適用。cron の登録はここに含めない（PR 2 以降で手順書に記載）

CREATE TABLE IF NOT EXISTS broadcast_automations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  trigger JSONB NOT NULL,                                 -- { type: 'dormant', days } など
  audience JSONB NOT NULL DEFAULT '{}'::jsonb,            -- 追加の絞り込み
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  payloads JSONB,
  has_personalization BOOLEAN NOT NULL DEFAULT false,
  resend_after_days INTEGER CHECK (resend_after_days IS NULL OR resend_after_days >= 1),
  last_run_date DATE,                                     -- 最後に判定した日（JST。1 日 1 回の実行に使う）
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_broadcast_automations_store ON broadcast_automations(store_id);

CREATE TABLE IF NOT EXISTS broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'cancelled', 'failed')),
  audience JSONB NOT NULL DEFAULT '{}'::jsonb,            -- 配信先の条件
  items JSONB NOT NULL DEFAULT '[]'::jsonb,               -- メッセージの並び（編集用）
  payloads JSONB,                                         -- 送信用メッセージ（最大 5 通）
  has_personalization BOOLEAN NOT NULL DEFAULT false,     -- {name} あり = 1 人ずつ push
  track_taps BOOLEAN NOT NULL DEFAULT true,
  links JSONB NOT NULL DEFAULT '{}'::jsonb,               -- 計測キー → 本来の URL
  tap_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  scheduled_at TIMESTAMPTZ,
  claimed_at TIMESTAMPTZ,                                 -- 送信処理が確保した時刻（止まったら再確保）
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  automation_id UUID REFERENCES broadcast_automations(id) ON DELETE SET NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_broadcasts_store ON broadcasts(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_broadcasts_due ON broadcasts(scheduled_at) WHERE status IN ('scheduled', 'sending');

CREATE TABLE IF NOT EXISTS broadcast_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id UUID NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,   -- 月間通数の集計と RLS 用
  customer_id TEXT NOT NULL,                              -- customers.id（顧客を削除しても履歴は残す）
  line_user_id TEXT NOT NULL,
  display_name TEXT,                                      -- {name} の差し込みに使う名前（確定時）
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (broadcast_id, customer_id)
);
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_pending ON broadcast_recipients(broadcast_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_month ON broadcast_recipients(store_id, sent_at) WHERE status = 'sent';

CREATE TABLE IF NOT EXISTS broadcast_automation_sends (
  automation_id UUID NOT NULL REFERENCES broadcast_automations(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL,
  marker TEXT NOT NULL,                                   -- dormant:2026-08-12 / birthday:2026 / first_visit / visits:5 / tag:◯◯
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (automation_id, customer_id, marker)
);

CREATE TABLE IF NOT EXISTS broadcast_stickers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id TEXT REFERENCES stores(id) ON DELETE CASCADE,  -- NULL = 全店舗共通
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  preview_url TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_broadcast_stickers_store ON broadcast_stickers(store_id, sort);

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS broadcast_monthly_limit INTEGER CHECK (broadcast_monthly_limit IS NULL OR broadcast_monthly_limit >= 0),
  ADD COLUMN IF NOT EXISTS broadcast_over_limit TEXT NOT NULL DEFAULT 'confirm' CHECK (broadcast_over_limit IN ('confirm', 'block')),
  ADD COLUMN IF NOT EXISTS broadcast_opt_out_keyword TEXT NOT NULL DEFAULT '配信停止',
  ADD COLUMN IF NOT EXISTS broadcast_opt_in_keyword TEXT NOT NULL DEFAULT '配信再開',
  ADD COLUMN IF NOT EXISTS broadcast_automation_time TEXT NOT NULL DEFAULT '10:00' CHECK (broadcast_automation_time ~ '^([01][0-9]|2[0-3]):00$');

ALTER TABLE customers ADD COLUMN IF NOT EXISTS line_opt_out_at TIMESTAMPTZ;

-- RLS: 他の店舗設定と同じ 3 階層（マスター / システム管理者 = 自テナントの店舗 / 店舗管理者 = 自店舗）
ALTER TABLE broadcasts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS master_admin_broadcasts ON broadcasts;
CREATE POLICY master_admin_broadcasts ON broadcasts FOR ALL TO public
  USING (is_master_admin()) WITH CHECK (is_master_admin());
DROP POLICY IF EXISTS system_admin_broadcasts ON broadcasts;
CREATE POLICY system_admin_broadcasts ON broadcasts FOR ALL TO public
  USING (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()))
  WITH CHECK (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()));
DROP POLICY IF EXISTS store_admin_broadcasts ON broadcasts;
CREATE POLICY store_admin_broadcasts ON broadcasts FOR ALL TO public
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));

ALTER TABLE broadcast_recipients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS master_admin_broadcast_recipients ON broadcast_recipients;
CREATE POLICY master_admin_broadcast_recipients ON broadcast_recipients FOR ALL TO public
  USING (is_master_admin()) WITH CHECK (is_master_admin());
DROP POLICY IF EXISTS system_admin_broadcast_recipients ON broadcast_recipients;
CREATE POLICY system_admin_broadcast_recipients ON broadcast_recipients FOR ALL TO public
  USING (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()))
  WITH CHECK (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()));
DROP POLICY IF EXISTS store_admin_broadcast_recipients ON broadcast_recipients;
CREATE POLICY store_admin_broadcast_recipients ON broadcast_recipients FOR ALL TO public
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));

ALTER TABLE broadcast_automations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS master_admin_broadcast_automations ON broadcast_automations;
CREATE POLICY master_admin_broadcast_automations ON broadcast_automations FOR ALL TO public
  USING (is_master_admin()) WITH CHECK (is_master_admin());
DROP POLICY IF EXISTS system_admin_broadcast_automations ON broadcast_automations;
CREATE POLICY system_admin_broadcast_automations ON broadcast_automations FOR ALL TO public
  USING (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()))
  WITH CHECK (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()));
DROP POLICY IF EXISTS store_admin_broadcast_automations ON broadcast_automations;
CREATE POLICY store_admin_broadcast_automations ON broadcast_automations FOR ALL TO public
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));

-- スタンプ: 共通分（store_id NULL）はログイン済みなら読める。店舗分は 3 階層
ALTER TABLE broadcast_stickers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS read_common_broadcast_stickers ON broadcast_stickers;
CREATE POLICY read_common_broadcast_stickers ON broadcast_stickers FOR SELECT TO authenticated
  USING (store_id IS NULL);
DROP POLICY IF EXISTS master_admin_broadcast_stickers ON broadcast_stickers;
CREATE POLICY master_admin_broadcast_stickers ON broadcast_stickers FOR ALL TO public
  USING (is_master_admin()) WITH CHECK (is_master_admin());
DROP POLICY IF EXISTS system_admin_broadcast_stickers ON broadcast_stickers;
CREATE POLICY system_admin_broadcast_stickers ON broadcast_stickers FOR ALL TO public
  USING (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()))
  WITH CHECK (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()));
DROP POLICY IF EXISTS store_admin_broadcast_stickers ON broadcast_stickers;
CREATE POLICY store_admin_broadcast_stickers ON broadcast_stickers FOR ALL TO public
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));

-- 自動配信の送信記録は service_role だけが読み書きする（ポリシー無し）
ALTER TABLE broadcast_automation_sends ENABLE ROW LEVEL SECURITY;

-- 計測のカウントアップ（同時アクセスでも取りこぼさないよう 1 文で更新）
CREATE OR REPLACE FUNCTION broadcast_increment_tap(p_id UUID, p_key TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE broadcasts
     SET tap_counts = jsonb_set(
           COALESCE(tap_counts, '{}'::jsonb),
           ARRAY[p_key],
           to_jsonb(COALESCE((tap_counts ->> p_key)::integer, 0) + 1),
           true
         )
   WHERE id = p_id;
$$;

COMMENT ON TABLE broadcasts IS '公式 LINE の配信（セグメント配信 / 自動配信の実行）';
COMMENT ON TABLE broadcast_recipients IS '配信ごとの宛先と結果（sent の行数 = 消費した通数）';
COMMENT ON TABLE broadcast_automations IS '自動配信（ステップ配信）のルール';
COMMENT ON COLUMN customers.line_opt_out_at IS '配信停止した日時（NULL = 配信する）。予約確認・リマインダー・フォローは対象外';
