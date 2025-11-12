# フォームURLの取得方法

## 正しいフォームURLの確認方法

### 1. 管理画面でフォームを確認

#### 店舗管理ページ（`/{storeId}/admin`）

1. 店舗管理ページにアクセス
2. フォーム一覧で対象フォームを確認
3. **「顧客向け本番URL」**セクションに表示されているURLをコピー

```
✅ 本番フォーム
顧客向け本番URL:
https://form-management-staging.vercel.app/api/public-form/staging/forms/...
```

#### フォーム編集ページ（`/{storeId}/forms/{formId}`）

1. フォーム編集ページにアクセス
2. 画面上部の**「✅ 本番フォーム」**セクションを確認
3. 表示されているURLをコピー

### 2. URLの種類

#### ❌ プレビューURL（開発用）
```
https://form-management-staging.vercel.app/form/{formId}?preview=true
```

**用途:** 編集中のフォームを確認するための開発用URL  
**注意:** 顧客には共有しないでください

#### ✅ 本番URL（顧客向け）
```
https://form-management-staging.vercel.app/api/public-form/staging/forms/{storeId}/{formId}/config/current.html
```

**用途:** 顧客に共有するための本番URL  
**特徴:** フォームが正しくHTMLとして表示される

### 3. URLの取得手順

#### 方法1: 管理画面からコピー

1. 店舗管理ページまたはフォーム編集ページを開く
2. 「顧客向け本番URL」または「✅ 本番フォーム」セクションを確認
3. **「コピー」ボタン**または**📋アイコン**をクリック
4. URLがクリップボードにコピーされます

#### 方法2: フォームを再デプロイ

フォームを編集した後、URLを取得するには：

1. フォーム編集ページで編集を完了
2. **「更新」ボタン**をクリック（緑色のボタン）
3. デプロイ完了後、「✅ 本番フォーム」セクションに新しいURLが表示される
4. URLをコピー

### 4. URLの確認方法

正しいURLかどうかを確認：

#### ✅ 正しいURL
- `/api/public-form/` を含む
- フォームがHTMLとして表示される
- 入力・送信が正常に動作する

例：
```
https://form-management-staging.vercel.app/api/public-form/staging/forms/05cb6727-932b-4616-8f24-5485ce44b937/14ecbf4f-90db-4003-bfa5-aa4665b4f112/config/current.html
```

#### ❌ 間違ったURL
- `/form/{formId}?preview=true` の形式
- 「プレビューモード」と表示される
- 開発用のURL

例：
```
https://form-management-staging.vercel.app/form/14ecbf4f-90db-4003-bfa5-aa4665b4f112?preview=true
```

### 5. トラブルシューティング

#### 問題: プレビューURLしか表示されない

**原因:** フォームがまだデプロイされていない

**解決方法:**
1. フォーム編集ページを開く
2. 「更新」ボタンをクリックしてデプロイ
3. デプロイ完了後、本番URLが表示される

#### 問題: URLにアクセスしてもHTMLコードが表示される

**原因:** 直接URL（Supabase Storage）を使用している

**解決方法:**
1. プロキシURL（`/api/public-form/...`）を使用
2. 管理画面に表示されているURLをコピーして使用

#### 問題: 「✅ 本番フォーム」セクションが表示されない

**原因:** フォームがデプロイされていない

**解決方法:**
1. フォーム編集ページで「更新」ボタンをクリック
2. デプロイが完了するまで待つ（数秒）
3. ページをリロード

### 6. 顧客へのURL共有

顧客にフォームURLを共有する際：

1. ✅ **本番URL**を使用（`/api/public-form/...`）
2. ❌ プレビューURLは使用しない（`?preview=true`）
3. URLをLINEやメールで共有
4. 顧客がアクセスしてフォームが正しく表示されることを確認

### 7. 環境別URL

#### Staging環境
```
https://form-management-staging.vercel.app/api/public-form/staging/forms/...
```

#### Production環境
```
https://form-management-seven.vercel.app/api/public-form/prod/forms/...
```

### まとめ

- ✅ 管理画面の「顧客向け本番URL」を使用
- ✅ `/api/public-form/` を含むURLを使用
- ❌ プレビューURL（`?preview=true`）は顧客に共有しない
- ❌ 直接URL（Supabase Storage）は使用しない

正しいURLを使用すれば、フォームが正しくHTMLとして表示され、顧客が予約を行えます。

