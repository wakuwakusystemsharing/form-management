-- 店舗管理者のログイン情報確認用テーブル
-- この管理画面で設定・変更されたパスワードのみを保存する（既存の Supabase Auth のパスワードは復元不可）。
-- 設定タブの「店舗管理者管理」の確認ボタンで、サービス管理者がメールアドレスとパスワードを確認できる。
CREATE TABLE IF NOT EXISTS admin_login_credentials (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  password TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS を有効化し、ポリシーを一切作らないことで anon / authenticated からのアクセスを全拒否する。
-- 参照・更新は service_role（API サーバーの Admin Client）経由のみ。
ALTER TABLE admin_login_credentials ENABLE ROW LEVEL SECURITY;
