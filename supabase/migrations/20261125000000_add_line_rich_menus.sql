-- 公式 LINE のリッチメニュー（トーク画面の下に出るメニュー）を管理画面で作って反映する
-- 設計: docs/店舗管理者ページ_追加4機能_実装設計.md の 7 章
--
-- line_rich_menus は API（service_role）からだけ読み書きする（RLS を有効にし、ポリシーは作らない）。
-- このマイグレーションが未適用でも、既存の機能は今までどおり動く
-- （リッチメニューの一覧が空になり、作成すると「マイグレーションがまだ適用されていません」と出る）。

CREATE TABLE IF NOT EXISTS line_rich_menus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                                   -- 管理用の名前（40 文字まで。お客様には見えない）
  size TEXT NOT NULL DEFAULT 'large',                   -- large = 2500×1686 / small = 2500×843
  image_url TEXT NOT NULL DEFAULT '',                   -- アップロードした画像（LINE の決まりの大きさに切り抜いた JPEG）
  areas JSONB NOT NULL DEFAULT '[]'::jsonb,             -- ボタンの範囲（画像全体に対する割合）と動き
  chat_bar_text TEXT NOT NULL DEFAULT 'メニュー',        -- メニューを開くバーの文言（14 文字まで）
  open_by_default BOOLEAN NOT NULL DEFAULT TRUE,        -- トーク画面を開いたとき、最初からメニューを開いておくか
  status TEXT NOT NULL DEFAULT 'draft',                 -- draft / publishing / published / failed
  line_rich_menu_id TEXT,                               -- LINE 側の ID（反映したとき）
  is_default BOOLEAN NOT NULL DEFAULT FALSE,            -- 全員向けにしているか
  dirty BOOLEAN NOT NULL DEFAULT FALSE,                 -- 反映したあとに内容を変えたか
  rule JSONB,                                           -- お客様ごとの切り替え条件（今後の機能用。いまは使わない）
  last_error TEXT,                                      -- 反映に失敗したときの理由
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT line_rich_menus_size_check CHECK (size IN ('large', 'small')),
  CONSTRAINT line_rich_menus_status_check CHECK (status IN ('draft', 'publishing', 'published', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_line_rich_menus_store ON line_rich_menus (store_id, created_at);

-- 全員向けのメニューは 1 店舗に 1 つだけ（反映の処理が重なっても 2 つにならないように）
CREATE UNIQUE INDEX IF NOT EXISTS uniq_line_rich_menus_default ON line_rich_menus (store_id) WHERE is_default;

ALTER TABLE line_rich_menus ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE line_rich_menus IS '公式 LINE のリッチメニュー（管理画面で作って反映する）。service_role のみ';
