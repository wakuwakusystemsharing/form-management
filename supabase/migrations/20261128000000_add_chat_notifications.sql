-- 1 対 1 トーク（④-3: 新着の通知と、保存期間を過ぎた会話の自動削除）
-- 設計: docs/店舗管理者ページ_追加4機能_実装設計.md の 8 章
--
-- 通知は任意（既定は OFF）。未適用でも、受信・トーク画面・返信は今までどおり動く
-- （通知の設定を保存しようとすると「マイグレーションがまだ適用されていません」と出る）。

ALTER TABLE chat_settings ADD COLUMN IF NOT EXISTS notify_line BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE chat_settings ADD COLUMN IF NOT EXISTS notify_email BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE chat_settings ADD COLUMN IF NOT EXISTS notify_emails JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE chat_settings ADD COLUMN IF NOT EXISTS notify_quiet_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE chat_settings ADD COLUMN IF NOT EXISTS notify_quiet_start INTEGER NOT NULL DEFAULT 22 CHECK (notify_quiet_start BETWEEN 0 AND 23);
ALTER TABLE chat_settings ADD COLUMN IF NOT EXISTS notify_quiet_end INTEGER NOT NULL DEFAULT 8 CHECK (notify_quiet_end BETWEEN 0 AND 23);

-- 通知の送りすぎ防止: その会話について「前の通知から p_interval_seconds 秒たっているとき」だけ、通知の日時を書き換えて TRUE を返す。
-- 同時に 2 回呼ばれても、TRUE になるのは 1 回だけ（通知を二重に送らない）。
CREATE OR REPLACE FUNCTION chat_claim_notification(p_store_id TEXT, p_thread_id UUID, p_now TIMESTAMPTZ, p_interval_seconds INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  UPDATE chat_threads
  SET notified_at = p_now
  WHERE id = p_thread_id
    AND store_id = p_store_id
    AND unread_count > 0
    AND (notified_at IS NULL OR notified_at <= p_now - make_interval(secs => p_interval_seconds));
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

REVOKE ALL ON FUNCTION chat_claim_notification(TEXT, UUID, TIMESTAMPTZ, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION chat_claim_notification(TEXT, UUID, TIMESTAMPTZ, INTEGER) TO service_role;

-- 保存期間（chat_settings.retention_years）を過ぎたメッセージを消す。1 回に p_limit 通まで（古い順）。
-- 画像を持つメッセージ（media_path あり）はここでは消さない（画像のファイルを先に消す必要があるため。④-4 で対応する）。
-- メッセージが 1 通も無くなり、最後のメッセージも保存期間より前の会話は、会話ごと消す。
-- 戻り値: { "messages": 消した通数, "threads": 消した会話の数, "remaining": まだ残っているか }
CREATE OR REPLACE FUNCTION chat_purge_expired(p_now TIMESTAMPTZ, p_limit INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_messages INTEGER;
  v_threads INTEGER;
  v_remaining BOOLEAN;
BEGIN
  WITH victims AS (
    SELECT m.id
    FROM chat_messages m
    JOIN chat_settings s ON s.store_id = m.store_id
    WHERE m.created_at < p_now - make_interval(years => s.retention_years)
      AND m.media_path IS NULL
    ORDER BY m.created_at
    LIMIT GREATEST(p_limit, 0)
  )
  DELETE FROM chat_messages WHERE id IN (SELECT id FROM victims);
  GET DIAGNOSTICS v_messages = ROW_COUNT;

  DELETE FROM chat_threads t
  USING chat_settings s
  WHERE s.store_id = t.store_id
    AND t.last_message_at < p_now - make_interval(years => s.retention_years)
    AND NOT EXISTS (SELECT 1 FROM chat_messages m WHERE m.thread_id = t.id);
  GET DIAGNOSTICS v_threads = ROW_COUNT;

  SELECT EXISTS (
    SELECT 1
    FROM chat_messages m
    JOIN chat_settings s ON s.store_id = m.store_id
    WHERE m.created_at < p_now - make_interval(years => s.retention_years)
      AND m.media_path IS NULL
  ) INTO v_remaining;

  RETURN jsonb_build_object('messages', v_messages, 'threads', v_threads, 'remaining', v_remaining);
END;
$$;

REVOKE ALL ON FUNCTION chat_purge_expired(TIMESTAMPTZ, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION chat_purge_expired(TIMESTAMPTZ, INTEGER) TO service_role;
