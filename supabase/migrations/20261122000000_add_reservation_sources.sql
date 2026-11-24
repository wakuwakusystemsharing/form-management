-- 流入経路の計測（店頭ポップ・チラシ・Instagram など、置き場所ごとの URL / QR コード）
-- 設計: docs/店舗管理者ページ_追加4機能_実装設計.md の 5 章
--
-- reservation_sources は API（service_role）からだけ読み書きする（RLS を有効にし、ポリシーは作らない）。
-- このマイグレーションが未適用でも、予約の受付は今までどおり動く（経路が記録されないだけ）。
-- 既存の reservations.source_medium（開いた元サイトからの自動推測）はそのまま残す。

CREATE TABLE IF NOT EXISTS reservation_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  form_id TEXT NOT NULL,                              -- 開く予約フォーム（フォームを消しても経路と集計は残すので外部キーにしない）
  name TEXT NOT NULL,                                 -- 経路の名前（店頭ポップ / Instagram など。40 文字まで）
  code TEXT NOT NULL,                                 -- 合言葉（英小文字と数字 8 文字。URL は /s/{code}）
  active BOOLEAN NOT NULL DEFAULT TRUE,               -- false = 停止（URL は通常のフォームを開き、経路は記録しない）
  click_count INTEGER NOT NULL DEFAULT 0,             -- URL が開かれた回数（目安）
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_reservation_source_code UNIQUE (code),
  CONSTRAINT reservation_source_code_format CHECK (code ~ '^[a-z0-9]{8}$')
);

CREATE INDEX IF NOT EXISTS idx_reservation_sources_store ON reservation_sources (store_id, created_at);

ALTER TABLE reservation_sources ENABLE ROW LEVEL SECURITY;

-- 予約にひも付く経路（合言葉）。経路なしは NULL
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS source_code TEXT;

CREATE INDEX IF NOT EXISTS idx_reservations_store_source_code ON reservations (store_id, source_code) WHERE source_code IS NOT NULL;

-- 「読まれた数」を 1 増やす（同時に開かれても数がずれないように DB 側で足す）
CREATE OR REPLACE FUNCTION reservation_source_increment_click(p_code TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE reservation_sources SET click_count = click_count + 1 WHERE code = p_code;
$$;

REVOKE ALL ON FUNCTION reservation_source_increment_click(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reservation_source_increment_click(TEXT) TO service_role;

COMMENT ON TABLE reservation_sources IS '流入経路（置き場所ごとの URL / QR コード）。service_role のみ';
COMMENT ON COLUMN reservations.source_code IS '流入経路の合言葉（reservation_sources.code）。経路なしは NULL';
