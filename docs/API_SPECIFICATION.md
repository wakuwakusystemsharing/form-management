# API仕様書

このドキュメントでは、form-managementシステムのREST API仕様を説明します。

## 🌍 環境とエンドポイント

| 環境 | ベースURL | データストア |
|------|----------|-------------|
| **Local** | http://localhost:3000 | JSON ファイル |
| **Staging** | https://form-management-staging.vercel.app | Supabase |
| **Production** | https://form-management-seven.vercel.app | Supabase |

**環境自動切り替え**: すべてのAPIは環境を自動判定し、適切なデータストアを使用します。

## 🔐 認証

### 認証方式
- **Cookie**: `sb-access-token` (Supabase JWT)
- **ローカル環境**: 認証スキップ（開発効率化）

### 保護されたルート
- `/admin/*` - サービス管理者
- `/{storeId}/admin` - 店舗管理者
- `/api/forms/*` - フォーム管理
- `/api/reservations` - 予約管理

---

## 📦 店舗（Stores）API

### `GET /api/stores`
全店舗の一覧を取得（サービス管理者用）

**認証**: 不要（ページレベルで制御）

**レスポンス**:
```json
{
  "stores": [
    {
      "id": "uuid-here",
      "name": "店舗名",
      "owner_name": "オーナー名",
      "owner_email": "owner@example.com",
      "phone": "03-1234-5678",
      "address": "東京都...",
      "website_url": "https://...",
      "description": "店舗説明",
      "created_at": "2025-01-15T00:00:00Z",
      "updated_at": "2025-01-15T00:00:00Z"
    }
  ]
}
```

### `POST /api/stores`
新規店舗を作成

**リクエストボディ**:
```json
{
  "name": "店舗名",
  "owner_name": "オーナー名",
  "owner_email": "owner@example.com",
  "phone": "03-1234-5678",
  "address": "東京都...",
  "website_url": "https://...",
  "description": "店舗説明"
}
```

**レスポンス**:
```json
{
  "success": true,
  "store": {
    "id": "uuid-here",
    "name": "店舗名",
    ...
  }
}
```

### `GET /api/stores/{storeId}`
個別店舗の詳細を取得

**パラメータ**:
- `storeId` (uuid): 店舗ID

**レスポンス**: 店舗オブジェクト

### `PUT /api/stores/{storeId}`
店舗情報を更新

**リクエストボディ**: 更新したいフィールドのみ

### `DELETE /api/stores/{storeId}`
店舗を削除（関連フォーム・予約も削除）

**レスポンス**:
```json
{
  "message": "店舗と関連フォームを削除しました"
}
```

---

## 📝 フォーム（Forms）API

### `GET /api/stores/{storeId}/forms`
店舗のフォーム一覧を取得

**レスポンス**:
```json
[
  {
    "id": "uuid-here",
    "store_id": "uuid-here",
    "form_name": "カット予約フォーム",
    "status": "active",
    "draft_status": "none",
    "config": { ... },
    "line_settings": {
      "liff_id": "1234567890-abcdefgh"
    },
    "gas_endpoint": "https://script.google.com/...",
    "ui_settings": {
      "theme_color": "#3B82F6"
    },
    "static_deploy": {
      "blob_url": "https://...",
      "deployed_at": "2025-01-15T00:00:00Z"
    },
    "created_at": "2025-01-15T00:00:00Z",
    "updated_at": "2025-01-15T00:00:00Z"
  }
]
```

### `POST /api/stores/{storeId}/forms`
新規フォームを作成

**リクエストボディ**:
```json
{
  "form_name": "カット予約フォーム",
  "liff_id": "1234567890-abcdefgh",
  "gas_endpoint": "https://script.google.com/...",
  "template": {
    "name": "スタンダード",
    "config": { ... }
  }
}
```

### `GET /api/forms/{formId}`
個別フォームを取得（お客様向け・正規化済み）

**レスポンス**: 正規化されたフォームオブジェクト

### `PUT /api/forms/{formId}`
フォームを更新

**リクエストボディ**: フォーム全体または一部

### `DELETE /api/forms/{formId}`
フォームを削除

**レスポンス**:
```json
{
  "success": true,
  "message": "フォームを削除しました",
  "deletedForm": {
    "id": "uuid-here",
    "name": "フォーム名"
  }
}
```

### `POST /api/forms/{formId}/deploy`
フォームを静的HTMLとしてVercel Blobにデプロイ

**リクエストボディ**:
```json
{
  "storeId": "uuid-here"
}
```

**レスポンス**:
```json
{
  "success": true,
  "deployUrl": "https://blob.vercel-storage.com/...",
  "deployedAt": "2025-01-15T00:00:00Z",
  "environment": "staging"
}
```

---

## 📅 予約（Reservations）API

### `GET /api/reservations`
全店舗の予約一覧を取得（サービス管理者用）

**クエリパラメータ**:
- `store_id` (uuid): 店舗IDでフィルタ
- `status` (string): ステータスでフィルタ
- `date_from` (YYYY-MM-DD): 開始日
- `date_to` (YYYY-MM-DD): 終了日

**レスポンス**:
```json
[
  {
    "id": "uuid-here",
    "form_id": "uuid-here",
    "store_id": "uuid-here",
    "customer_name": "山田太郎",
    "customer_phone": "090-1234-5678",
    "customer_email": "customer@example.com",
    "selected_menus": [ ... ],
    "selected_options": [ ... ],
    "reservation_date": "2025-01-20",
    "reservation_time": "14:00:00",
    "customer_info": { ... },
    "status": "pending",
    "created_at": "2025-01-15T00:00:00Z",
    "updated_at": "2025-01-15T00:00:00Z"
  }
]
```

### `POST /api/reservations`
新規予約を作成（顧客向け）

**リクエストボディ**:
```json
{
  "form_id": "uuid-here",
  "store_id": "uuid-here",
  "customer_name": "山田太郎",
  "customer_phone": "090-1234-5678",
  "customer_email": "customer@example.com",
  "selected_menus": [ ... ],
  "selected_options": [ ... ],
  "reservation_date": "2025-01-20",
  "reservation_time": "14:00",
  "customer_info": { ... }
}
```

**レスポンス**: 作成された予約オブジェクト（201 Created）

### `GET /api/stores/{storeId}/reservations`
店舗の予約一覧を取得（店舗管理者用）

**クエリパラメータ**: `/api/reservations` と同じ

---

## 🖼️ 画像アップロード（Upload）API

### `POST /api/upload/menu-image`
メニュー画像をVercel Blobにアップロード

**リクエスト**: `multipart/form-data`
- `file` (File): 画像ファイル（最大5MB）
- `storeId` (string): 店舗ID
- `menuId` (string): メニューID
- `submenuId` (string, optional): サブメニューID

**レスポンス**:
```json
{
  "url": "https://blob.vercel-storage.com/menu_images/..."
}
```

---

## 🛡️ エラーレスポンス

すべてのAPIは統一されたエラー形式を返します：

```json
{
  "error": "エラーメッセージ",
  "details": "詳細情報（オプション）"
}
```

### HTTPステータスコード

| コード | 意味 |
|--------|------|
| 200 | 成功 |
| 201 | 作成成功 |
| 400 | リクエストエラー（バリデーション失敗等） |
| 401 | 認証エラー |
| 403 | 権限エラー |
| 404 | リソースが見つからない |
| 500 | サーバーエラー |

---

## 🔄 環境による動作の違い

| 機能 | Local | Staging/Production |
|------|-------|-------------------|
| データストア | JSON ファイル | Supabase |
| 店舗ID形式 | `st{timestamp}` | UUID |
| フォームID形式 | 12文字ランダム | 12文字ランダム |
| 認証 | スキップ | 必須 |
| RLS | 無効 | 有効（一部） |

---

## 📚 関連ドキュメント

- [データベース設計](../README.md#-データベース設計supabase)
- [認証システム](../README.md#-認証システム)
- [セットアップガイド](./SETUP.md)

