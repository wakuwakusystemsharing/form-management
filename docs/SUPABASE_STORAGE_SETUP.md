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
- `NEXT_PUBLIC_SUPABASE_URL`: `https://[production-project-ref].supabase.co`（Stagingとは別プロジェクト）
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Productionプロジェクトの anon key
- `SUPABASE_SERVICE_ROLE_KEY`: Productionプロジェクトの service_role key
- `NEXT_PUBLIC_PRODUCTION_URL`: `https://nas-rsv.com`（カスタムドメイン）

**重要**: Staging環境とProduction環境は**別々のSupabaseプロジェクト**を使用します

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

**直接URL（Supabase Storage）:**
```
https://[project-ref].supabase.co/storage/v1/object/public/forms/staging/forms/[storeId]/[formId]/config/current.html
```

**プロキシURL（推奨、正しいContent-Typeで配信）:**
```
https://form-management-staging.vercel.app/api/public-form/staging/forms/[storeId]/[formId]/config/current.html
```

**Production環境の場合:**
```
https://nas-rsv.com/api/public-form/prod/forms/[storeId]/[formId]/config/current.html
```

**注意**: 
- 環境に応じて自動的に適切なパスプレフィックスが使用されます
  - Staging: `staging/forms/{storeId}/{formId}/config/current.html`
  - Production: `prod/forms/{storeId}/{formId}/config/current.html`
- プロキシURL (`/api/public-form/*`) 経由でアクセスすることで、正しいContent-Type (`text/html; charset=utf-8`) で配信されます
- キャッシュバスティングのため、`?v={timestamp}` パラメータが自動的に追加されます

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
- プロキシURL (`/api/public-form/*`) を使用してください
- プロキシURL経由でアクセスすることで、正しいContent-Type (`text/html; charset=utf-8`) で配信されます
- 直接Supabase Storage URLを使用する場合、ブラウザによってはダウンロードされる可能性があります

#### 環境別のパス構造

**Staging環境:**
- ストレージパス: `staging/forms/{storeId}/{formId}/config/current.html`
- プロキシURL: `https://form-management-staging.vercel.app/api/public-form/staging/forms/{storeId}/{formId}/config/current.html`

**Production環境:**
- ストレージパス: `prod/forms/{storeId}/{formId}/config/current.html`
- プロキシURL: `https://nas-rsv.com/api/public-form/prod/forms/{storeId}/{formId}/config/current.html`

**Local環境:**
- ローカルファイル: `public/static-forms/{formId}.html`
- アクセスURL: `http://localhost:3000/static-forms/{formId}.html`

### カスタムドメインの設定

Production環境では、Vercelのカスタムドメイン（`nas-rsv.com`）を使用します:

1. Vercel Dashboard → Settings → Domains
2. カスタムドメイン `nas-rsv.com` を追加
3. DNS設定を確認（AレコードまたはCNAMEレコード）
4. ドメインが有効化されるまで待機
5. 環境変数 `NEXT_PUBLIC_PRODUCTION_URL=https://nas-rsv.com` を設定

**注意**: カスタムドメインが有効化されると、フォームのURLが自動的にカスタムドメインを使用するようになります

## まとめ

これで、Supabase Storageを使用したフォームデプロイの準備が完了しました。

- ✅ `forms` バケットが作成済み
- ✅ RLSポリシーが設定済み
- ✅ 環境変数が設定済み
- ✅ デプロイが正常に動作

問題が発生した場合は、トラブルシューティングセクションを参照してください。

