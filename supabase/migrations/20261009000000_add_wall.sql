-- 寄せ書きウォール（匿名の付箋コルクボード）
-- 設計: docs/寄せ書きウォール_要件定義書.md
--
-- 匿名性のため、付箋・通報・同意・操作記録は RLS を有効にしてポリシーを作らない（service_role = API サーバー経由のみ）。
-- 店舗管理者・システム管理者が Supabase を直接読んでも投稿者ハッシュが見えないようにする。
-- ボード設定（wall_boards）だけは他の店舗設定と同じ 3 階層ポリシー。

-- ------------------------------------------------------------
-- 1. ボード設定（1 店舗 1 行）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wall_boards (
  store_id TEXT PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  liff_id TEXT,                                      -- LINE Developers で作成した LIFF アプリ（Endpoint = /wall/{storeId}）
  moderation TEXT NOT NULL DEFAULT 'instant' CHECK (moderation IN ('instant', 'approval')),
  access_mode TEXT NOT NULL DEFAULT 'login' CHECK (access_mode IN ('login', 'friend_to_post', 'friend_only')),
  theme JSONB NOT NULL DEFAULT '{}'::jsonb,          -- 世界観（プリセット・付箋色・フォント・見出し）。欠損は API 側で既定値に補完
  ng_words TEXT[] NOT NULL DEFAULT '{}',             -- 店舗ごとの追加 NG ワード
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 2. 付箋
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wall_posts (
  id TEXT PRIMARY KEY,                               -- 12 文字ランダム
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 140),
  status TEXT NOT NULL CHECK (status IN ('published', 'pending', 'review', 'hidden', 'deleted')),
  pending_reason TEXT CHECK (pending_reason IS NULL OR pending_reason IN ('approval', 'ng_word')),
  ng_hits TEXT[] NOT NULL DEFAULT '{}',              -- 当たった NG ワード（店舗の判断用）
  author_hash TEXT NOT NULL,                         -- HMAC(store_id:line_user_id)。API レスポンスには出さない
  report_count INTEGER NOT NULL DEFAULT 0,           -- 最後に店舗が公開してからの通報数（3 で review）
  hidden_reason TEXT CHECK (hidden_reason IS NULL OR hidden_reason = 'terms_violation'),
  hidden_at TIMESTAMPTZ,
  hidden_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wall_posts_store_status ON wall_posts(store_id, status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_wall_posts_store_author ON wall_posts(store_id, author_hash, created_at DESC);

-- ------------------------------------------------------------
-- 3. 通報（同じ人は同じ付箋を 1 回だけ）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wall_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id TEXT NOT NULL,
  post_id TEXT NOT NULL REFERENCES wall_posts(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('abuse', 'personal_info', 'advertising', 'other')),
  reporter_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (post_id, reporter_hash)
);
CREATE INDEX IF NOT EXISTS idx_wall_reports_post ON wall_reports(post_id);

-- ------------------------------------------------------------
-- 4. 投稿の同意（同意日時・規約バージョン）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wall_consents (
  store_id TEXT NOT NULL,
  author_hash TEXT NOT NULL,
  terms_version TEXT NOT NULL,
  agreed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, author_hash, terms_version)
);

-- ------------------------------------------------------------
-- 5. 店舗の公開 / 非公開操作の記録
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wall_moderation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('publish', 'hide')),
  reason TEXT CHECK (reason IS NULL OR reason = 'terms_violation'),
  actor_user_id UUID,
  actor_email TEXT,
  actor_role TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wall_moderation_logs_store ON wall_moderation_logs(store_id, created_at DESC);

-- ------------------------------------------------------------
-- 6. RLS
-- ------------------------------------------------------------
ALTER TABLE wall_boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE wall_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE wall_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE wall_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE wall_moderation_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS master_admin_wall_boards ON wall_boards;
CREATE POLICY master_admin_wall_boards ON wall_boards FOR ALL TO public
  USING (is_master_admin()) WITH CHECK (is_master_admin());
DROP POLICY IF EXISTS system_admin_wall_boards ON wall_boards;
CREATE POLICY system_admin_wall_boards ON wall_boards FOR ALL TO public
  USING (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()))
  WITH CHECK (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()));
DROP POLICY IF EXISTS store_admin_wall_boards_select ON wall_boards;
CREATE POLICY store_admin_wall_boards_select ON wall_boards FOR SELECT
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS store_admin_wall_boards_update ON wall_boards;
CREATE POLICY store_admin_wall_boards_update ON wall_boards FOR UPDATE
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));
-- wall_posts / wall_reports / wall_consents / wall_moderation_logs: ポリシー無し（service_role のみ）

-- ------------------------------------------------------------
-- 7. 投稿（1 日 N 件 / 前回から M 秒の判定と挿入を 1 トランザクションで）
--    同じ店舗のボード行をロックして直列化する（同時に 2 件貼られても上限を超えない）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wall_insert_post_checked(
  p_store_id TEXT,
  p_author_hash TEXT,
  p_day_start TIMESTAMPTZ,       -- JST の今日 0:00（UTC）
  p_daily_max INTEGER,
  p_min_interval_sec INTEGER,
  p_post JSONB
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_today INTEGER;
  v_last TIMESTAMPTZ;
  v_row wall_posts;
BEGIN
  PERFORM 1 FROM wall_boards WHERE store_id = p_store_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'board_missing');
  END IF;

  SELECT COUNT(*) INTO v_today
    FROM wall_posts
   WHERE store_id = p_store_id AND author_hash = p_author_hash AND created_at >= p_day_start;
  IF v_today >= p_daily_max THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'daily');
  END IF;

  SELECT MAX(created_at) INTO v_last
    FROM wall_posts
   WHERE store_id = p_store_id AND author_hash = p_author_hash;
  IF v_last IS NOT NULL AND v_last > NOW() - make_interval(secs => p_min_interval_sec) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'interval',
      'retry_after', CEIL(EXTRACT(EPOCH FROM (v_last + make_interval(secs => p_min_interval_sec) - NOW()))));
  END IF;

  INSERT INTO wall_posts (id, store_id, body, status, pending_reason, ng_hits, author_hash, created_at, updated_at)
  VALUES (
    p_post->>'id',
    p_store_id,
    p_post->>'body',
    p_post->>'status',
    p_post->>'pending_reason',
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_post->'ng_hits')), '{}'),
    p_author_hash,
    NOW(), NOW()
  )
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('ok', true, 'post', to_jsonb(v_row));
END;
$$;

-- ------------------------------------------------------------
-- 8. 通報（重複は無視、件数を数えて閾値で review にする）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wall_add_report(
  p_store_id TEXT,
  p_post_id TEXT,
  p_reporter_hash TEXT,
  p_reason TEXT,
  p_threshold INTEGER
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_post wall_posts;
  v_inserted INTEGER;
BEGIN
  SELECT * INTO v_post FROM wall_posts WHERE id = p_post_id AND store_id = p_store_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  INSERT INTO wall_reports (store_id, post_id, reason, reporter_hash)
  VALUES (p_store_id, p_post_id, p_reason, p_reporter_hash)
  ON CONFLICT (post_id, reporter_hash) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 0 THEN
    RETURN jsonb_build_object('ok', true, 'duplicated', true, 'status', v_post.status, 'report_count', v_post.report_count);
  END IF;

  UPDATE wall_posts
     SET report_count = report_count + 1,
         status = CASE WHEN status = 'published' AND report_count + 1 >= p_threshold THEN 'review' ELSE status END,
         updated_at = NOW()
   WHERE id = p_post_id
  RETURNING * INTO v_post;
  RETURN jsonb_build_object('ok', true, 'duplicated', false, 'status', v_post.status, 'report_count', v_post.report_count);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.wall_insert_post_checked(TEXT, TEXT, TIMESTAMPTZ, INTEGER, INTEGER, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.wall_insert_post_checked(TEXT, TEXT, TIMESTAMPTZ, INTEGER, INTEGER, JSONB) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.wall_add_report(TEXT, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.wall_add_report(TEXT, TEXT, TEXT, TEXT, INTEGER) FROM anon, authenticated;

COMMENT ON TABLE wall_boards IS '寄せ書きウォールのボード設定（1 店舗 1 行）';
COMMENT ON TABLE wall_posts IS '寄せ書きウォールの付箋（匿名。author_hash は API に出さない。service_role のみ）';
COMMENT ON TABLE wall_reports IS '寄せ書きウォールの通報（service_role のみ）';
COMMENT ON TABLE wall_consents IS '寄せ書きウォールの投稿同意（同意日時・規約バージョン。service_role のみ）';
COMMENT ON TABLE wall_moderation_logs IS '寄せ書きウォールの公開 / 非公開操作の記録（service_role のみ）';
