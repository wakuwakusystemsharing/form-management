-- 「友だち登録だけの人」を顧客台帳に入れる（配信タブで送れるようにするため）
--
--   customers.line_friend_only = true … 予約もアンケートもしていない LINE 友だちを、LINE の表示名で自動登録した行
--     （友だち追加時・公式 LINE に何か送ってきたとき・「友だちを取り込む」ボタン）。予約すると false に戻す。
--   顧客一覧・顧客分析・全店舗ランキングでは既定で除外し、配信先の判定には含める。
--
-- staging / production へは Dashboard の SQL Editor で手動適用（コードより先に適用すること）

ALTER TABLE customers ADD COLUMN IF NOT EXISTS line_friend_only BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_customers_friend_only ON customers(store_id) WHERE line_friend_only;

COMMENT ON COLUMN customers.line_friend_only IS '予約なしの LINE 友だちとして自動登録した顧客（顧客一覧では既定で除外。予約すると false）';
