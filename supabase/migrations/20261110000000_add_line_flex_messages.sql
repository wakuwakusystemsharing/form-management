-- 公式 LINE 向け Flex Message（店舗ページ → 「LINE メッセージ」タブ）
-- 設計: docs/LINE Flexメッセージ_実装設計.md
--
-- テンプレートから作った Flex を保存し、キーワード自動応答（Webhook）/ 予約確認・リマインダー・フォローへの差し込み に使う。
-- payload は送信用の LINE メッセージ（{ type: 'flex', altText, contents }）。保存時にサーバーで生成し、
-- Webhook / Edge Function はこれをそのまま送る（Deno 側でテンプレート処理を持たないため）。
-- staging / production へは Dashboard の SQL Editor で手動適用

CREATE TABLE IF NOT EXISTS line_flex_messages (
  id TEXT PRIMARY KEY,                                   -- 12 文字 [a-z0-9]
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  template TEXT NOT NULL CHECK (template IN ('booking_card', 'menu_carousel', 'store_card', 'custom')),
  data JSONB NOT NULL DEFAULT '{}'::jsonb,               -- テンプレートの入力値
  flex_override JSONB,                                   -- JSON を直接編集したときの contents（NULL = テンプレートから生成）
  alt_text TEXT NOT NULL,
  keywords TEXT[] NOT NULL DEFAULT '{}',                 -- 完全一致で自動応答する言葉
  attach_confirm BOOLEAN NOT NULL DEFAULT false,         -- 【ご予約確認】の返信に添える
  attach_reminder BOOLEAN NOT NULL DEFAULT false,        -- リマインダーに添える
  attach_follow BOOLEAN NOT NULL DEFAULT false,          -- フォローメッセージに添える
  enabled BOOLEAN NOT NULL DEFAULT true,
  track_taps BOOLEAN NOT NULL DEFAULT true,
  payload JSONB,                                         -- 送信用メッセージ
  links JSONB NOT NULL DEFAULT '{}'::jsonb,              -- 計測キー → 本来の URL
  reply_count INTEGER NOT NULL DEFAULT 0,
  tap_counts JSONB NOT NULL DEFAULT '{}'::jsonb,         -- 計測キー → タップ数
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_line_flex_messages_store ON line_flex_messages(store_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_line_flex_messages_keywords ON line_flex_messages USING GIN (keywords) WHERE enabled;

-- RLS: 他の店舗設定と同じ 3 階層（マスター / システム管理者 = 自テナントの店舗 / 店舗管理者 = 自店舗）
ALTER TABLE line_flex_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS master_admin_line_flex_messages ON line_flex_messages;
CREATE POLICY master_admin_line_flex_messages ON line_flex_messages FOR ALL TO public
  USING (is_master_admin()) WITH CHECK (is_master_admin());
DROP POLICY IF EXISTS system_admin_line_flex_messages ON line_flex_messages;
CREATE POLICY system_admin_line_flex_messages ON line_flex_messages FOR ALL TO public
  USING (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()))
  WITH CHECK (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()));
DROP POLICY IF EXISTS store_admin_line_flex_messages ON line_flex_messages;
CREATE POLICY store_admin_line_flex_messages ON line_flex_messages FOR ALL TO public
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));

-- 計測のカウントアップ（同時アクセスでも取りこぼさないよう 1 文で更新）
CREATE OR REPLACE FUNCTION line_flex_increment_tap(p_id TEXT, p_key TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE line_flex_messages
     SET tap_counts = jsonb_set(
           COALESCE(tap_counts, '{}'::jsonb),
           ARRAY[p_key],
           to_jsonb(COALESCE((tap_counts ->> p_key)::integer, 0) + 1),
           true
         ),
         updated_at = updated_at
   WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION line_flex_increment_reply(p_ids TEXT[])
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE line_flex_messages SET reply_count = reply_count + 1 WHERE id = ANY(p_ids);
$$;

COMMENT ON TABLE line_flex_messages IS '公式 LINE 向け Flex Message（テンプレート + キーワード応答 + 自動メッセージへの差し込み）';
