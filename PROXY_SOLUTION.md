# Supabase Storage HTMLプロキシ配信ソリューション

## 問題

Supabase StorageからHTMLファイルを直接配信すると、ブラウザでHTMLコードがそのまま表示されてしまう問題が発生しました。

**原因:**
- Supabase Storageは、セキュリティ上の理由から、HTMLファイルに対して適切な`Content-Disposition`ヘッダーを設定しない
- ブラウザがHTMLとして認識せず、テキストとして表示してしまう

## 解決策

Next.jsのAPIルートを使用して、Supabase StorageからHTMLを取得し、正しいヘッダーで配信するプロキシを実装しました。

### 実装内容

#### 1. プロキシAPIルートの作成

**ファイル:** `src/app/api/public-form/[...path]/route.ts`

- Supabase Storageから`download()`メソッドでHTMLを取得
- 正しい`Content-Type: text/html; charset=utf-8`ヘッダーで配信
- キャッシュ制御ヘッダーも設定

#### 2. デプロイヤーの更新

**ファイル:** `src/lib/supabase-storage-deployer.ts`

- プロキシURL（Next.jsのAPIルート経由）を生成
- `url`: プロキシURL（顧客向け）
- `storage_url`: 直接URL（管理用・デバッグ用）

### URL形式

#### プロキシURL（推奨）
```
https://form-management-staging.vercel.app/api/public-form/staging/forms/{storeId}/{formId}/config/current.html
```

#### 直接URL（参考用）
```
https://ohplaysshllkinaiqksb.supabase.co/storage/v1/object/public/forms/staging/forms/{storeId}/{formId}/config/current.html
```

### 環境変数

以下の環境変数が必要です：

**Vercel環境:**
- `VERCEL_URL`: Vercelが自動設定（例: `form-management-staging.vercel.app`）
- または `NEXT_PUBLIC_BASE_URL`: 手動設定（例: `https://form-management-staging.vercel.app`）

**ローカル環境:**
- デフォルトで`http://localhost:3000`を使用

### 動作フロー

1. ユーザーがプロキシURLにアクセス
2. Next.jsのAPIルートが`/api/public-form/[...path]`をキャッチ
3. Supabase Storageから該当HTMLをダウンロード
4. 正しい`Content-Type`ヘッダーを設定してレスポンス
5. ブラウザがHTMLとして正しく表示

### メリット

✅ **HTMLが正しく表示される**
- ブラウザがHTMLとして認識
- フォームが正常に動作

✅ **セキュリティ**
- Supabase Storageのアクセス制御を維持
- サーバーサイドで認証・検証が可能

✅ **キャッシュ制御**
- 適切なキャッシュヘッダーを設定可能
- パフォーマンス最適化

✅ **柔軟性**
- 将来的に追加のヘッダーや処理を挿入可能
- A/Bテストやアナリティクスの追加が容易

### デメリットと対策

❌ **Next.jsサーバーへの依存**
- 対策: Vercelのエッジネットワークで高速配信
- 対策: キャッシュヘッダーで負荷軽減

❌ **追加のレイテンシ**
- 対策: Supabase Storageからのダウンロードは高速
- 対策: CDNキャッシュで2回目以降は高速

### テスト手順

1. フォームを再デプロイ
2. 新しいプロキシURLが生成される
3. URLにアクセスしてフォームが正しく表示されることを確認

### トラブルシューティング

#### エラー: "Supabase client initialization failed"
- 環境変数が設定されているか確認
- `SUPABASE_SERVICE_ROLE_KEY`が正しいか確認

#### エラー: "Form not found"
- Supabase Storageにファイルがアップロードされているか確認
- パスが正しいか確認

#### HTMLコードが表示される
- プロキシURLを使用しているか確認
- 直接URLではなくプロキシURLにアクセス

### 今後の改善案

1. **CDN統合**
   - Cloudflare WorkersやVercel Edgeでさらに高速化

2. **カスタムドメイン**
   - `forms.yourdomain.com`でアクセス可能に

3. **アナリティクス**
   - フォーム表示・送信のトラッキング

4. **A/Bテスト**
   - 複数バージョンのフォームを配信

## まとめ

プロキシソリューションにより、Supabase StorageからHTMLを正しく配信できるようになりました。これにより、フォームが正常に動作し、ユーザーに適切に表示されます。

