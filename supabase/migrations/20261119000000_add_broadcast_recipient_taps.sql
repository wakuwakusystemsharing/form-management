-- 配信の成果（配信 → 予約数・売上）: 誰が配信のボタンをタップしたかを宛先ごとに記録する
-- 設計: docs/配信の成果_実装設計.md
--
--   broadcast_recipients.tapped_at … 最初にタップした日時（NULL = タップしていない）
--   broadcast_recipients.tap_count … タップした回数
--   broadcast_record_tap(宛先の行 ID) … 計測リンク /go/…?r={宛先の行 ID} から呼ぶ
--
-- staging / production へは Dashboard の SQL Editor で手動適用。
-- 未適用でも配信・タップ数の集計は従来どおり動く（タップした人の予約が 0 件になるだけ）

ALTER TABLE broadcast_recipients
  ADD COLUMN IF NOT EXISTS tapped_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tap_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN broadcast_recipients.tapped_at IS '配信のボタンを最初にタップした日時（NULL = タップしていない）';
COMMENT ON COLUMN broadcast_recipients.tap_count IS '配信のボタンをタップした回数';

-- 同時アクセスでも取りこぼさないよう 1 文で更新する
CREATE OR REPLACE FUNCTION broadcast_record_tap(p_recipient_id UUID)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE broadcast_recipients
     SET tapped_at = COALESCE(tapped_at, now()),
         tap_count = COALESCE(tap_count, 0) + 1
   WHERE id = p_recipient_id;
$$;

-- API（service_role）からだけ呼ぶ
REVOKE ALL ON FUNCTION broadcast_record_tap(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION broadcast_record_tap(UUID) TO service_role;
