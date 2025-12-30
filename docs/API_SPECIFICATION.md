# API仕様書

このドキュメントでは、form-managementシステムのREST API仕様を説明します。

## 🌍 環境とエンドポイント

| 環境 | ベースURL | データストア |
|------|----------|-------------|
| **Local** | http://localhost:3000 | JSON ファイル |
| **Staging** | https://form-management-staging.vercel.app | Supabase |
| **Production** | https://nas-rsv.com | Supabase |

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
      "id": "abc123",
      "name": "店舗名",
      "owner_name": "オーナー名",
      "owner_email": "owner@example.com",
      "phone": "03-1234-5678",
      "address": "東京都...",
      "website_url": "https://...",
      "description": "店舗説明",
      "subdomain": "st0001",
      "custom_domain": null,
      "status": "active",
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

**認証**: サービス管理者

**リクエストボディ**: 更新したいフィールドのみ
```json
{
  "name": "更新された店舗名",
  "owner_name": "更新されたオーナー名",
  "owner_email": "updated@example.com",
  "phone": "03-9876-5432",
  "address": "更新された住所",
  "website_url": "https://updated.com",
  "description": "更新された説明",
  "subdomain": "st0001",
  "custom_domain": "example.com"
}
```

**注意**: 
- `subdomain`: 小文字英数字とハイフンのみ、3-63文字、予約語不可（`www`, `api`, `admin`など）
- `custom_domain`: 基本的なドメイン形式チェックを実施
- 両方ともユニーク制約あり（重複不可）

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
      "deploy_url": "https://nas-rsv.com/api/public-form/reservations/{storeId}/{formId}/index.html",
      "storage_url": "https://[project-ref].supabase.co/storage/v1/object/public/forms/...",
      "deployed_at": "2025-01-15T00:00:00Z",
      "status": "deployed"
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
フォームを静的HTMLとしてSupabase Storageにデプロイ

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
  "deployUrl": "https://nas-rsv.com/api/public-form/reservations/{storeId}/{formId}/index.html?v=1234567890",
  "storageUrl": "https://[project-ref].supabase.co/storage/v1/object/public/forms/reservations/{storeId}/{formId}/index.html",
  "deployedAt": "2025-01-15T00:00:00Z",
  "environment": "production"
}
```

**注意**: 
- 環境に応じて自動的に適切なSupabaseプロジェクトのStorageにデプロイされます（プロジェクトレベルで分離）
- 予約フォーム: `reservations/{storeId}/{formId}/index.html`
- アンケートフォーム: `surveys/{storeId}/{formId}/index.html`
- 環境プレフィックス（`staging/`, `prod/`, `dev/`）は不要
- プロキシURL (`/api/public-form/*`) 経由でアクセスすることで、正しいContent-Typeで配信されます

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

## 📋 アンケートフォーム（Survey Forms）API

### `GET /api/stores/{storeId}/surveys`
店舗のアンケートフォーム一覧を取得

**レスポンス**:
```json
[
  {
    "id": "abc123def456",
    "store_id": "xyz789",
    "name": "顧客アンケート",
    "status": "active",
    "draft_status": "none",
    "config": {
      "basic_info": {
        "title": "顧客アンケート",
        "liff_id": "1234567890-abcdefgh",
        "theme_color": "#13ca5e"
      },
      "questions": [ ... ],
      "ui_settings": { ... }
    },
    "static_deploy": {
      "deploy_url": "https://nas-rsv.com/api/public-form/surveys/{storeId}/{id}/index.html",
      "storage_url": "https://[project-ref].supabase.co/storage/v1/object/public/forms/...",
      "deployed_at": "2025-01-15T00:00:00Z",
      "status": "deployed"
    },
    "created_at": "2025-01-15T00:00:00Z",
    "updated_at": "2025-01-15T00:00:00Z"
  }
]
```

### `POST /api/stores/{storeId}/surveys`
新規アンケートフォームを作成

**リクエストボディ**:
```json
{
  "form_name": "顧客アンケート",
  "liff_id": "1234567890-abcdefgh",
  "template_config": {
    "questions": [ ... ]
  }
}
```

**レスポンス**: 作成されたアンケートフォームオブジェクト（201 Created）

**注意**: `template_config`が指定されない場合、デフォルトの12問の質問テンプレートが使用されます

### `GET /api/surveys/{id}`
個別アンケートフォームを取得

**パラメータ**:
- `id` (string): アンケートフォームID（12文字ランダム文字列）

**レスポンス**: アンケートフォームオブジェクト

### `PUT /api/surveys/{id}`
アンケートフォームを更新

**リクエストボディ**:
```json
{
  "config": {
    "basic_info": { ... },
    "questions": [ ... ],
    "ui_settings": { ... }
  },
  "status": "active"
}
```

**レスポンス**: 更新されたアンケートフォームオブジェクト

### `DELETE /api/surveys/{id}`
アンケートフォームを削除

**レスポンス**:
```json
{
  "success": true,
  "message": "アンケートフォームを削除しました"
}
```

### `POST /api/surveys/{id}/deploy`
アンケートフォームを静的HTMLとしてSupabase Storageにデプロイ

**リクエストボディ**:
```json
{
  "storeId": "xyz789"
}
```

**レスポンス**:
```json
{
  "deployed_at": "2025-01-15T00:00:00Z",
  "deploy_url": "https://nas-rsv.com/api/public-form/prod/forms/{storeId}/{id}/config/current.html",
  "storage_url": "https://[project-ref].supabase.co/storage/v1/object/public/forms/...",
  "status": "deployed",
  "environment": "production"
}
```

---

## 🌐 公開フォーム（Public Form）API

### `GET /api/public-form/[...path]`
Supabase StorageからフォームHTMLをプロキシ配信

**パラメータ**:
- `path` (string[]): Supabase Storage内のパス（例: `reservations/{storeId}/{formId}/index.html` または `surveys/{storeId}/{formId}/index.html`）

**クエリパラメータ**:
- `v` (number, optional): キャッシュバスティング用のタイムスタンプ

**レスポンス**: HTMLコンテンツ（Content-Type: `text/html; charset=utf-8`）

**注意**: 
- このAPIはSupabase StorageからHTMLファイルを取得し、正しいContent-Typeヘッダーで配信します
- キャッシュバスティングのため、`v`パラメータが指定されている場合はキャッシュを無効化します
- 環境に応じて自動的に適切なSupabaseプロジェクトのStorageから取得します

---

## 🖼️ 画像アップロード（Upload）API

### `POST /api/upload/menu-image`
メニュー画像をSupabase Storageにアップロード

**リクエスト**: `multipart/form-data`
- `file` (File): 画像ファイル（最大5MB）
- `storeId` (string): 店舗ID
- `menuId` (string): メニューID
- `submenuId` (string, optional): サブメニューID

**レスポンス**:
```json
{
  "url": "https://[project-ref].supabase.co/storage/v1/object/public/forms/menu_images/{storeId}/{menuId}.jpg"
}
```

**注意**: 環境に応じて自動的に適切なSupabaseプロジェクトのStorageにアップロードされます

---

## 👥 店舗管理者（Store Admins）API

### `GET /api/stores/{storeId}/admins`
店舗の管理者一覧を取得（サービス管理者用）

**認証**: サービス管理者のみ

**レスポンス**:
```json
[
  {
    "id": "uuid-here",
    "user_id": "uuid-here",
    "store_id": "uuid-here",
    "email": "admin@example.com",
    "created_at": "2025-01-15T00:00:00Z"
  }
]
```

### `POST /api/stores/{storeId}/admins`
店舗管理者を追加

**リクエストボディ**:
```json
{
  "email": "admin@example.com"
}
```

**レスポンス**:
```json
{
  "success": true,
  "admin": {
    "id": "uuid-here",
    "user_id": "uuid-here",
    "store_id": "uuid-here",
    "email": "admin@example.com",
    "created_at": "2025-01-15T00:00:00Z"
  }
}
```

### `DELETE /api/stores/{storeId}/admins/{userId}`
店舗管理者を削除

**レスポンス**:
```json
{
  "success": true,
  "message": "店舗管理者を削除しました"
}
```

---

## 📊 予約分析（Reservation Analytics）API

### `GET /api/stores/{storeId}/reservations/analytics`
店舗の予約分析データを取得

**認証**: サービス管理者または店舗管理者

**レスポンス**:
```json
{
  "total": 100,
  "byStatus": {
    "pending": 10,
    "confirmed": 70,
    "cancelled": 15,
    "completed": 5
  },
  "byMonth": [
    {
      "month": "2025-01",
      "count": 30
    }
  ],
  "recentReservations": [ ... ]
}
```

---

## 🔐 認証（Auth）API

### `POST /api/auth/set-cookie`
認証トークンをクッキーに設定

**リクエストボディ**:
```json
{
  "accessToken": "jwt-token-here"
}
```

**レスポンス**:
```json
{
  "success": true
}
```

### `GET /api/auth/verify`
認証トークンを検証

**レスポンス**:
```json
{
  "valid": true,
  "user": {
    "id": "uuid-here",
    "email": "user@example.com"
  }
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
| 店舗ID形式 | `st{timestamp}` | 6文字ランダム文字列 `[a-z0-9]{6}` または UUID（既存データ） |
| サブドメイン | 未対応 | 対応（例: `st0001.nas-rsv.com`） |
| カスタムドメイン | 未対応 | 対応（例: `example.com`） |
| フォームID形式 | 12文字ランダム | 12文字ランダム |
| 認証 | スキップ | 必須 |
| RLS | 無効 | 有効（一部） |
| ストレージ | ローカルファイル | Supabase Storage |

---

## 📚 関連ドキュメント

- [データベース設計](../README.md#-データベース設計supabase)
- [認証システム](../README.md#-認証システム)
- [セットアップガイド](./SETUP.md)

---

**最終更新**: 2025年12月

