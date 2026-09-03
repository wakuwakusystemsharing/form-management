-- ==========================================================================
-- 抽選フォーム（lottery_forms）と抽選履歴（lottery_entries）
-- 設計書: docs/抽選フォーム_実装設計.md
-- ==========================================================================

-- ------------------------------------------------------------
-- 1. lottery_forms（survey_forms と同じ骨格 + 後日抽選の進行状態）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lottery_forms (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ('active', 'inactive', 'paused')),
  draft_status TEXT NOT NULL DEFAULT 'none' CHECK (draft_status IN ('none', 'draft', 'ready_to_publish')),
  config JSONB NOT NULL DEFAULT '{}'::JSONB,
  draft_config JSONB,
  static_deploy JSONB,
  last_published_at TIMESTAMPTZ,
  -- 後日抽選のみ使用: accepting（応募受付）→ closed（締切）→ drawn（仮当選）→ notified（確定・通知済み）
  deferred_draw_status TEXT NOT NULL DEFAULT 'accepting'
    CHECK (deferred_draw_status IN ('accepting', 'closed', 'drawn', 'notified')),
  deferred_drawn_at TIMESTAMPTZ,
  deferred_notified_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lottery_forms_store_id ON lottery_forms(store_id);
CREATE INDEX IF NOT EXISTS idx_lottery_forms_created_at ON lottery_forms(created_at DESC);

DROP TRIGGER IF EXISTS update_lottery_forms_updated_at ON lottery_forms;
CREATE TRIGGER update_lottery_forms_updated_at BEFORE UPDATE ON lottery_forms
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE lottery_forms IS '抽選フォーム設定 (店舗ごと)。config は LotteryConfig (JSONB)';
COMMENT ON COLUMN lottery_forms.deferred_draw_status IS '後日抽選の進行状態 (accepting / closed / drawn / notified)';

-- ------------------------------------------------------------
-- 2. lottery_entries（1 行 = 1 回の抽選 / 1 口の応募）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lottery_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lottery_form_id TEXT NOT NULL REFERENCES lottery_forms(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  line_user_id TEXT NOT NULL,
  line_display_name TEXT,
  line_friend_flag BOOLEAN,
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,  -- customers.id は TEXT
  prize_id TEXT,                                -- NULL = はずれ / 未抽選
  prize_name TEXT,                              -- 当時の賞品名のスナップショット
  is_win BOOLEAN NOT NULL DEFAULT false,
  is_consolation BOOLEAN NOT NULL DEFAULT false,
  redeem_code TEXT,                             -- 6 桁 [A-Z2-9]。店舗内ユニーク
  qr_token TEXT,                                -- QR 方式のみ: 32 文字ランダム
  expires_at TIMESTAMPTZ,
  -- entered（応募）/ provisional（仮当選）/ drawn（当選）/ lost（はずれ・落選）/ redeemed（引換済み）/ cancelled（取り消し）
  status TEXT NOT NULL DEFAULT 'drawn'
    CHECK (status IN ('entered', 'provisional', 'drawn', 'lost', 'redeemed', 'cancelled')),
  redeemed_at TIMESTAMPTZ,
  redeemed_by UUID,
  redeemed_note TEXT,
  answers JSONB,                                -- 事前質問の回答
  message_sent BOOLEAN NOT NULL DEFAULT false,  -- LIFF sendMessages 完了
  push_sent BOOLEAN NOT NULL DEFAULT false,     -- Bot Flex push 完了
  user_agent TEXT,
  entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lottery_entries_form_user
  ON lottery_entries(lottery_form_id, line_user_id, entered_at DESC);
CREATE INDEX IF NOT EXISTS idx_lottery_entries_store_entered
  ON lottery_entries(store_id, entered_at DESC);
CREATE INDEX IF NOT EXISTS idx_lottery_entries_form_prize
  ON lottery_entries(lottery_form_id, prize_id) WHERE prize_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_lottery_entries_store_redeem_code
  ON lottery_entries(store_id, redeem_code) WHERE redeem_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_lottery_entries_qr_token
  ON lottery_entries(qr_token) WHERE qr_token IS NOT NULL;

DROP TRIGGER IF EXISTS update_lottery_entries_updated_at ON lottery_entries;
CREATE TRIGGER update_lottery_entries_updated_at BEFORE UPDATE ON lottery_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE lottery_entries IS '抽選履歴。1 行 = 1 回の抽選または 1 口の応募';
COMMENT ON COLUMN lottery_entries.status IS 'entered / provisional / drawn / lost / redeemed / cancelled';

-- ------------------------------------------------------------
-- 3. 抽選の原子性を守る関数
--    API サーバー（service_role）だけが呼ぶ。フォーム行をロックして
--    「参加回数の上限」と「賞品の在庫」を再確認してから INSERT する。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lottery_insert_entry_checked(
  p_form_id TEXT,
  p_line_user_id TEXT,
  p_prize_id TEXT,
  p_prize_stock INTEGER,          -- NULL = 無制限
  p_window_start TIMESTAMPTZ,     -- NULL = 全期間
  p_max_entries INTEGER,          -- NULL = 制限なし
  p_entry JSONB
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_user_count INTEGER;
  v_prize_count INTEGER;
  v_row lottery_entries;
BEGIN
  PERFORM 1 FROM lottery_forms WHERE id = p_form_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF p_max_entries IS NOT NULL THEN
    SELECT COUNT(*) INTO v_user_count
      FROM lottery_entries
     WHERE lottery_form_id = p_form_id
       AND line_user_id = p_line_user_id
       AND status <> 'cancelled'
       AND (p_window_start IS NULL OR entered_at >= p_window_start);
    IF v_user_count >= p_max_entries THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'limit');
    END IF;
  END IF;

  IF p_prize_id IS NOT NULL AND p_prize_stock IS NOT NULL THEN
    SELECT COUNT(*) INTO v_prize_count
      FROM lottery_entries
     WHERE lottery_form_id = p_form_id
       AND prize_id = p_prize_id
       AND status <> 'cancelled';
    IF v_prize_count >= p_prize_stock THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'sold_out');
    END IF;
  END IF;

  INSERT INTO lottery_entries (
    id, lottery_form_id, store_id, line_user_id, line_display_name, line_friend_flag, customer_id,
    prize_id, prize_name, is_win, is_consolation, redeem_code, qr_token, expires_at, status,
    answers, message_sent, push_sent, user_agent, entered_at, created_at, updated_at
  ) VALUES (
    COALESCE((p_entry->>'id')::UUID, gen_random_uuid()),
    p_form_id,
    p_entry->>'store_id',
    p_line_user_id,
    p_entry->>'line_display_name',
    (p_entry->>'line_friend_flag')::BOOLEAN,
    p_entry->>'customer_id',
    p_prize_id,
    p_entry->>'prize_name',
    COALESCE((p_entry->>'is_win')::BOOLEAN, false),
    COALESCE((p_entry->>'is_consolation')::BOOLEAN, false),
    p_entry->>'redeem_code',
    p_entry->>'qr_token',
    (p_entry->>'expires_at')::TIMESTAMPTZ,
    COALESCE(p_entry->>'status', 'drawn'),
    CASE WHEN p_entry ? 'answers' THEN p_entry->'answers' ELSE NULL END,
    false,
    false,
    p_entry->>'user_agent',
    COALESCE((p_entry->>'entered_at')::TIMESTAMPTZ, NOW()),
    NOW(),
    NOW()
  )
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'entry', to_jsonb(v_row));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.lottery_insert_entry_checked(TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, INTEGER, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.lottery_insert_entry_checked(TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, INTEGER, JSONB) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lottery_insert_entry_checked(TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, INTEGER, JSONB) TO service_role;

-- ------------------------------------------------------------
-- 4. RLS（survey_forms / surveys と同じ構成）
--    公開 API（抽選実行・結果取得）は service_role 経由なのでポリシー不要。
-- ------------------------------------------------------------
ALTER TABLE lottery_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE lottery_entries ENABLE ROW LEVEL SECURITY;

-- マスター管理者: 全件
DROP POLICY IF EXISTS master_admin_lottery_forms ON lottery_forms;
CREATE POLICY master_admin_lottery_forms ON lottery_forms FOR ALL TO public
  USING (is_master_admin())
  WITH CHECK (is_master_admin());
DROP POLICY IF EXISTS master_admin_lottery_entries ON lottery_entries;
CREATE POLICY master_admin_lottery_entries ON lottery_entries FOR ALL TO public
  USING (is_master_admin())
  WITH CHECK (is_master_admin());

-- システム管理者: 同テナントの店舗のみ
DROP POLICY IF EXISTS system_admin_lottery_forms ON lottery_forms;
CREATE POLICY system_admin_lottery_forms ON lottery_forms FOR ALL TO public
  USING (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()))
  WITH CHECK (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()));
DROP POLICY IF EXISTS system_admin_lottery_entries ON lottery_entries;
CREATE POLICY system_admin_lottery_entries ON lottery_entries FOR ALL TO public
  USING (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()))
  WITH CHECK (is_system_admin() AND store_id IN (SELECT system_admin_store_ids()));

-- 店舗管理者: 自店舗のみ（フォーム CRUD / 履歴の閲覧・引換更新）
DROP POLICY IF EXISTS store_admin_lottery_forms_select ON lottery_forms;
CREATE POLICY store_admin_lottery_forms_select ON lottery_forms FOR SELECT
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS store_admin_lottery_forms_insert ON lottery_forms;
CREATE POLICY store_admin_lottery_forms_insert ON lottery_forms FOR INSERT
  WITH CHECK (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS store_admin_lottery_forms_update ON lottery_forms;
CREATE POLICY store_admin_lottery_forms_update ON lottery_forms FOR UPDATE
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS store_admin_lottery_forms_delete ON lottery_forms;
CREATE POLICY store_admin_lottery_forms_delete ON lottery_forms FOR DELETE
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS store_admin_lottery_entries_select ON lottery_entries;
CREATE POLICY store_admin_lottery_entries_select ON lottery_entries FOR SELECT
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS store_admin_lottery_entries_update ON lottery_entries;
CREATE POLICY store_admin_lottery_entries_update ON lottery_entries FOR UPDATE
  USING (store_id IN (SELECT store_id FROM store_admins WHERE user_id = (SELECT auth.uid())));

-- ------------------------------------------------------------
-- 5. フォーム操作履歴に抽選フォームを追加
-- ------------------------------------------------------------
ALTER TABLE form_audit_logs DROP CONSTRAINT IF EXISTS form_audit_logs_form_type_check;
ALTER TABLE form_audit_logs
  ADD CONSTRAINT form_audit_logs_form_type_check CHECK (form_type IN ('reservation', 'survey', 'lottery'));
