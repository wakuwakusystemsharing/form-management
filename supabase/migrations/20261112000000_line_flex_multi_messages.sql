-- LINE メッセージ（Flex）に「追加のメッセージ」（テキスト / 画像 / 動画 / Flex JSON / 保存済みメッセージ）を付けてまとめて送る
--   message_items … 編集画面で並べた順番（main = Flex 本体 を含む。最大 5 通）
--   payloads      … その順に組み立てた送信用メッセージの配列。Webhook / Edge Function はこれをそのまま送る（NULL = [payload]）
-- staging / production へは Dashboard の SQL Editor で手動適用。適用後に Edge Function send-reminders / send-follow-messages を再デプロイ

ALTER TABLE line_flex_messages
  ADD COLUMN IF NOT EXISTS message_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS payloads JSONB;

COMMENT ON COLUMN line_flex_messages.message_items IS 'まとめて送るメッセージの並び（main / text / image / video / flex / ref。最大 5）';
COMMENT ON COLUMN line_flex_messages.payloads IS '送信用メッセージの配列（message_items の順。NULL なら payload 1 通）';
