-- スタッフ選択機能: 予約に担当スタッフ情報を追加
-- staff_calendar_id はキャンセル時に「どのカレンダーからイベントを消すか」の特定に必須
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS staff_id TEXT;                              -- スタッフID（フォーム設定内のID。指名なし時は自動割当されたスタッフ）
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS staff_name TEXT;                            -- スタッフ表示名
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS staff_calendar_id TEXT;                     -- イベントを作成した Google カレンダーID
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS staff_no_preference BOOLEAN DEFAULT FALSE;  -- 「指名なし」で予約されたか
