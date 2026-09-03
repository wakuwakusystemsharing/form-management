-- 店舗ごとの LINE ログインチャネル ID
-- 抽選フォームの ID トークン検証（LINE verify API の client_id）に使う。
-- NULL のときは環境変数 NEXT_PUBLIC_LINE_CHANNEL_ID にフォールバックする。
ALTER TABLE stores ADD COLUMN IF NOT EXISTS line_channel_id TEXT;

COMMENT ON COLUMN stores.line_channel_id IS 'LINE ログインチャネル ID（ID トークン検証用。NULL = 環境変数を使用）';
