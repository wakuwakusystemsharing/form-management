-- LINE メッセージの分岐（ボタンを押したら次のメッセージを返す / 分岐アンケート）
-- - line_flex_messages: テンプレート 'scenario'（分岐アンケート）を追加、分岐の対応表・ノードの送信用メッセージ・トーク表示の設定
-- - line_flex_answers: ボタンが押された記録（集計・顧客詳細の回答履歴）
-- staging / production へは Dashboard の SQL Editor で手動適用

ALTER TABLE line_flex_messages DROP CONSTRAINT IF EXISTS line_flex_messages_template_check;
ALTER TABLE line_flex_messages
  ADD CONSTRAINT line_flex_messages_template_check
  CHECK (template IN (
    'custom',
    'booking_card',
    'menu_carousel',
    'store_card',
    'coupon_card',
    'notice_card',
    'menu_list',
    'staff_carousel',
    'steps_card',
    'scenario'
  ));

ALTER TABLE line_flex_messages ADD COLUMN IF NOT EXISTS branches JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE line_flex_messages ADD COLUMN IF NOT EXISTS branch_payloads JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE line_flex_messages ADD COLUMN IF NOT EXISTS show_choice_text BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN line_flex_messages.branches IS '分岐ボタンのキー → { label, question, tags, next }（保存時に生成）';
COMMENT ON COLUMN line_flex_messages.branch_payloads IS '分岐アンケートの 2 問目以降・結果: ノードのキー → 送信用メッセージ';
COMMENT ON COLUMN line_flex_messages.show_choice_text IS '分岐ボタンを押したとき、お客様のトークに選んだ文言を表示する';

CREATE TABLE IF NOT EXISTS line_flex_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES line_flex_messages(id) ON DELETE CASCADE,
  button_key TEXT NOT NULL,
  question TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL DEFAULT '',
  line_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_line_flex_answers_message ON line_flex_answers(store_id, message_id, created_at);
CREATE INDEX IF NOT EXISTS idx_line_flex_answers_user ON line_flex_answers(store_id, line_user_id, created_at DESC);

-- 書き込みは Webhook（service_role）だけ。管理者は自分の範囲の店舗の記録を読める
ALTER TABLE line_flex_answers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS master_admin_line_flex_answers ON line_flex_answers;
CREATE POLICY master_admin_line_flex_answers ON line_flex_answers FOR SELECT TO public
  USING (is_master_admin());
DROP POLICY IF EXISTS system_admin_line_flex_answers ON line_flex_answers;
CREATE POLICY system_admin_line_flex_answers ON line_flex_answers FOR SELECT TO public
  USING (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()));
DROP POLICY IF EXISTS store_admin_line_flex_answers ON line_flex_answers;
CREATE POLICY store_admin_line_flex_answers ON line_flex_answers FOR SELECT TO public
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));
