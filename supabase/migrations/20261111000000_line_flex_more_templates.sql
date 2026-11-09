-- LINE メッセージ（Flex）のテンプレートを追加: クーポン / お知らせ / 料金表（リスト）/ スタッフ紹介カルーセル / ご利用の流れ
-- template 列の CHECK 制約を差し替える
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
    'steps_card'
  ));
