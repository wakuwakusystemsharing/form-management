-- リッチメニューの「お客様ごとの切り替え」: このシステムが LINE に設定した人の記録
-- 設計: docs/店舗管理者ページ_追加4機能_実装設計.md の 7 章（3 本目）
--
-- 条件に合うお客様にだけ出すメニューは、LINE に「この人にはこのメニュー」と 1 人ずつ設定する。
-- 条件に合わなくなった人の設定を外すために、だれに設定したかを記録しておく
-- （タブ切り替えで LINE が自動で付けた設定は、ここには入らない = このシステムは外さない）。
--
-- line_rich_menu_links は API（service_role）からだけ読み書きする（RLS を有効にし、ポリシーは作らない）。
-- このマイグレーションが未適用でも、既存の機能（全員向けのメニュー・タブ切り替え）は今までどおり動く
-- （お客様ごとのメニューを出そうとすると「マイグレーションがまだ適用されていません」と出る）。
-- 条件は、20261125000000_add_line_rich_menus.sql で作った line_rich_menus.rule に入れる。

CREATE TABLE IF NOT EXISTS line_rich_menu_links (
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  line_user_id TEXT NOT NULL,                           -- LINE ユーザー ID
  menu_id UUID NOT NULL REFERENCES line_rich_menus(id) ON DELETE CASCADE,
  line_rich_menu_id TEXT NOT NULL,                      -- 設定した LINE 側のメニューの ID（作り直すと変わる）
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (store_id, line_user_id)                  -- 1 人に設定できるメニューは 1 つ
);

CREATE INDEX IF NOT EXISTS idx_line_rich_menu_links_menu ON line_rich_menu_links (menu_id);

ALTER TABLE line_rich_menu_links ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE line_rich_menu_links IS 'リッチメニューのお客様ごとの切り替え: このシステムが LINE に設定した人の記録。service_role のみ';
