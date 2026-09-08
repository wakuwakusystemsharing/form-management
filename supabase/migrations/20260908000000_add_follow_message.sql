-- ==========================================
-- フォローメッセージ機能
-- 設計: docs/フォローメッセージ機能_実装設計.md
--
-- stores: フォロー設定（reminder_* とは別の follow_* 接頭辞。既存のリマインダー機能には触れない）
-- follow_messages: 配信予定キュー（予約成立時に 1 行作成 → Edge Function send-follow-messages が消化）
-- ==========================================

ALTER TABLE stores ADD COLUMN IF NOT EXISTS follow_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS follow_base TEXT NOT NULL DEFAULT 'reservation_date';
ALTER TABLE stores ADD COLUMN IF NOT EXISTS follow_days_after INTEGER NOT NULL DEFAULT 7;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS follow_time TEXT NOT NULL DEFAULT '12:00';
ALTER TABLE stores ADD COLUMN IF NOT EXISTS follow_template JSONB;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stores_follow_base_check') THEN
    ALTER TABLE stores ADD CONSTRAINT stores_follow_base_check CHECK (follow_base IN ('reservation_date', 'created_at'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stores_follow_days_after_check') THEN
    ALTER TABLE stores ADD CONSTRAINT stores_follow_days_after_check CHECK (follow_days_after BETWEEN 1 AND 60);
  END IF;
END $$;

COMMENT ON COLUMN stores.follow_enabled IS 'LINE フォローメッセージの有効/無効（既定 OFF）';
COMMENT ON COLUMN stores.follow_base IS 'フォローの基準日: reservation_date（予約日）/ created_at（予約受付日）';
COMMENT ON COLUMN stores.follow_days_after IS '基準日から何日後に送るか（1〜60）';
COMMENT ON COLUMN stores.follow_time IS '送信時刻（HH:00、JST）';
COMMENT ON COLUMN stores.follow_template IS 'フォロー文面（reminder_template と同じ JSON 形式。NULL = デフォルト文面）';

CREATE TABLE IF NOT EXISTS follow_messages (
  id              TEXT PRIMARY KEY DEFAULT REPLACE(uuid_generate_v4()::TEXT, '-', ''),
  store_id        TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  reservation_id  TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  line_user_id    TEXT NOT NULL,
  customer_id     TEXT,
  base_date       DATE NOT NULL,
  scheduled_at    TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'scheduled'
                  CHECK (status IN ('scheduled', 'sent', 'skipped', 'cancelled', 'superseded', 'failed')),
  skip_reason     TEXT,
  attempt_count   INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_follow_messages_due ON follow_messages (scheduled_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_follow_messages_store_user ON follow_messages (store_id, line_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_follow_messages_reservation ON follow_messages (reservation_id);

DROP TRIGGER IF EXISTS update_follow_messages_updated_at ON follow_messages;
CREATE TRIGGER update_follow_messages_updated_at BEFORE UPDATE ON follow_messages
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE follow_messages IS 'LINE フォローメッセージの配信予定・結果（1 予約 1 行）';

-- RLS: 管理者は自店舗分を閲覧のみ。作成・更新は Service Role（API ルート / Edge Function）が行う
ALTER TABLE follow_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS master_admin_follow_messages ON follow_messages;
CREATE POLICY master_admin_follow_messages ON follow_messages FOR SELECT TO public
  USING (is_master_admin());

DROP POLICY IF EXISTS system_admin_follow_messages ON follow_messages;
CREATE POLICY system_admin_follow_messages ON follow_messages FOR SELECT TO public
  USING (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()));

DROP POLICY IF EXISTS store_admin_follow_messages_select ON follow_messages;
CREATE POLICY store_admin_follow_messages_select ON follow_messages FOR SELECT
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));

-- ==========================================
-- pg_cron ジョブ（テンプレート）
-- 実運用では Dashboard の SQL Editor から Service Role Key を指定して cron.schedule() を実行すること。
-- 既存の send_reservation_reminders（毎時 0 分）とは別名・別時刻（毎時 5 分）で登録し、リマインダー側には影響させない。
-- ==========================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'send_follow_messages',
      '5 * * * *',
      $cmd$
        SELECT net.http_post(
          url := 'https://tpuqjpdaasxfwsvjcbum.supabase.co/functions/v1/send-follow-messages',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
          )
        );
      $cmd$
    );
  END IF;
END $$;
