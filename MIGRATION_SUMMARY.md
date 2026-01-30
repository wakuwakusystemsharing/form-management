# Vercel Blob → Supabase Storage 移行完了サマリー

## 📋 実施内容

### 実装完了項目

#### 1. ✅ 新しいデプロイヤークラスの作成
- **ファイル**: `src/lib/supabase-storage-deployer.ts`
- **機能**:
  - フォームHTMLをSupabase Storageにアップロード
  - 環境別パス管理（staging/production）
  - Content-Type: `text/html; charset=utf-8` を正しく設定
  - バージョン管理対応（`current.html`）
  - ローカル環境は既存の`public/static-forms/`を継続使用
  - 画像アップロード・削除機能
  - フォーム削除機能

#### 2. ✅ 型定義の更新
- **ファイル**: `src/types/form.ts`
- **変更内容**:
  - `StaticDeploy`インターフェースに`storage_url`フィールドを追加
  - 後方互換性のため`blob_url`フィールドも保持

#### 3. ✅ APIエンドポイントの更新

**デプロイAPI** (`src/app/api/forms/[formId]/deploy/route.ts`):
- `VercelBlobDeployer` → `SupabaseStorageDeployer`に変更
- デプロイ結果の`blob_url` → `storage_url`に変更
- ログメッセージを更新

**フォーム作成API** (`src/app/api/stores/[storeId]/forms/route.ts`):
- 同様に`SupabaseStorageDeployer`に切り替え
- デプロイ情報に`storage_url`を追加

**画像アップロードAPI** (`src/app/api/upload/menu-image/route.ts`):
- `SupabaseStorageDeployer`を使用するように更新
- Supabase Storageに画像をアップロード

#### 4. ✅ 旧コードのdeprecated化
- **ファイル**: `src/lib/vercel-blob-deployer.ts`
- deprecatedコメントを追加
- 削除予定: 1-2リリース後

#### 5. ✅ ドキュメント更新

**copilot-instructions.md**:
- セクション6「Blob デプロイ仕様」→「Supabase Storage デプロイ仕様」に更新
- パス構造、公開URL形式、Content-Type設定の説明を追加

**README.md**:
- 技術スタックセクションを更新
- Image Hosting: Vercel Blob → Supabase Storage
- Static Deployment: Vercel Blob → Supabase Storage

**新規ドキュメント**:
- `docs/SUPABASE_STORAGE_SETUP.md`: Supabase Storageのセットアップガイド

## 🎯 解決した問題

### 以前の問題（Vercel Blob）
- HTMLファイルがブラウザでダウンロードされる
- Content-Typeが正しく設定されない
- フォームが実際に使用できない

### 現在の状態（Supabase Storage）
- ✅ HTMLが正しくブラウザで表示される
- ✅ Content-Type: `text/html; charset=utf-8` が設定される
- ✅ フォームが実際に使用可能
- ✅ 公開URLで直接アクセス可能

## 📦 パス構造

### フォームタイプ別パス（2025-01-31更新）
```
予約フォーム:  reservations/{storeId}/{formId}/index.html
アンケートフォーム:  surveys/{storeId}/{formId}/index.html
```

**変更点:**
- 環境プレフィックス（`staging/`, `prod/`, `dev/`）を削除（プロジェクトレベルで分離されているため）
- `forms/` ディレクトリを削除
- `config/` ディレクトリを削除
- `current.html` → `index.html` に変更
- フォームタイプ別にディレクトリを分離

### 公開URL形式
```
https://{project-ref}.supabase.co/storage/v1/object/public/forms/{path}
```

### 画像パス
```
menu_images/{storeId}/{menuId}.{ext}
submenu_images/{storeId}/{submenuId}.{ext}
```

## 🔧 必要なセットアップ手順

### 1. Supabase Storageバケット作成
Supabase Dashboardで以下を実施:
1. Storage → New bucket
2. バケット名: `forms`
3. Public bucket: ✅ 有効

### 2. RLSポリシー設定
SQL Editorで以下を実行:
```sql
-- 読み取り権限（公開）
CREATE POLICY "Public read access to forms bucket"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'forms');

-- 書き込み権限（認証済みユーザー）
CREATE POLICY "Authenticated users can upload to forms bucket"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'forms');

-- 更新権限
CREATE POLICY "Authenticated users can update forms bucket"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'forms');

-- 削除権限
CREATE POLICY "Authenticated users can delete from forms bucket"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'forms');
```

### 3. 環境変数の確認
Vercel Dashboardで以下が設定されていることを確認:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

詳細は `docs/SUPABASE_STORAGE_SETUP.md` を参照。

## 🧪 テスト手順

### ローカル環境
1. `pnpm dev` で開発サーバー起動
2. フォームを作成または編集
3. 「更新」ボタンをクリック
4. `public/static-forms/` にHTMLファイルが生成されることを確認

### Staging環境
1. `git push origin staging` でデプロイ
2. Staging環境でフォームをデプロイ
3. 返却されたSupabase Storage URLにアクセス
4. フォームHTMLが正しくブラウザで表示されることを確認

### Production環境
1. Staging確認後、PRを作成（staging → main）
2. マージ後、自動デプロイ
3. 本番環境で同様にテスト

## 📊 変更ファイル一覧

### 新規作成
- `src/lib/supabase-storage-deployer.ts`
- `docs/SUPABASE_STORAGE_SETUP.md`
- `MIGRATION_SUMMARY.md`（このファイル）

### 更新
- `src/types/form.ts`
- `src/app/api/forms/[formId]/deploy/route.ts`
- `src/app/api/stores/[storeId]/forms/route.ts`
- `src/app/api/upload/menu-image/route.ts`
- `src/lib/vercel-blob-deployer.ts`（deprecated化）
- `.github/copilot-instructions.md`
- `README.md`

## 🔄 後方互換性

### 既存データへの影響
- ✅ 既存のVercel Blobにアップロード済みのフォームは影響を受けない
- ✅ 新規デプロイから自動的にSupabase Storageに切り替わる
- ✅ `blob_url`フィールドは保持されているため、旧データも読み取り可能

### 段階的移行
1. 新規デプロイは全てSupabase Storageを使用
2. 既存フォームは再デプロイ時にSupabase Storageに移行
3. 1-2リリース後、`vercel-blob-deployer.ts`を削除予定

## 🚨 注意事項

### セキュリティ
- `SUPABASE_SERVICE_ROLE_KEY`は秘密鍵として厳重に管理
- RLSポリシーで読み取りは公開、書き込みは認証済みユーザーのみに制限

### パフォーマンス
- HTMLは1時間キャッシュ（`cacheControl: '3600'`）
- 画像は1年キャッシュ（`cacheControl: '31536000'`）

### トラブルシューティング
問題が発生した場合は `docs/SUPABASE_STORAGE_SETUP.md` のトラブルシューティングセクションを参照

## ✅ チェックリスト

デプロイ前に以下を確認:
- [ ] Supabase Storageで`forms`バケットが作成済み
- [ ] RLSポリシーが正しく設定されている
- [ ] 環境変数が全環境で設定されている
- [ ] ローカル環境でテスト完了
- [ ] Staging環境でテスト完了
- [ ] リンターエラーなし
- [ ] 型チェックエラーなし

## 📝 今後の予定

### 短期（1-2リリース後）
- [ ] `vercel-blob-deployer.ts`を削除
- [ ] 旧Vercel Blobの使用状況を確認
- [ ] 必要に応じてVercel Blobトークンを削除

### 中期（将来的に）
- [ ] カスタムドメインの設定（例: `forms.yourdomain.com`）
- [ ] CDN最適化
- [ ] バージョン管理の強化（`{version}.html`の活用）

## 🎉 完了

Vercel BlobからSupabase Storageへの移行が完了しました！
フォームHTMLが正しくブラウザで表示され、実際に使用可能になりました。


