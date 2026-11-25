-- 1 対 1 トーク（④-4: 画像の受信と返信・定型文・対応済みの切り替え）
-- 設計: docs/店舗管理者ページ_追加4機能_実装設計.md の 8 章
--
-- 未適用でも、受信（文字）・トーク画面・返信・通知は今までどおり動く。
-- 未適用のあいだは、定型文を保存しようとすると「マイグレーションがまだ適用されていません」と出る。

-- 定型文（店舗ごと。[{ id, title, text }]。30 個まで）
ALTER TABLE chat_settings ADD COLUMN IF NOT EXISTS reply_templates JSONB NOT NULL DEFAULT '[]'::jsonb;

-- お客様から届いた画像の保存先。**公開しない**（public = false。ポリシーも作らない = service_role だけが読み書きできる）。
-- 画面からは、ログインと店舗の確認をする API（/api/stores/{storeId}/chat/media/{messageId}）を通して読む。
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('chat-media', 'chat-media', FALSE, 10485760)
ON CONFLICT (id) DO NOTHING;
