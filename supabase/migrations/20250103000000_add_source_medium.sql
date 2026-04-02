-- Web予約フォームの流入経路を記録するカラムを追加
ALTER TABLE reservations ADD COLUMN source_medium TEXT;

-- インデックス（流入経路別の集計用）
CREATE INDEX idx_reservations_source_medium ON reservations (source_medium);
