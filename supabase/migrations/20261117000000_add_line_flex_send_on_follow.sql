-- LINE メッセージ: あいさつメッセージ（友だち追加されたときに送る）
-- - line_flex_messages.send_on_follow: ON のメッセージを、友だち追加（ブロック解除を含む）の Webhook で返信する
-- staging / production へは Dashboard の SQL Editor で手動適用
-- （未適用の環境でも、この設定を使っていないメッセージは列なしで保存できる）

ALTER TABLE line_flex_messages ADD COLUMN IF NOT EXISTS send_on_follow BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN line_flex_messages.send_on_follow IS 'あいさつメッセージ: 友だち追加（ブロック解除を含む）されたときに送る';
