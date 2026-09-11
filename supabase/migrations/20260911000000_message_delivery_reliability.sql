-- ==========================================
-- リマインダー / フォローメッセージ 送信の信頼性向上
-- 監査: docs/リマインダー・フォローメッセージ_送信動作監査レポート_完全版.md（修正パッケージ A〜C）
--
-- 1. reminder_logs: リマインダーの送信記録（1 予約 × 対象日 = 1 行）。二重送信防止・取り逃し回収・後追い確認
-- 2. stores: リマインダー設定の DB 制約（NOT VALID: 既存データがあっても失敗しない）
-- 3. follow_messages: 送信中状態（sending）・確保時刻・LINE リトライキーを追加
-- 4. DB 関数: フォロー予定の差し替え + 作成を 1 トランザクションで行う / 再予約キャンセル時の復活
--
-- ※ cron ジョブはここでは登録しない（テンプレの URL・鍵がそのまま残る事故を防ぐため）。
--    登録は docs/フォローメッセージ_リリース手順.md の手順どおり Dashboard から手動で行うこと。
-- ==========================================

-- ---------- 1. reminder_logs ----------
CREATE TABLE IF NOT EXISTS reminder_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id        TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  reservation_id  TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  target_date     DATE NOT NULL,                         -- リマインド対象の予約日
  line_user_id    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'sending'
                  CHECK (status IN ('sending', 'sent', 'failed', 'skipped')),
  skip_reason     TEXT,
  attempt_count   INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  claimed_at      TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_reminder_logs_reservation_target ON reminder_logs (reservation_id, target_date);
CREATE INDEX IF NOT EXISTS idx_reminder_logs_store_target ON reminder_logs (store_id, target_date);

DROP TRIGGER IF EXISTS update_reminder_logs_updated_at ON reminder_logs;
CREATE TRIGGER update_reminder_logs_updated_at BEFORE UPDATE ON reminder_logs
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE reminder_logs IS 'LINE 予約リマインダーの送信記録（1 予約 × 対象日 = 1 行。id を X-Line-Retry-Key に使う）';

ALTER TABLE reminder_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS master_admin_reminder_logs ON reminder_logs;
CREATE POLICY master_admin_reminder_logs ON reminder_logs FOR SELECT TO public USING (is_master_admin());
DROP POLICY IF EXISTS system_admin_reminder_logs ON reminder_logs;
CREATE POLICY system_admin_reminder_logs ON reminder_logs FOR SELECT TO public
  USING (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()));
DROP POLICY IF EXISTS store_admin_reminder_logs_select ON reminder_logs;
CREATE POLICY store_admin_reminder_logs_select ON reminder_logs FOR SELECT
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));

-- ---------- 2. stores のリマインダー設定に制約 ----------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stores_reminder_time_check') THEN
    ALTER TABLE stores ADD CONSTRAINT stores_reminder_time_check
      CHECK (reminder_time ~ '^([01][0-9]|2[0-3]):00$') NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stores_reminder_days_before_check') THEN
    ALTER TABLE stores ADD CONSTRAINT stores_reminder_days_before_check
      CHECK (reminder_days_before BETWEEN 1 AND 30) NOT VALID;
  END IF;
END $$;

-- ---------- 3. follow_messages: 送信中状態・確保時刻 ----------
ALTER TABLE follow_messages ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
ALTER TABLE follow_messages DROP CONSTRAINT IF EXISTS follow_messages_status_check;
ALTER TABLE follow_messages ADD CONSTRAINT follow_messages_status_check
  CHECK (status IN ('scheduled', 'sending', 'sent', 'skipped', 'cancelled', 'superseded', 'failed'));
COMMENT ON COLUMN follow_messages.claimed_at IS '送信処理が行を確保した時刻（sending）。10 分以上経過した sending は次回に再確保できる';

-- ---------- 4. DB 関数 ----------
-- 予約成立時: 同じ店舗・同じ LINE ユーザーの未送信行を superseded にし、この予約の行を作成 / 作り直す（1 トランザクション）
CREATE OR REPLACE FUNCTION follow_message_schedule(
  p_store_id TEXT,
  p_reservation_id TEXT,
  p_line_user_id TEXT,
  p_customer_id TEXT,
  p_base_date DATE,
  p_scheduled_at TIMESTAMPTZ
) RETURNS SETOF follow_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing follow_messages%ROWTYPE;
BEGIN
  -- 同じ顧客の行をロックして競合を直列化
  PERFORM 1 FROM follow_messages
    WHERE store_id = p_store_id AND line_user_id = p_line_user_id
    FOR UPDATE;

  UPDATE follow_messages
     SET status = 'superseded', updated_at = NOW()
   WHERE store_id = p_store_id
     AND line_user_id = p_line_user_id
     AND reservation_id <> p_reservation_id
     AND status IN ('scheduled', 'failed');

  SELECT * INTO v_existing FROM follow_messages WHERE reservation_id = p_reservation_id;
  IF FOUND THEN
    IF v_existing.status IN ('sent', 'sending') THEN
      RETURN NEXT v_existing;
      RETURN;
    END IF;
    UPDATE follow_messages
       SET line_user_id = p_line_user_id,
           customer_id = COALESCE(p_customer_id, customer_id),
           base_date = p_base_date,
           scheduled_at = p_scheduled_at,
           status = 'scheduled',
           skip_reason = NULL,
           attempt_count = 0,
           last_error = NULL,
           claimed_at = NULL,
           sent_at = NULL,
           updated_at = NOW()
     WHERE id = v_existing.id;
    RETURN QUERY SELECT * FROM follow_messages WHERE id = v_existing.id;
    RETURN;
  END IF;

  RETURN QUERY
    INSERT INTO follow_messages (store_id, reservation_id, line_user_id, customer_id, base_date, scheduled_at, status)
    VALUES (p_store_id, p_reservation_id, p_line_user_id, p_customer_id, p_base_date, p_scheduled_at, 'scheduled')
    RETURNING *;
END;
$$;

-- 再予約のキャンセル時: 同じ顧客の superseded 行のうち、元の予約が有効で予定が未来のものを 1 件だけ scheduled に戻す
CREATE OR REPLACE FUNCTION follow_message_restore_for_user(
  p_store_id TEXT,
  p_line_user_id TEXT
) RETURNS SETOF follow_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id TEXT;
BEGIN
  PERFORM 1 FROM follow_messages
    WHERE store_id = p_store_id AND line_user_id = p_line_user_id
    FOR UPDATE;

  -- 既に有効な予定があれば何もしない
  IF EXISTS (SELECT 1 FROM follow_messages
              WHERE store_id = p_store_id AND line_user_id = p_line_user_id
                AND status IN ('scheduled', 'sending')) THEN
    RETURN;
  END IF;

  SELECT f.id INTO v_id
    FROM follow_messages f
    JOIN reservations r ON r.id = f.reservation_id
   WHERE f.store_id = p_store_id
     AND f.line_user_id = p_line_user_id
     AND f.status = 'superseded'
     AND r.status <> 'cancelled'
     AND f.scheduled_at > NOW()
   ORDER BY f.base_date DESC, f.updated_at DESC
   LIMIT 1;

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
    UPDATE follow_messages
       SET status = 'scheduled', skip_reason = NULL, updated_at = NOW()
     WHERE id = v_id
    RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION follow_message_schedule(TEXT, TEXT, TEXT, TEXT, DATE, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION follow_message_restore_for_user(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION follow_message_schedule(TEXT, TEXT, TEXT, TEXT, DATE, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION follow_message_restore_for_user(TEXT, TEXT) TO service_role;
