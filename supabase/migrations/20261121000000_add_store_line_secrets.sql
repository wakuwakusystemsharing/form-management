-- LINE Webhook の署名チェック用: 店舗ごとのチャネルシークレット
-- 設計: docs/店舗管理者ページ_追加4機能_実装設計.md の 4 章
--
-- stores の列にせず別テーブルにする（stores は店舗管理者も読めるため。シークレットは画面・API に出さない）。
-- API（service_role）からだけ読み書きする（RLS を有効にし、ポリシーは作らない）。
-- 行が無い店舗 = 署名を確認しない（今までどおり動く）。このテーブルが未適用でも既存の Webhook は動く。

CREATE TABLE IF NOT EXISTS store_line_secrets (
  store_id TEXT PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  channel_secret TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE store_line_secrets ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE store_line_secrets IS 'LINE チャネルシークレット（Webhook の署名チェック用）。service_role のみ';
