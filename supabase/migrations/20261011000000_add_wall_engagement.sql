-- 寄せ書きウォール: 追加機能（docs/寄せ書きウォール_追加機能提案.md の案 1・2・3・6・7・8）
--   案 1 お店からの「ありがとう」リアクション … wall_posts.reaction / reaction_at
--   案 2 「共感」ボタン                       … wall_empathies（押した人は hash のみ）/ wall_posts.empathy_count / wall_boards.empathy_*
--   案 3 お題（テーマ）                        … wall_topics / wall_posts.topic_id
--   案 6 貼る人が付箋の色・飾りを選ぶ          … wall_posts.note_color / note_deco / wall_boards.customer_pick_enabled
--   案 7・8 は既存データの集計 / 端末内保存のみ（テーブル追加なし）
-- 匿名性: 新しいテーブルも投稿者・共感した人は hash だけ。wall_empathies はポリシー無し（service_role のみ）

-- ------------------------------------------------------------
-- 1. ボード設定
-- ------------------------------------------------------------
ALTER TABLE wall_boards
  ADD COLUMN IF NOT EXISTS empathy_enabled BOOLEAN NOT NULL DEFAULT false,      -- 「共感」ボタンを出す
  ADD COLUMN IF NOT EXISTS empathy_show_count BOOLEAN NOT NULL DEFAULT true,    -- 共感の数をお客様に見せる
  ADD COLUMN IF NOT EXISTS customer_pick_enabled BOOLEAN NOT NULL DEFAULT false; -- 貼る人が付箋の色・飾りを選べる

-- ------------------------------------------------------------
-- 2. お題
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wall_topics (
  id TEXT PRIMARY KEY,                               -- 12 文字ランダム
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 40),
  description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 120),
  starts_on DATE NOT NULL,                           -- JST の日付
  ends_on DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on)
);
CREATE INDEX IF NOT EXISTS idx_wall_topics_store ON wall_topics(store_id, starts_on DESC);

-- ------------------------------------------------------------
-- 3. 付箋の追加列
-- ------------------------------------------------------------
ALTER TABLE wall_posts
  ADD COLUMN IF NOT EXISTS reaction TEXT CHECK (reaction IS NULL OR reaction IN ('thanks', 'heart', 'smile', 'party')),
  ADD COLUMN IF NOT EXISTS reaction_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS topic_id TEXT REFERENCES wall_topics(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS note_color TEXT CHECK (note_color IS NULL OR note_color ~ '^#[0-9a-f]{6}$'),
  ADD COLUMN IF NOT EXISTS note_deco TEXT CHECK (note_deco IS NULL OR char_length(note_deco) <= 4),
  ADD COLUMN IF NOT EXISTS empathy_count INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_wall_posts_topic ON wall_posts(store_id, topic_id);

-- ------------------------------------------------------------
-- 4. 共感（押した人は hash のみ。1 人 1 付箋 1 回）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wall_empathies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id TEXT NOT NULL,
  post_id TEXT NOT NULL REFERENCES wall_posts(id) ON DELETE CASCADE,
  empathizer_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (post_id, empathizer_hash)
);

-- ------------------------------------------------------------
-- 5. RLS（wall_topics は wall_boards と同じ 3 階層。wall_empathies はポリシー無し）
-- ------------------------------------------------------------
ALTER TABLE wall_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE wall_empathies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS master_admin_wall_topics ON wall_topics;
CREATE POLICY master_admin_wall_topics ON wall_topics FOR ALL TO public
  USING (is_master_admin()) WITH CHECK (is_master_admin());
DROP POLICY IF EXISTS system_admin_wall_topics ON wall_topics;
CREATE POLICY system_admin_wall_topics ON wall_topics FOR ALL TO public
  USING (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()))
  WITH CHECK (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()));
DROP POLICY IF EXISTS store_admin_wall_topics ON wall_topics;
CREATE POLICY store_admin_wall_topics ON wall_topics FOR ALL
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));

-- ------------------------------------------------------------
-- 6. 投稿関数を差し替え（お題・色・飾りも保存する）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wall_insert_post_checked(
  p_store_id TEXT,
  p_author_hash TEXT,
  p_day_start TIMESTAMPTZ,
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

  INSERT INTO wall_posts (id, store_id, body, status, pending_reason, ng_hits, author_hash, topic_id, note_color, note_deco, created_at, updated_at)
  VALUES (
    p_post->>'id',
    p_store_id,
    p_post->>'body',
    p_post->>'status',
    p_post->>'pending_reason',
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_post->'ng_hits')), '{}'),
    p_author_hash,
    NULLIF(p_post->>'topic_id', ''),
    NULLIF(p_post->>'note_color', ''),
    NULLIF(p_post->>'note_deco', ''),
    NOW(), NOW()
  )
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('ok', true, 'post', to_jsonb(v_row));
END;
$$;

-- ------------------------------------------------------------
-- 7. 共感の切り替え（押す / 取り消す を 1 トランザクションで。公開中の付箋のみ）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wall_toggle_empathy(
  p_store_id TEXT,
  p_post_id TEXT,
  p_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_post wall_posts;
  v_deleted INTEGER;
  v_empathized BOOLEAN;
BEGIN
  SELECT * INTO v_post FROM wall_posts WHERE id = p_post_id AND store_id = p_store_id FOR UPDATE;
  IF NOT FOUND OR v_post.status <> 'published' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  DELETE FROM wall_empathies WHERE post_id = p_post_id AND empathizer_hash = p_hash;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted > 0 THEN
    v_empathized := false;
  ELSE
    INSERT INTO wall_empathies (store_id, post_id, empathizer_hash) VALUES (p_store_id, p_post_id, p_hash);
    v_empathized := true;
  END IF;

  UPDATE wall_posts
     SET empathy_count = (SELECT COUNT(*) FROM wall_empathies WHERE post_id = p_post_id),
         updated_at = NOW()
   WHERE id = p_post_id
  RETURNING * INTO v_post;
  RETURN jsonb_build_object('ok', true, 'empathized', v_empathized, 'count', v_post.empathy_count);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.wall_toggle_empathy(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.wall_toggle_empathy(TEXT, TEXT, TEXT) FROM anon, authenticated;

COMMENT ON TABLE wall_topics IS '寄せ書きウォールのお題（店舗ごと。期間で 1 つだけ有効）';
COMMENT ON TABLE wall_empathies IS '寄せ書きウォールの共感（押した人は hash のみ。service_role のみ）';
