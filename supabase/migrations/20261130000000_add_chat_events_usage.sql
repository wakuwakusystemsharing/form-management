-- 1 対 1 トーク（④-5: 自動で送ったメッセージを会話に出す・利用量の記録）
-- 設計: docs/店舗管理者ページ_追加4機能_実装設計.md の 8 章
--
-- 未適用でも、受信・トーク画面・返信・通知・画像・リマインダー・フォロー・配信は今までどおり動く
-- （自動で送ったメッセージが会話に出ない・利用量が数えられない だけ）。

-- 店舗ごと・月ごとの利用量（有料オプションの料金を決める・請求するときの材料）。
-- month は日本時間の YYYY-MM。API（service_role）からだけ読み書きする（RLS を有効にし、ポリシーは作らない）。
CREATE TABLE IF NOT EXISTS chat_usage_monthly (
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  month TEXT NOT NULL CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  inbound_count INTEGER NOT NULL DEFAULT 0,
  outbound_count INTEGER NOT NULL DEFAULT 0,
  image_bytes BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (store_id, month)
);

ALTER TABLE chat_usage_monthly ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE chat_usage_monthly IS '1 対 1 トークの店舗ごと・月ごとの利用量（受信数・返信数・保存した画像の容量）。service_role のみ';

-- 利用量を足す（同時に届いても数がずれないように、DB 側で足す）
CREATE OR REPLACE FUNCTION chat_add_usage(p_store_id TEXT, p_month TEXT, p_inbound INTEGER, p_outbound INTEGER, p_image_bytes BIGINT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO chat_usage_monthly (store_id, month, inbound_count, outbound_count, image_bytes)
  VALUES (p_store_id, p_month, GREATEST(p_inbound, 0), GREATEST(p_outbound, 0), GREATEST(p_image_bytes, 0))
  ON CONFLICT (store_id, month) DO UPDATE SET
    inbound_count = chat_usage_monthly.inbound_count + GREATEST(p_inbound, 0),
    outbound_count = chat_usage_monthly.outbound_count + GREATEST(p_outbound, 0),
    image_bytes = chat_usage_monthly.image_bytes + GREATEST(p_image_bytes, 0),
    updated_at = NOW();
$$;

REVOKE ALL ON FUNCTION chat_add_usage(TEXT, TEXT, INTEGER, INTEGER, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION chat_add_usage(TEXT, TEXT, INTEGER, INTEGER, BIGINT) TO service_role;

-- 自動で送ったメッセージ（リマインダー・フォロー・配信・自動応答・空き待ちのお知らせ）を、会話に 1 行で残す。
-- p_events = [{ "line_user_id", "kind", "text", "source_key", "at" }]（配信は 500 人ぶんを 1 回で渡す）
-- - トーク機能が ON の店舗だけ
-- - **すでに会話のあるお客様だけ**（会話の無いお客様の会話は作らない）
-- - 同じ送信（source_key）は 1 回だけ（chat_messages の (store_id, client_key) の一意制約で捨てる）
-- - 未読・一覧の 1 行・並び順は変えない
-- 戻り値: 記録した件数
CREATE OR REPLACE FUNCTION chat_record_system_events(p_store_id TEXT, p_events JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  IF p_events IS NULL OR jsonb_typeof(p_events) <> 'array' THEN
    RETURN 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM chat_settings s WHERE s.store_id = p_store_id AND s.enabled) THEN
    RETURN 0;
  END IF;

  INSERT INTO chat_messages (thread_id, store_id, direction, kind, text, meta, auto, auto_kind, client_key, created_at)
  SELECT
    t.id,
    p_store_id,
    'system',
    'text',
    LEFT(e->>'text', 300),
    jsonb_build_object('event', COALESCE(e->>'kind', '')),
    TRUE,
    'system',
    e->>'source_key',
    COALESCE(NULLIF(e->>'at', '')::TIMESTAMPTZ, NOW())
  FROM jsonb_array_elements(p_events) AS e
  JOIN chat_threads t ON t.store_id = p_store_id AND t.line_user_id = e->>'line_user_id'
  WHERE COALESCE(e->>'text', '') <> '' AND COALESCE(e->>'source_key', '') <> ''
  ON CONFLICT (store_id, client_key) WHERE client_key IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION chat_record_system_events(TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION chat_record_system_events(TEXT, JSONB) TO service_role;

-- お客様から届いた 1 通を保存する（④-1 の関数に、利用量の加算を足したもの。ほかは同じ）。
-- 自動の文（フォームの送信文・コマンドなど）は、利用量に数えない。
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

  -- 利用量: お客様が手で書いた文・画像などだけを数える（日本時間の月）
  IF v_auto IS NULL THEN
    PERFORM chat_add_usage(p_store_id, TO_CHAR(p_at AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM'), 1, 0, 0);
  END IF;

  RETURN TRUE;
END;
$$;
