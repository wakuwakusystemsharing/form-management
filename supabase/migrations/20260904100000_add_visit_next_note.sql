-- 顧客カルテ: 来店記録ごとの「次回への申し送り」
-- 顧客詳細を開いたとき、未確認（next_visit_note_acknowledged_at IS NULL）の最新 1 件を最上部の帯に表示し、
-- 「確認済み」で acknowledged_at を入れて帯から消す（来店カードには残る）。
ALTER TABLE customer_visits ADD COLUMN IF NOT EXISTS next_visit_note TEXT;
ALTER TABLE customer_visits ADD COLUMN IF NOT EXISTS next_visit_note_by TEXT;
ALTER TABLE customer_visits ADD COLUMN IF NOT EXISTS next_visit_note_acknowledged_at TIMESTAMPTZ;

COMMENT ON COLUMN customer_visits.next_visit_note IS '次回への申し送り（店舗スタッフ向けメモ）';
COMMENT ON COLUMN customer_visits.next_visit_note_by IS '申し送りを書いた担当者名（任意）';
COMMENT ON COLUMN customer_visits.next_visit_note_acknowledged_at IS '申し送りを「確認済み」にした日時（NULL = 未確認）';

CREATE INDEX IF NOT EXISTS idx_customer_visits_customer_note
  ON customer_visits (customer_id, visit_date DESC)
  WHERE next_visit_note IS NOT NULL;
