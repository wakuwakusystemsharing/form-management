-- 寄せ書きウォール: 1 ユーザーが 1 日に貼れる付箋の枚数を店舗ごとに設定（既定 1）
ALTER TABLE wall_boards
  ADD COLUMN IF NOT EXISTS daily_max INTEGER NOT NULL DEFAULT 1
  CHECK (daily_max BETWEEN 1 AND 10);
