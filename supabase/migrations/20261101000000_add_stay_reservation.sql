-- ============================================================
-- 宿泊モード（予約フォームの booking_mode = 'stay'）
--   - reservations に宿泊用の列を追加（checkout_date が NULL = 宿泊以外の予約）
--   - 同じ夜の二重予約を防ぐ挿入関数 stay_insert_reservation_checked
-- 設計: docs/旅館用予約フォーム検討資料/旅館用予約フォーム_実装設計.md
-- ============================================================

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS checkout_date DATE,
  ADD COLUMN IF NOT EXISTS stay_nights INTEGER,
  ADD COLUMN IF NOT EXISTS guest_counts JSONB,
  ADD COLUMN IF NOT EXISTS guest_count INTEGER,
  ADD COLUMN IF NOT EXISTS stay_price_total INTEGER,
  ADD COLUMN IF NOT EXISTS cancel_fee_percent INTEGER,
  ADD COLUMN IF NOT EXISTS cancel_fee_amount INTEGER,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

COMMENT ON COLUMN reservations.checkout_date IS '宿泊予約のチェックアウト日（NULL = 宿泊以外）。reservation_date = チェックイン日、reservation_time = チェックイン時刻';
COMMENT ON COLUMN reservations.stay_nights IS '泊数';
COMMENT ON COLUMN reservations.guest_counts IS '人数の区分ごとの人数 { "<category_id>": n }';
COMMENT ON COLUMN reservations.guest_count IS '有料人数（一覧・分析用）';
COMMENT ON COLUMN reservations.stay_price_total IS '割引後の宿泊料金（円。サーバーで再計算した値）';
COMMENT ON COLUMN reservations.cancel_fee_percent IS 'キャンセル時に確定したキャンセル料の割合（%）';
COMMENT ON COLUMN reservations.cancel_fee_amount IS 'キャンセル時に確定したキャンセル料（円）';
COMMENT ON COLUMN reservations.cancelled_at IS 'キャンセル日時';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reservations_checkout_after_checkin'
  ) THEN
    ALTER TABLE reservations
      ADD CONSTRAINT reservations_checkout_after_checkin
      CHECK (checkout_date IS NULL OR checkout_date > reservation_date);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_reservations_stay_range
  ON reservations (store_id, reservation_date, checkout_date)
  WHERE checkout_date IS NOT NULL;

-- ------------------------------------------------------------
-- 同じ夜の二重予約を防いで挿入する
--   p_row: reservations の列名をキーにした JSONB（id / created_at 等はアプリ側で与える。無い列は既定値）
--   p_room_count: 同じ夜に受けられる数
--   返り値: { ok: true, row: {...} } / { ok: false, reason: 'stay_full' | 'invalid' }
-- 店舗ごとのアドバイザリロックで直列化し、checkin 〜 checkout-1 の各夜の有効予約数が
-- p_room_count 以上なら挿入しない。Google カレンダー側の重なりはアプリ側で直前に確認する
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.stay_insert_reservation_checked(
  p_row JSONB,
  p_room_count INTEGER
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_store TEXT := p_row->>'store_id';
  v_in DATE;
  v_out DATE;
  v_max INTEGER;
  v_cols TEXT;
  v_row reservations;
BEGIN
  BEGIN
    v_in := (p_row->>'reservation_date')::DATE;
    v_out := (p_row->>'checkout_date')::DATE;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid');
  END;
  IF v_store IS NULL OR v_in IS NULL OR v_out IS NULL OR v_out <= v_in THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('stay:' || v_store));

  SELECT COALESCE(MAX(t.c), 0) INTO v_max
    FROM (
      SELECT d::date AS night, COUNT(r.id) AS c
        FROM generate_series(v_in, v_out - 1, interval '1 day') AS d
        LEFT JOIN reservations r
          ON r.store_id = v_store
         AND r.checkout_date IS NOT NULL
         AND r.status <> 'cancelled'
         AND r.reservation_date <= d::date
         AND r.checkout_date > d::date
       GROUP BY d
    ) t;
  IF v_max >= COALESCE(p_room_count, 1) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'stay_full');
  END IF;

  -- p_row のキーのうち reservations に実在する列だけを挿入（無い列は既定値が入る）
  SELECT string_agg(quote_ident(k), ', ') INTO v_cols
    FROM jsonb_object_keys(p_row) AS k
   WHERE EXISTS (
     SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = 'reservations' AND c.column_name = k
   );
  IF v_cols IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;

  EXECUTE format(
    'INSERT INTO reservations (%s) SELECT %s FROM jsonb_populate_record(NULL::reservations, $1) RETURNING *',
    v_cols, v_cols
  ) INTO v_row USING p_row;

  RETURN jsonb_build_object('ok', true, 'row', to_jsonb(v_row));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.stay_insert_reservation_checked(JSONB, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.stay_insert_reservation_checked(JSONB, INTEGER) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stay_insert_reservation_checked(JSONB, INTEGER) TO service_role;
