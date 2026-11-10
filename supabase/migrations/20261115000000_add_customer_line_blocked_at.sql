-- 配信タブ: 「友だちなのに配信先から外れる」問題の修正
--
-- これまで配信先の判定は customers.line_friend_flag = false の人を「友だちでない」として外していたが、
-- このフラグは「友だち追加が予約より先だった」「予約フォームで友だち状態を取得できなかった」だけでも false のままになる。
-- そこで、友だち解除（ブロック）の通知が来た日時を別の列に記録し、配信先からはこの列がある人だけを外す。
--   line_blocked_at … LINE Webhook の unfollow で入れ、follow / 公式 LINE への発言で消す。送信前の友だち確認（LINE のプロフィール取得）でも更新する
--
-- staging / production へは Dashboard の SQL Editor で手動適用（コードより先に適用すること）

ALTER TABLE customers ADD COLUMN IF NOT EXISTS line_blocked_at TIMESTAMPTZ;

COMMENT ON COLUMN customers.line_blocked_at IS 'ブロック（友だち解除）された日時。NULL = ブロックされていない / 不明。配信タブはこの列がある人だけを配信先から外す';
