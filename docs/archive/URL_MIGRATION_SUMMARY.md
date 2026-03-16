# URL変更サマリー - プロキシ実装

## 変更概要

Supabase StorageからHTMLを正しく配信するため、Next.jsのAPIルートを使用したプロキシを実装しました。

## URL構造の変更

### 変更前（Vercel Blob）

```
https://form-management-seven.vercel.app/prod/forms/{storeId}/{formId}.html
```

### 変更後（Supabase Storage + プロキシ）

#### プロキシURL（顧客向け・推奨）
```
https://form-management-staging.vercel.app/api/public-form/staging/forms/{storeId}/{formId}/config/current.html
```

#### 直接URL（管理者用・デバッグ用）
```
https://ohplaysshllkinaiqksb.supabase.co/storage/v1/object/public/forms/staging/forms/{storeId}/{formId}/config/current.html
```

## データ構造

### `static_deploy`フィールド

```typescript
{
  deployed_at: string;           // デプロイ日時
  deploy_url: string;            // プロキシURL（顧客向け）
  storage_url?: string;          // 直接URL（管理者用）
  blob_url?: string;             // 旧Vercel Blob URL（後方互換性）
  status: 'deployed' | 'failed'; // デプロイステータス
  environment: 'local' | 'staging' | 'production'; // 環境
}
```

### URL優先順位

UIでの表示優先順位：

1. **`deploy_url`** - プロキシURL（最優先）
   - Next.jsのAPIルート経由
   - 正しいContent-Typeヘッダーで配信
   - HTMLとしてブラウザで表示される

2. **`storage_url`** - 直接URL（フォールバック）
   - Supabase Storageの直接URL
   - デバッグ用

3. **`blob_url`** - 旧URL（後方互換性）
   - Vercel BlobのURL
   - 既存データ用

## 修正したファイル

### 1. プロキシAPIルート
**ファイル:** `src/app/api/public-form/[...path]/route.ts`

- Supabase Storageから`download()`でHTMLを取得
- 正しい`Content-Type: text/html; charset=utf-8`ヘッダーで配信
- キャッシュ制御ヘッダーを設定

### 2. デプロイヤー
**ファイル:** `src/lib/supabase-storage-deployer.ts`

- プロキシURLを`deploy_url`として返す
- 直接URLを`storage_url`として保存
- 環境変数`NEXT_PUBLIC_BASE_URL`または`VERCEL_URL`を使用

### 3. UI表示の修正

#### 店舗管理ページ
**ファイル:** `src/app/[storeId]/admin/page.tsx`

```typescript
// 変更前
{(form as any).static_deploy.storage_url || 
 (form as any).static_deploy.blob_url || 
 (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000') + (form as any).static_deploy.deploy_url}

// 変更後
{(form as any).static_deploy.deploy_url}
```

#### フォーム編集ページ
**ファイル:** `src/app/[storeId]/forms/[formId]/page.tsx`

```typescript
// 変更前
href={form.static_deploy.storage_url || form.static_deploy.blob_url || form.static_deploy.deploy_url}

// 変更後
href={form.static_deploy.deploy_url}
```

#### サービス管理者ページ
**ファイル:** `src/app/admin/[storeId]/page.tsx`

```typescript
// 変更前
if (deployInfo?.storage_url) {
  formUrl = deployInfo.storage_url;
} else if (deployInfo?.blob_url) {
  formUrl = deployInfo.blob_url;
} else if (deployInfo?.deploy_url) {
  formUrl = deployInfo.deploy_url;
}

// 変更後
if (deployInfo?.deploy_url) {
  formUrl = deployInfo.deploy_url;
} else if (deployInfo?.storage_url) {
  formUrl = deployInfo.storage_url;
} else if (deployInfo?.blob_url) {
  formUrl = deployInfo.blob_url;
}
```

## プロキシの動作フロー

```
1. ユーザーがプロキシURLにアクセス
   ↓
2. Next.js APIルート (/api/public-form/[...path]) がリクエストをキャッチ
   ↓
3. Supabase Storageから該当HTMLをダウンロード
   ↓
4. 正しいContent-Typeヘッダーを設定
   ↓
5. ブラウザにHTMLを返す
   ↓
6. ブラウザがHTMLとして正しく表示
```

## 環境変数

### 必要な環境変数

#### Vercel環境
- `VERCEL_URL`: Vercelが自動設定（例: `form-management-staging.vercel.app`）
- または `NEXT_PUBLIC_BASE_URL`: 手動設定（例: `https://form-management-staging.vercel.app`）

#### Supabase
- `NEXT_PUBLIC_SUPABASE_URL`: Supabaseプロジェクト URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: 匿名キー
- `SUPABASE_SERVICE_ROLE_KEY`: サービスロールキー（サーバーサイド専用）

#### ローカル環境
- デフォルトで`http://localhost:3000`を使用

## テスト手順

### 1. フォームを再デプロイ
1. 管理画面でフォーム編集ページを開く
2. 「更新」ボタンをクリック
3. 新しいプロキシURLが生成される

### 2. URL確認
1. デプロイ完了後、表示されたURLを確認
2. URLが以下の形式になっていることを確認：
   ```
   https://form-management-staging.vercel.app/api/public-form/staging/forms/...
   ```

### 3. 動作確認
1. 表示されたURLにアクセス
2. フォームがHTMLとして正しく表示されることを確認
3. フォームの入力・送信が正常に動作することを確認

## トラブルシューティング

### エラー: "Supabase client initialization failed"
**原因:** 環境変数が設定されていない

**解決方法:**
1. Vercel Dashboard → Settings → Environment Variables
2. 必要な環境変数を確認・追加
3. 再デプロイ

### エラー: "Form not found"
**原因:** Supabase Storageにファイルがアップロードされていない

**解決方法:**
1. フォームを再デプロイ
2. Supabase Dashboard → Storage → forms バケットを確認
3. ファイルが存在するか確認

### HTMLコードが表示される
**原因:** 直接URLにアクセスしている

**解決方法:**
1. プロキシURL（`/api/public-form/...`）を使用
2. 管理画面に表示されているURLをコピーして使用

### プロキシURLが生成されない
**原因:** 環境変数が設定されていない

**解決方法:**
1. `NEXT_PUBLIC_BASE_URL`または`VERCEL_URL`を設定
2. 再デプロイ

## メリット

✅ **HTMLが正しく表示される**
- ブラウザがHTMLとして認識
- フォームが正常に動作

✅ **セキュリティ**
- Supabase Storageのアクセス制御を維持
- サーバーサイドで認証・検証が可能

✅ **キャッシュ制御**
- 適切なキャッシュヘッダーを設定
- パフォーマンス最適化

✅ **柔軟性**
- 将来的に追加のヘッダーや処理を挿入可能
- A/Bテストやアナリティクスの追加が容易

## 今後の改善案

1. **CDN統合**
   - Cloudflare WorkersやVercel Edgeでさらに高速化

2. **カスタムドメイン**
   - `forms.yourdomain.com`でアクセス可能に

3. **アナリティクス**
   - フォーム表示・送信のトラッキング

4. **A/Bテスト**
   - 複数バージョンのフォームを配信

5. **エラーページ**
   - カスタムエラーページの表示

## 関連ドキュメント

- `PROXY_SOLUTION.md` - プロキシソリューションの詳細
- `MIGRATION_SUMMARY.md` - Vercel Blob → Supabase Storage移行サマリー
- `docs/SUPABASE_STORAGE_SETUP.md` - Supabase Storageセットアップガイド

## まとめ

プロキシ実装により、Supabase StorageからHTMLを正しく配信できるようになりました。`deploy_url`がプロキシURLとして機能し、顧客向けフォームが正常に表示・動作します。

**重要:** 必ずプロキシURL（`deploy_url`）を使用してください。直接URL（`storage_url`）ではHTMLコードが表示されてしまいます。

