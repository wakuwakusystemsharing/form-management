-- 1 対 1 トーク（④-1: 受信と保存）
-- 設計: docs/店舗管理者ページ_追加4機能_実装設計.md の 8 章
--
-- お客様が公式 LINE に送ったメッセージを、トーク機能を ON にした店舗だけ保存する。
-- 既定は OFF（chat_settings に行が無い店舗 = OFF）。ON / OFF は運営だけが API から変える。
-- 3 つの表とも API（service_role）からだけ読み書きする（RLS を有効にし、ポリシーは作らない）。
-- 未適用でも既存の機能（Webhook の応答など）は今までどおり動く。

-- 店舗ごとの設定
CREATE TABLE IF NOT EXISTS chat_settings (
  store_id TEXT PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  retention_years INTEGER NOT NULL DEFAULT 1 CHECK (retention_years IN (1, 2, 3)),
  enabled_at TIMESTAMPTZ,
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- お客様 1 人との会話 1 本（店舗 × LINE ユーザー）
CREATE TABLE IF NOT EXISTS chat_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  line_user_id TEXT NOT NULL,
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_preview TEXT,
  unread_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chat_threads_store_user_unique UNIQUE (store_id, line_user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_threads_store_last ON chat_threads (store_id, last_message_at DESC);

-- メッセージ 1 通
CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  thread_id UUID NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out', 'system')),
  kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'image', 'sticker', 'video', 'audio', 'file', 'location', 'other')),
  text TEXT,
  meta JSONB,
  media_path TEXT,
  auto BOOLEAN NOT NULL DEFAULT FALSE,
  auto_kind TEXT,
  line_message_id TEXT,
  client_key TEXT,
  send_status TEXT CHECK (send_status IS NULL OR send_status IN ('sending', 'sent', 'failed')),
  send_error TEXT,
  sent_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_created ON chat_messages (thread_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_store_created ON chat_messages (store_id, created_at);
-- 同じ通知が 2 回届いても 1 件（LINE は応答が遅いと送り直す）
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_messages_line_message ON chat_messages (store_id, line_message_id) WHERE line_message_id IS NOT NULL;
-- 返信の二重送信の防止（④-2 で使う）
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_messages_client_key ON chat_messages (store_id, client_key) WHERE client_key IS NOT NULL;

ALTER TABLE chat_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- お客様から届いた 1 通を保存する（会話が無ければ作る）。
-- 戻り値: TRUE = 保存した / FALSE = 同じメッセージを保存済み（何もしていない）
-- 未読の加算・一覧の 1 行の更新まで、1 回の呼び出しで行う（同時に届いても数がずれない）。
CREATE OR REPLACE FUNCTION chat_record_inbound(
  p_store_id TEXT,
  p_line_user_id TEXT,
  p_line_message_id TEXT,
  p_kind TEXT,
  p_text TEXT,
  p_meta JSONB,
  p_auto_kind TEXT,
  p_follow_up_candidate BOOLEAN,
  p_preview TEXT,
  p_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_thread UUID;
  v_auto TEXT := p_auto_kind;
  v_prev_kind TEXT;
  v_prev_at TIMESTAMPTZ;
  v_rows INTEGER;
BEGIN
  INSERT INTO chat_threads (store_id, line_user_id, customer_id, last_message_at)
  VALUES (
    p_store_id,
    p_line_user_id,
    (SELECT c.id FROM customers c WHERE c.store_id = p_store_id AND c.line_user_id = p_line_user_id ORDER BY c.created_at LIMIT 1),
    p_at
  )
  ON CONFLICT (store_id, line_user_id) DO UPDATE
    SET customer_id = COALESCE(chat_threads.customer_id, EXCLUDED.customer_id)
  RETURNING id INTO v_thread;

  -- フォームの送信文のすぐあと（3 秒以内）に届いた文は、フォームが続けて送った文（2 通目・追加メッセージ）
  IF v_auto IS NULL AND p_follow_up_candidate THEN
    SELECT m.auto_kind, m.created_at INTO v_prev_kind, v_prev_at
    FROM chat_messages m
    WHERE m.thread_id = v_thread AND m.direction = 'in'
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 1;
    IF v_prev_kind IN ('form', 'follow_up') AND ABS(EXTRACT(EPOCH FROM (p_at - v_prev_at))) <= 3 THEN
      v_auto := 'follow_up';
    END IF;
  END IF;

  INSERT INTO chat_messages (thread_id, store_id, direction, kind, text, meta, auto, auto_kind, line_message_id, created_at)
  VALUES (v_thread, p_store_id, 'in', p_kind, p_text, p_meta, v_auto IS NOT NULL, v_auto, p_line_message_id, p_at)
  ON CONFLICT (store_id, line_message_id) WHERE line_message_id IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN FALSE;
  END IF;

  UPDATE chat_threads t SET
    unread_count = t.unread_count + CASE WHEN v_auto IS NULL THEN 1 ELSE 0 END,
    status = CASE WHEN v_auto IS NULL THEN 'open' ELSE t.status END,
    last_message_preview = CASE WHEN p_at >= t.last_message_at OR t.last_message_preview IS NULL THEN p_preview ELSE t.last_message_preview END,
    last_message_at = GREATEST(t.last_message_at, p_at),
    updated_at = NOW()
  WHERE t.id = v_thread;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION chat_record_inbound(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, BOOLEAN, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION chat_record_inbound(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, BOOLEAN, TEXT, TIMESTAMPTZ) TO service_role;

COMMENT ON TABLE chat_settings IS '1 対 1 トークの店舗ごとの設定（行なし = OFF）。service_role のみ';
COMMENT ON TABLE chat_threads IS '1 対 1 トークの会話（店舗 × LINE ユーザーで 1 本）。service_role のみ';
COMMENT ON TABLE chat_messages IS '1 対 1 トークのメッセージ。service_role のみ';
