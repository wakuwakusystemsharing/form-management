# Supabase Storage セットアップガイド

このドキュメントでは、フォームHTMLをデプロイするためのSupabase Storageバケットのセットアップ手順を説明します。

## 前提条件

- Supabaseプロジェクトが作成済み
- プロジェクトのダッシュボードにアクセス可能

## セットアップ手順

### 1. Supabase Dashboardにアクセス

1. [Supabase Dashboard](https://app.supabase.com) にログイン
2. 対象のプロジェクトを選択

### 2. Storageバケットの作成

1. 左サイドバーから **Storage** をクリック
2. **New bucket** ボタンをクリック
3. 以下の設定でバケットを作成:
   - **Name**: `forms`
   - **Public bucket**: ✅ 有効にする（チェックを入れる）
   - **File size limit**: `50 MB`（デフォルト）
   - **Allowed MIME types**: 空欄（すべて許可）

4. **Create bucket** をクリック

### 3. RLSポリシーの設定

バケット作成後、適切なアクセス制御を設定します。

#### 方法1: Supabase SQL Editorを使用（推奨）

1. 左サイドバーから **SQL Editor** をクリック
2. **New query** をクリック
3. 以下のSQLを貼り付けて実行:

```sql
-- RLS Policy: 匿名ユーザーがformsバケットから読み取り可能
CREATE POLICY "Public read access to forms bucket"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'forms');

-- RLS Policy: 認証済みユーザー（サービスロール）がformsバケットに書き込み可能
CREATE POLICY "Authenticated users can upload to forms bucket"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'forms');

-- RLS Policy: 認証済みユーザー（サービスロール）がformsバケットを更新可能
CREATE POLICY "Authenticated users can update forms bucket"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'forms');

-- RLS Policy: 認証済みユーザー（サービスロール）がformsバケットから削除可能
CREATE POLICY "Authenticated users can delete from forms bucket"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'forms');
```

#### 方法2: Supabase Dashboardから設定

1. **Storage** → **Policies** タブをクリック
2. `forms` バケットを選択
3. 以下のポリシーを追加:

**読み取りポリシー（Public Read）:**
- Policy name: `Public read access to forms bucket`
- Target roles: `public`
- Policy definition: `SELECT`
- USING expression: `bucket_id = 'forms'`

**書き込みポリシー（Authenticated Write）:**
- Policy name: `Authenticated users can upload to forms bucket`
- Target roles: `authenticated`
- Policy definition: `INSERT`
- WITH CHECK expression: `bucket_id = 'forms'`

### 4. 環境変数の確認

Vercel Dashboardで以下の環境変数が設定されていることを確認してください:

#### Staging環境
- `NEXT_PUBLIC_SUPABASE_URL`: `https://[your-project-ref].supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase Dashboard → Settings → API → anon public
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase Dashboard → Settings → API → service_role (⚠️ 秘密鍵)

#### Production環境
- 同じ環境変数を設定（Staging環境と同じ値）

### 5. 動作確認

#### ローカル環境での確認

1. ローカルで開発サーバーを起動:
```bash
pnpm dev
```

2. フォームを作成または編集
3. 「更新」ボタンをクリックしてデプロイ
4. `public/static-forms/` ディレクトリにHTMLファイルが生成されることを確認

#### Staging環境での確認

1. Staging環境にデプロイ:
```bash
git push origin staging
```

2. Staging環境でフォームをデプロイ
3. デプロイ成功後、返却されたURLにアクセス
4. フォームHTMLが正しくブラウザで表示されることを確認

**期待されるURL形式:**
```
https://[project-ref].supabase.co/storage/v1/object/public/forms/staging/forms/[storeId]/[formId]/config/current.html
```

### トラブルシューティング

#### エラー: "Supabase クライアントの初期化に失敗しました"

**原因:** 環境変数が設定されていない

**解決方法:**
1. Vercel Dashboard → Settings → Environment Variables
2. 必要な環境変数を追加
3. 再デプロイ

#### エラー: "Failed to upload: new row violates row-level security policy"

**原因:** RLSポリシーが正しく設定されていない

**解決方法:**
1. Supabase Dashboard → Storage → Policies
2. 上記のRLSポリシーが作成されているか確認
3. ポリシーが有効になっているか確認

#### エラー: "Bucket not found"

**原因:** `forms` バケットが作成されていない

**解決方法:**
1. Supabase Dashboard → Storage
2. `forms` バケットを作成（手順2を参照）

#### HTMLがダウンロードされる問題

**原因:** Content-Typeが正しく設定されていない

**解決方法:**
- この問題はSupabase Storageでは発生しません
- Vercel Blobから移行した場合、新しいデプロイで自動的に解決されます

### カスタムドメインの設定（オプション）

将来的にカスタムドメイン（例: `forms.yourdomain.com`）を使用する場合:

1. Supabase Dashboard → Settings → Storage
2. Custom domain設定を追加
3. DNSレコードを設定（Supabaseの指示に従う）
4. SSL証明書の自動発行を待つ

## まとめ

これで、Supabase Storageを使用したフォームデプロイの準備が完了しました。

- ✅ `forms` バケットが作成済み
- ✅ RLSポリシーが設定済み
- ✅ 環境変数が設定済み
- ✅ デプロイが正常に動作

問題が発生した場合は、トラブルシューティングセクションを参照してください。

