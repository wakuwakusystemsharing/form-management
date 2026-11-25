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
店舗の一覧を取得

**認証**: 必要。**運営（マスター管理者・システム管理者）だけ**。マスター管理者 = 全店舗 / システム管理者 = 同じテナントの店舗 / 店舗管理者 = `403` / 未ログイン = `401`。local は認証スキップ

Google カレンダー連携の鍵（`google_calendar_refresh_token`）は返さない

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
個別店舗の詳細を取得。**見ている人で返す内容が変わる**（`src/lib/store-view.ts`）

**パラメータ**:
- `storeId`: 店舗ID
- `full=1`（任意）: 管理画面からの呼び出し用。ログインしていなければ `401`、その店舗にアクセスできなければ `403` を返す（付けないと、未ログインでも下の「最小限」が `200` で返る）

**レスポンス**:

| 見ている人 | 返す内容 |
|---|---|
| ログインしていない人 / その店舗にアクセスできない人 | `id` / `name` / `logo_url` / `theme_color` だけ（店舗管理者ページのログイン画面用） |
| 店舗管理者 | 店舗オブジェクト。`line_channel_access_token` は返さず、代わりに `line_channel_access_token_set`（設定済みか）を返す |
| 運営（マスター管理者・システム管理者） | 店舗オブジェクト（`line_channel_access_token` を含む。店舗編集で使う） |

`google_calendar_refresh_token` は誰にも返さない

### `PUT /api/stores/{storeId}`
店舗情報を更新

**認証**: 必要。**運営（マスター管理者・システム管理者）だけ**（店舗管理者 = `403` / 未ログイン = `401`。local は認証スキップ）

送られてきても反映しない項目: `id` / `created_at` / `google_calendar_refresh_token` / `org_id`（テナントの付け替えはマスター管理者だけ）

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
  "follow_enabled": true,
  "follow_base": "reservation_date",
  "follow_days_after": 7,
  "follow_time": "12:00",
  "follow_template": { "header_title": "", "body_text": "{LINE名}様 先日はありがとうございました" }
}
```

**フォローメッセージ設定の検証**（指定されたキーのみ。不正時は 400 + 日本語メッセージ）:
- `follow_enabled`: boolean
- `follow_base`: `'reservation_date'` | `'created_at'`
- `follow_days_after`: `1, 2, 3, 5, 7, 10, 14, 21, 30, 45, 60` のいずれか
- `follow_time`: `HH:00`
- `follow_template`: `reminder_template` と同じ形（文字列 / boolean のみ。本文 2000 文字以内）

### `DELETE /api/stores/{storeId}`
店舗を削除（関連フォーム・予約も削除）

**認証**: 必要。**運営だけ**（店舗管理者 = `403` / 未ログイン = `401`）

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
予約一覧を取得（ログイン必須。マスター管理者 = 全店舗 / システム管理者 = 同じテナントの店舗 / 店舗管理者 = 自分の店舗。範囲外の `store_id` は 403。1000 件を超えても全件を返す）

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
新規予約を作成（顧客向け、認証不要）

**リクエストボディ**:
```json
{
  "form_id": "12-char-id",
  "store_id": "6-char-id",
  "customer_name": "山田太郎",
  "customer_phone": "090-1234-5678",
  "customer_email": "customer@example.com",
  "selected_menus": [ ... ],
  "selected_options": [ ... ],
  "reservation_date": "2026-04-30",
  "reservation_time": "14:00",
  "customer_info": { ... },
  "line_user_id": "U...",
  "line_display_name": "山田太郎",
  "source_medium": "line",
  "booking_mode": "calendar"
}
```

**レスポンス**: 作成された予約オブジェクト（201 Created）

**エラー: 409 Conflict（同時予約数制限）**:
```json
{
  "error": "既にご予約があります。予約日時が過ぎてから再度ご予約ください。",
  "code": "concurrent_reservation_limit"
}
```
`form.config.calendar_settings.max_concurrent_reservations_per_user` が 1 以上のときに発火。`line_user_id` または `customer_phone` で同一ユーザー判定。

**サーバー側の付加処理**（fire-and-forget、失敗してもレスポンスには影響しない）:
- CRM 顧客テーブルへの自動紐付け / 来店履歴作成
- Google Calendar イベント作成（`booking_mode === 'calendar'` のときのみ）
- メール送信（`form_type === 'web'` のときのみ、Resend 経由）

### `GET /api/stores/{storeId}/reservations`
店舗の予約一覧を取得（店舗管理者用）

**クエリパラメータ**: `/api/reservations` と同じ

**注意**: キャンセル済み（`status: 'cancelled'`）の予約はデフォルトで除外されます。

### `PATCH /api/reservations/{reservationId}`
予約ステータスを更新（管理者用）

**リクエストボディ**:
```json
{
  "status": "confirmed"
}
```

**有効なステータス**: `pending`, `confirmed`, `cancelled`, `completed`

**レスポンス**: 更新された予約オブジェクト

**注意**:
- `expected_updated_at`（任意。画面が持っている予約の `updated_at`）を付けると、その後にほかの人が予約を変更していた場合は保存せず `409 { "code": "stale" }` を返します（予約カレンダーのドラッグで使用）。付けなければ今までどおり保存します
- `cancelled` に変更した場合、予約に紐づく Google Calendar イベントも自動削除されます
- カレンダーイベント削除に失敗しても、予約ステータスの更新は成功として返されます

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
  "deploy_url": "https://nas-rsv.com/api/public-form/surveys/{storeId}/{id}/index.html",
  "storage_url": "https://[project-ref].supabase.co/storage/v1/object/public/forms/...",
  "status": "deployed",
  "environment": "production"
}
```

---

## 🎯 抽選フォーム（Lottery Forms）API

LINE LIFF 専用の抽選フォーム。設計と画面仕様は `docs/抽選フォーム_実装設計.md` を参照。
管理 API はすべて `authorizeStoreAccess`（マスター / システム管理者 / 店舗管理者）で保護（local 環境はスキップ）。

### `GET /api/stores/{storeId}/lotteries`
抽選フォーム一覧。各フォームに `stats`（`entries` / `wins` / `redeemed` / `prize_counts`）を付けて返す。

### `POST /api/stores/{storeId}/lotteries`
作成。`{ form_name, liff_id?, lottery_type?: 'instant' | 'deferred', template_config? }`。後日抽選は店舗の LINE チャネルアクセストークンが必須（local を除く）。

### `GET /api/lotteries/{id}` / `PUT /api/lotteries/{id}` / `DELETE /api/lotteries/{id}`
取得（公開）/ 更新（`{ config, status? }`。確率合計・在庫・締切・事前質問を検証し、不備は 400 + `details[]`）/ 削除（履歴もカスケード）。
抽選履歴がある状態での抽選方式の変更、抽選実行後の賞品変更は 400。

### `POST /api/lotteries/{id}/duplicate` / `POST /api/lotteries/{id}/deploy`
複製（履歴はコピーしない。賞品 ID は振り直し）/ 静的 HTML を `lotteries/{storeId}/{formId}/index.html` へデプロイ（LIFF ID 必須）。

### `POST /api/lotteries/draw`（公開）
抽選の実行 / 後日抽選の応募。

```json
{
  "lottery_form_id": "abc123def456",
  "store_id": "xyz789",
  "id_token": "<LIFF の ID トークン>",
  "line_display_name": "太郎",
  "line_friend_flag": true,
  "answers": { "お名前": "太郎" }
}
```

- ID トークンは LINE の verify API で検証（チャネル ID は `stores.line_channel_id` → `NEXT_PUBLIC_LINE_CHANNEL_ID`）。local 環境は `line_user_id` の申告で代用
- レスポンス: `{ entry, prize, message_text, second_message, is_existing }`
- 409（回数上限）: `{ error, existing_result }` で前回の結果を返す。403（期間外・非公開・友だち必須）、400（必須質問未回答）、410（全賞品在庫切れで受付終了）

### `GET /api/lotteries/{id}/my-result?id_token=`（公開） / `PATCH`
直近結果の再表示 / `{ id_token, message_sent: true }` で LIFF 送信完了を記録。仮当選（provisional）は賞品を返さず応募済みとして返す。

### `GET /api/lotteries/qr/{token}.png`（公開）
当選 QR コードの PNG。QR の中身は `{baseUrl}/r/{token}`。

### `GET /api/stores/{storeId}/lotteries/entries`
抽選履歴。`form_id` / `prize_id` / `status`（`all|entered|provisional|drawn|lost|redeemed|cancelled|expired`）/ `search` / `from` / `to` / `customer_id` / `limit` / `offset`。
レスポンス: `{ entries: LotteryEntryView[], total, limit, offset }`（`effective_status` で期限切れを判定済み）。

### `PATCH /api/stores/{storeId}/lotteries/entries/{entryId}`
`{ action: 'redeem' | 'unredeem' | 'cancel' | 'restore', note? }`。期限切れ・二重引換は拒否。`cancel` は在庫・回数のカウントから外れる。

### `GET /api/stores/{storeId}/lotteries/entries/export`
CSV（UTF-8 BOM）。クエリは一覧と同じ。

### `GET /api/stores/{storeId}/lotteries/redeem/{qrToken}`
QR トークン（32 文字）または 6 桁コードで当選内容を照会。`{ entry, prize, form_title, can_redeem, reason }`。他店舗の当選は 404。

### 後日抽選: `/api/lotteries/{id}/deferred/*`
- `GET summary` - `{ applicants, provisional[], winners[], unnotified, prize_capacity, is_closed, deferred_draw_status }`
- `POST draw` - `{ force?: boolean }`。締切前は `force` が必要。再実行で仮当選を引き直す
- `PATCH winners` - `{ remove?: entryId[], add?: [{ entry_id, prize_id }] }`。当選数超過は 400
- `POST confirm` - 確定（provisional → drawn、entered → lost）+ 当選者へ Flex push。`{ notified, failed, lost, ... }`
- `POST resend` - 未通知の当選者に再送

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

## 🧭 流入経路（Reservation Sources）API

店頭ポップ・チラシ・Instagram など、置き場所ごとの URL / QR コードを発行し、どこから予約が入ったかを記録する。

### `GET /api/stores/{storeId}/reservation-sources`
経路の一覧と、選べる予約フォーム

**認証**: 必要（店舗へのアクセス権。local はスキップ）

**レスポンス**:
```json
{
  "sources": [
    {
      "id": "uuid", "store_id": "abc123", "form_id": "g3v71mxst30e", "name": "店頭ポップ", "code": "fr5sfvkz",
      "active": true, "click_count": 12,
      "entry_url": "https://…/s/fr5sfvkz", "form_name": "予約フォーム", "form_status": "ok"
    }
  ],
  "forms": [{ "id": "g3v71mxst30e", "name": "予約フォーム", "status": "ok" }],
  "max": 100
}
```
`form_status` / `status`: `ok` / `needs_deploy`（古い HTML のまま。フォームを更新すると経路が記録されるようになる）/ `no_url`（開く URL が無い）/ `missing`（フォームが削除されている）

### `POST /api/stores/{storeId}/reservation-sources`
経路を作る。`{ "name": "店頭ポップ", "form_id": "g3v71mxst30e" }`（名前は 40 文字まで。フォームはその店舗のものだけ。1 店舗 100 件まで）。`201` で経路を返す

### `PUT /api/stores/{storeId}/reservation-sources/{id}`
`{ "name"?, "form_id"?, "active"? }`。経路は削除できない（`active: false` で停止）。他の店舗の経路は `404`

### `GET /api/stores/{storeId}/reservation-sources/{id}/qr`
QR コードの PNG（中身は `entry_url`）。`?download=1` で保存用のヘッダーを付ける

### `GET /api/stores/{storeId}/reservation-sources/stats`
経路ごとの集計

**認証**: 必要（店舗へのアクセス権。local はスキップ）

**クエリ**: `date_from` / `date_to`（予約日。YYYY-MM-DD。形がおかしいと `400`）、`form_id`（予約のフォームで絞り込む）

**レスポンス**:
```json
{
  "rows": [
    {
      "source_id": "uuid", "code": "fr5sfvkz", "name": "店頭ポップ", "active": true, "form_id": "g3v71mxst30e",
      "click_count": 12, "count": 3, "cancelled": 1, "revenue": 15000, "total_bookings": 5, "booking_rate": 0.4167
    }
  ],
  "none": { "count": 20, "cancelled": 2, "revenue": 98000 },
  "summary": { "count": 23, "with_source": 3, "cancelled": 3, "revenue": 113000 },
  "period": { "date_from": "2026-11-01", "date_to": "2026-11-30" },
  "form_id": null
}
```
- `count` / `revenue`: 期間内の予約（キャンセル済みを除く）。`cancelled`: 期間内のキャンセル数。売上はメニュー + オプション + 宿泊料金 + 指名料
- `rows` は予約数の多い順。停止した経路・予約が 0 件の経路も含む。`form_id` で絞り込んだときは、そのフォームを開く経路と、そのフォームで予約が入った経路だけ
- `none`: 経路の無い予約（経路の URL を通らずに入った予約）
- `click_count` / `total_bookings` / `booking_rate`: **期間・フォームに依らない累計**。`booking_rate` = `total_bookings`（キャンセルを含む）÷ `click_count`（0〜1。読まれた数が 0 なら `null`）。目安
- 経路が 1 つも無い店舗は `rows: []`（予約は読まない）。件数・金額だけを返し、お客様の情報は返さない

### `GET /s/{code}`
経路の URL（公開）。「読まれた数」を 1 増やして、予約フォームへ `302` で移動する（`?src={code}` 付き）。停止中の経路は `?src=` を付けず、数えない。検索ロボットらしいアクセスは数えない。存在しない合言葉は `404`

### 予約への記録
`POST /api/reservations` の `source_code`（フォームが URL の `?src=` から読んで送る）。その店舗の有効な経路の合言葉だけ `reservations.source_code` に記録する。それ以外（でたらめ・他の店舗・停止中・手動予約）は記録せず、予約は成功する

---

## 📊 予約分析（Reservation Analytics）API

### `GET /api/stores/{storeId}/rich-menus`
リッチメニュー（公式 LINE のトーク画面の下に出るメニュー）の一覧

**認証**: 必要（店舗へのアクセス権。local はスキップ）

**レスポンス**:
```json
{
  "menus": [
    {
      "id": "uuid", "name": "いつものメニュー", "size": "small", "image_url": "https://…/richmenu_xxx.jpg",
      "areas": [ { "id": "a1", "x": 0, "y": 0, "w": 0.5, "h": 1, "action": { "type": "message", "text": "予約確認" } } ],
      "chat_bar_text": "メニュー", "open_by_default": true,
      "status": "published", "is_default": true, "dirty": false, "line_rich_menu_id": "richmenu-…", "last_error": null, "published_at": "…"
    }
  ],
  "forms": [ { "id": "g3v71mxst30e", "name": "カット予約", "openable": true } ],
  "max": 20,
  "has_token": true,
  "local": false,
  "external_notice": null
}
```
- `areas[].x / y / w / h`: 画像全体に対する割合（0〜1）。`action.type`: `form`（`form_id`）/ `uri`（`uri`）/ `message`（`text`）/ `switch`（`menu_id` = 別のメニューに切り替える）/ `none`
- 全員向けのメニュー = `status: "published"` + `is_default: true`。切り替え先として一緒に出ているメニュー = `status: "published"` + `is_default: false`
- `status`: `draft` = 下書き / `publishing` = 反映の途中 / `published` = 反映中 / `failed` = 反映に失敗（理由は `last_error`）。`dirty` = 反映したあとに内容を変えた
- `external_notice`: ほかの場所（公式 LINE の管理画面など）で全員向けのメニューが変えられているときの文言。無ければ `null`
- `menus[].rule`: お客様ごとのメニューの条件 `{ "audience": { 配信の「配信先の条件」と同じ形 }, "order": 0 }`。全員向け・切り替え先のメニューは `null`。お客様ごとのメニューを出しているときは `status: "published"` + `is_default: false`
- `rule_unavailable`: お客様ごとのメニューを使えないときの理由（チャネルシークレットが未登録・マイグレーションが未適用）。使えるときは `null`。`rules_max`: 出せる数（5）。`link_counts`: メニュー ID → いま設定している人数

### `POST /api/stores/{storeId}/rich-menus` / `PUT /api/stores/{storeId}/rich-menus/{id}`
下書きを作る / 内容を保存する（保存しただけでは公式 LINE には出ない）

**リクエスト**: `{ name, size: "large" | "small", image_url, areas, chat_bar_text, open_by_default }`

- 名前は必須・40 文字まで、バーの文言は 14 文字まで、ボタンは 20 個まで。範囲が重なっている・小さすぎると `400`
- 画像・ボタンの動きは、保存のときは未設定でもよい（反映のときに確かめる）
- 反映の途中は `409`。ほかの店舗のメニューは `404`

### `POST /api/stores/{storeId}/rich-menus/{id}/publish`
全員向けのメニューとして公式 LINE に反映する（LINE に新しいメニューを作る → 画像を送る → 全員向けにする → 古いメニューを消す）

**レスポンス**: `{ "menu": { … }, "notice": null }`（local は LINE と通信せず、`notice` に理由が入る）

- 「別のメニューに切り替える」のボタンがあるときは、切り替えでつながっているメニュー（5 個まで）も一緒に LINE に作る。全員向けになるのは、このメニューだけ
- `400`: 画像が無い・大きさが合わない・1MB を超える / 動きのあるボタンが無い / 消えたフォームを指すボタンがある / 切り替え先が未選択・自分自身・消えている・多すぎる / LINE のトークンが未登録（複数のメニューを出すときは、文言の先頭に「「メニュー名」— 」が付く）
- `409`: 反映の途中（2 回押したとき）
- `502`: LINE に断られた・通信できなかった（何も変わらない。反映中だったメニューは、古いものがそのまま出ている）

**お客様ごとのメニュー**（`rule` があるメニュー）に対して呼ぶと、全員向けにはせず、条件に合うお客様にだけ設定する。レスポンスに `summary`（「設定 3 人 / 解除 0 人 / 変更なし 12 人」）が入る
- `400`: チャネルシークレットが未登録 / 条件が 1 つも無い / 「別のメニューに切り替える」のボタンがある / 5 個を超える

### `POST /api/stores/{storeId}/rich-menus/sync`
お客様ごとのメニューの設定を、いまの条件に合わせて見直す（条件に合うようになった人に設定し、合わなくなった人は外す）

**レスポンス**: `{ "linked": 1, "unlinked": 1, "unchanged": 12, "failed": 0, "deferred": 0, "menus": 2, "summary": "設定 1 人 / 解除 1 人 / 変更なし 12 人" }`

- `failed`: LINE に断られて設定できなかった人数 / `deferred`: 時間切れで次の回に回した人数（どちらも次の見直しでもう一度行う）

### `POST /api/stores/{storeId}/rich-menus/rule-order`
お客様ごとのメニューの優先順位を変える（条件が重なるお客様には、上にあるメニューが出る）

**リクエスト**: `{ "ids": ["上から順のメニュー ID", "…"] }`

### `POST /api/cron/rich-menu-sync`
お客様ごとのメニューを出している全店舗の見直し（pg_cron から 1 日 1 回。`Authorization: Bearer <Service Role Key>`。違えば `401`）

### `POST /api/stores/{storeId}/rich-menus/{id}/unpublish`
反映をやめる（全員向けの設定を外す。公式 LINE の管理画面で設定したメニューに戻る）。メニューは下書きに戻る。切り替え先として一緒に出していたメニューも下書きに戻る。切り替え先だけのメニューに対して呼ぶと `409`（元のメニューの反映をやめる）

### `DELETE /api/stores/{storeId}/rich-menus/{id}`
削除する。反映中のメニュー・ほかのメニューの切り替え先になっているメニューは `409`

### `GET /api/stores/{storeId}/reservations/calendar`
予約カレンダー用のデータ（期間に掛かる予約 + 予約以外の予定の時間）

**認証**: 必要（店舗へのアクセス権。local はスキップ）

**クエリ**: `from` / `to`（YYYY-MM-DD。必須。最大 62 日。形がおかしい・逆順・長すぎると `400`）、`staff=1`（スタッフごとの Google カレンダーの予定も返す。日表示のスタッフごとの列で使う）

**レスポンス**:
```json
{
  "from": "2026-11-22",
  "to": "2026-11-28",
  "reservations": [ { "id": "…", "reservation_date": "2026-11-24", "reservation_time": "10:00", "status": "confirmed", "…": "予約一覧と同じ行" } ],
  "busy": [ { "date": "2026-11-25", "startMin": 600, "endMin": 690, "allDay": false } ],
  "google": "ok"
}
```
- `reservations`: その期間に掛かる予約（キャンセル済みを含む。宿泊はチェックイン日 〜 チェックアウト日が期間に掛かるもの）。日付 → 時刻の順
- `busy`: 予約以外の予定（店舗の Google カレンダー）。日本時間の日付と「0 時からの分」。このシステムの予約から作った予定と「営業日」の予定は含まない。**タイトルなどの中身は返さない**
- `google`: `ok` = 予定を読めた / `none` = カレンダー未設定（local を含む）/ `error` = 読み込みに失敗（予約だけ返す）
- `staff_busy`: `staff=1` のとき、スタッフ名 → そのスタッフの Google カレンダーの予定（`busy` と同じ形。`{ "佐藤": [ … ] }`）。スタッフ選択が ON のフォームのスタッフが対象。カレンダー ID は返さない。付けなければ `{}`
- `staff_google`: `ok` / `none` = スタッフのカレンダーが無い・`staff=1` なし / `error` = 1 つでも読めなかった

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
| フォームID形式 | 12文字ランダム | 12文字ランダム |
| 認証 | スキップ | 必須 |
| RLS | 無効 | 有効（一部） |
| ストレージ | ローカルファイル | Supabase Storage |

---

## 📡 Webhook API

### `POST /api/webhooks/line`
LINE Messaging API からの Webhook イベントを受信

**認証**: 不要（店舗の指定はクエリ `storeId`）

**リクエストヘッダー**:
- `x-line-signature`: LINE が付与する HMAC-SHA256 署名

**署名チェック**: チャネルシークレットを登録した店舗だけ確認する（合わなければ `401 { error: '署名が正しくありません' }`）。**未登録の店舗は確認せずに受け付ける**。登録は下の `line-webhook` API

**処理内容**:
- 予約確認・キャンセルメッセージの受信と処理
- LINE ユーザーへの返信・プッシュ通知

**レスポンス**:
```json
{ "success": true }
```

### `GET / PUT / DELETE /api/stores/{storeId}/line-webhook`
LINE Webhook の署名チェックの設定（チャネルシークレット）

**認証**: 運営（マスター管理者・システム管理者）だけ。店舗管理者は 403。local は認証スキップ

- `GET`: 状態を返す
- `PUT`: `{ "channel_secret": "英数字 32 文字" }` を登録 / 上書き（形式が違えば 400）
- `DELETE`: 削除（署名のチェックをやめる）

**レスポンス**（3 つとも同じ。シークレットそのものは返さない）:
```json
{ "secret_set": true, "updated_at": "2026-11-20T00:00:00.000Z", "webhook_url": "https://…/api/webhooks/line?storeId=abc123" }
```

### `GET / PUT /api/stores/{storeId}/chat-settings`
1 対 1 トークの設定（お客様が公式 LINE に送ったメッセージを保存するか・会話の保存期間）

**認証**: 運営（マスター管理者・システム管理者）だけ。店舗管理者は自分の店舗でも 403。local は認証スキップ

- `GET`: 設定と、保存している会話の件数を返す
- `PUT`: `{ "enabled"?: boolean, "retention_years"?: 1 | 2 | 3 }`（指定した項目だけを変える）
  - 選べない値は 400
  - OFF → ON にできるのは、チャネルシークレットを登録した店舗だけ（未登録は `409`。理由を `error` に入れる）
  - マイグレーション未適用の環境は `409`
  - OFF にしても保存済みの会話は消さない（新しいメッセージを保存しなくなる）

**レスポンス**（2 つとも同じ。会話の中身・LINE ユーザー ID は返さない）:
```json
{
  "enabled": true,
  "retention_years": 1,
  "enabled_at": "2026-11-25T04:00:00.000Z",
  "updated_at": "2026-11-25T04:00:00.000Z",
  "secret_set": true,
  "enable_blocker": null,
  "stats": { "threads": 3, "messages": 12, "last_message_at": "2026-11-25T05:10:00.000Z" }
}
```

- `enable_blocker`: ON にできない理由（できるなら null）
- `stats`: 保存している会話の人数・通数・最後に届いた日時

**受信**: `POST /api/webhooks/line` が、トーク機能が ON の店舗・署名を確認できた通知について、お客様からのメッセージを保存する（LINE への応答を返したあと。保存に失敗しても応答は変わらない）

### `POST /api/stores/{storeId}/line-webhook/test`
接続を確認（LINE に登録されている Webhook URL がこの店舗のものか + LINE からテストの通知を受け取れるか）。local では 400

**認証**: 運営だけ

**レスポンス**:
```json
{
  "ok": true,
  "endpoint": "https://…/api/webhooks/line?storeId=abc123",
  "active": true,
  "endpoint_status": "same",
  "test_success": true,
  "messages": ["LINE からの通知を受け取れました。署名のチェックも通っています。"]
}
```
`endpoint_status`: `same`（この店舗）/ `other_store`（このシステムの別の店舗）/ `other`（別の URL）/ `none`（未登録）/ `unknown`（取得できない）

---

## 📅 Google Calendar 連携 API

### `GET /api/integrations/google-calendar/connect`
Google OAuth 認証フローを開始（Google へリダイレクト）

**クエリパラメータ**:
- `store_id` (string, 必須): 店舗 ID

**レスポンス**: Google OAuth 認証ページへのリダイレクト

---

### `GET /api/integrations/google-calendar/callback`
Google OAuth コールバック処理。リフレッシュトークンを暗号化して stores テーブルに保存。

**クエリパラメータ**: Google から付与される `code`、`state`

**レスポンス**: 店舗管理画面へリダイレクト

---

### `GET /api/stores/{storeId}/calendar`
カレンダー連携状態を取得

**レスポンス**:
```json
{
  "google_calendar_id": "calendar-id@group.calendar.google.com",
  "google_calendar_source": "store_oauth"
}
```

---

### `PUT /api/stores/{storeId}/calendar`
カレンダー ID を手動設定

**リクエストボディ**:
```json
{
  "google_calendar_id": "calendar-id@group.calendar.google.com"
}
```

---

### `POST /api/stores/{storeId}/calendar/disconnect`
Google Calendar 連携を解除（OAuth トークンを削除）

**レスポンス**:
```json
{ "success": true }
```

---

### `GET /api/stores/{storeId}/calendar/list`
店舗 OAuth 連携中のアカウントから、書き込み可能なカレンダー一覧を取得（ダイアログでカレンダー切替に使用）

**前提**: `google_calendar_source === 'store_oauth'` の店舗のみ。SA モードの店舗では 400 エラー。

**レスポンス**:
```json
{
  "current_calendar_id": "user@gmail.com",
  "calendars": [
    {
      "id": "user@gmail.com",
      "summary": "メインカレンダー",
      "primary": true,
      "accessRole": "owner",
      "backgroundColor": "#4285F4"
    },
    {
      "id": "abc@group.calendar.google.com",
      "summary": "予約用",
      "primary": false,
      "accessRole": "owner",
      "backgroundColor": "#0B8043"
    }
  ]
}
```

`accessRole` が `writer` または `owner` のカレンダーのみ返却。

---

### `GET /api/stores/{storeId}/calendar/availability`
カレンダーの空き状況を取得（予約フォームの静的 HTML から呼ばれる）

**クエリパラメータ**:
- `start` (ISO 8601 datetime): 取得開始時刻
- `end` (ISO 8601 datetime): 取得終了時刻

**レスポンス**: イベント一覧（タイトル / 開始時刻 / 終了時刻 / location / description / isBusinessDay フラグ）

---

## 👤 CRM API（顧客管理）

**認証**: 全エンドポイントで店舗管理者以上の権限が必須（`getCurrentUser` + `checkStoreAccess`）。`local` 環境のみスキップ。`{customerId}` を取る操作では URL の `storeId` と顧客の `store_id` 整合性も確認し、不一致は 404 を返す（情報漏洩防止）。

### `GET /api/stores/{storeId}/customers`
顧客一覧を取得（ページネーション・検索対応）

**クエリパラメータ**:
- `search` (string): 名前・電話番号・メールでの部分一致検索（PostgREST or() フィルタ構文文字 `,` `(` `)` `\` は自動的にスペース化）
- `customer_type` (string): `new` / `regular` / `vip` / `inactive` のいずれかでフィルタ
- `segment` (string): `new` / `repeat` / `vip` / `dormant` のいずれかでフィルタ（自動算出セグメント）
- `limit` (number, default 50): 取得件数
- `offset` (number, default 0): オフセット

**レスポンス**:
```json
{
  "customers": [
    {
      "id": "uuid-here",
      "store_id": "abc123",
      "name": "山田太郎",
      "phone": "090-1234-5678",
      "email": "customer@example.com",
      "customer_type": "regular",
      "total_visits": 5,
      "total_spent": 25000,
      "first_visit_date": "2025-06-01",
      "last_visit_date": "2026-02-01",
      "average_visit_interval_days": 45,
      "line_user_id": "Uxxxxxxx",
      "line_friend_flag": true,
      "created_at": "2025-06-01T00:00:00Z"
    }
  ],
  "total": 100
}
```

### `POST /api/stores/{storeId}/customers`
顧客を作成（手動登録）

**リクエストボディ**:
```json
{
  "name": "山田太郎",
  "phone": "090-1234-5678",
  "email": "customer@example.com",
  "birthday": "1990-05-20",
  "gender": "male",
  "customer_type": "regular",
  "line_user_id": "Uxxxxxxx",
  "notes": "..."
}
```

**バリデーション**:
- `name` 必須
- `phone` の重複検出はハイフン・スペース無視で正規化（`090-1234-5678` と `09012345678` は同一扱い）
- 重複時は **409 Conflict + `{ error, existing_customer_id }`**

### `GET /api/stores/{storeId}/customers/{customerId}`
顧客詳細を取得

**レスポンス**: `{ customer, reservations, visits }`（予約履歴・来店履歴は最大 50 件、日付降順）
- `reservations[].follow_message`: フォローメッセージの配信状態（無ければ `null`）。`{ status: 'scheduled'|'sent'|'skipped'|'cancelled'|'superseded'|'failed', skip_reason: 'rebooked'|'reminder_same_day'|'store_disabled'|'no_token'|'reservation_cancelled'|null, scheduled_at, sent_at }`

### `PATCH /api/stores/{storeId}/customers/{customerId}`
顧客情報を更新

**更新可能フィールド**: `name` / `name_kana` / `phone` / `email` / `birthday` / `gender` / `customer_type` / `preferred_contact_method` / `allergies` / `medical_history` / `notes` / `tags`

**動作**:
- 空文字（`""`）は nullable フィールドで自動的に `null` に正規化される（`birthday` の DATE 型や `gender` の CHECK 制約違反による 500 を防止）
- 統計値（`total_visits` / `total_spent` 等）はここでは変更不可。`customer_visits` から自動再計算される

### `DELETE /api/stores/{storeId}/customers/{customerId}`
顧客を削除

**動作**:
- `customer_visits` / `customer_interactions` は **CASCADE 削除**
- `reservations.customer_id` / `surveys.customer_id` は **SET NULL**（予約レコード自体は残る）

### `GET /api/stores/{storeId}/customers/analytics`
顧客統計・分析データを取得

**レスポンス**:
```json
{
  "total_customers": 120,
  "segment_distribution": { "new": 30, "repeat": 50, "vip": 10, "dormant": 30 },
  "type_distribution": { "new": 30, "regular": 60, "vip": 10, "inactive": 20 },
  "monthly_new_customers": [{ "month": "2025-06", "count": 12 }],
  "gender_distribution": { "male": 40, "female": 70, "other": 5, "unknown": 5 },
  "age_distribution": [{ "age_group": "30代", "count": 40 }],
  "line_friend_rate": 75.0,
  "line_friend_connected": 60,
  "line_linked_customers": 80,
  "avg_visit_interval_days": 45,
  "repeat_rate": 41.7,
  "top_customers_by_revenue": [...],
  "segment_avg_spending": [...]
}
```

**注意**:
- `line_friend_rate` の分母は `line_user_id` を持つ顧客に限定（電話番号のみで登録された顧客は除外。`line_linked_customers` で分母値、`line_friend_connected` で分子値を確認できる）
- `avg_visit_interval_days` は来店 2 回以上の顧客のみで平均（来店 0〜1 回の顧客は除外）
- 年齢は誕生日未到来を考慮した実年齢で算出

---

## 🔍 プレビュー（Preview）API

### `POST /api/preview/generate`
フォームのプレビュー HTML を生成（保存前の編集状態をプレビュー可能）

**認証**: 必須（ローカル環境ではスキップ）

**リクエストボディ**:
```json
{
  "form": { ... },
  "storeId": "abc123",
  "formType": "reservation"
}
```

| パラメータ | 型 | 必須 | 説明 |
|-----------|------|------|------|
| `form` | object | ✅ | フォームオブジェクト（予約フォームまたはアンケートフォーム） |
| `storeId` | string | ✅ | 店舗ID |
| `formType` | string | ✅ | `"reservation"` または `"survey"` |

**レスポンス**: HTML コンテンツ（Content-Type: `text/html; charset=utf-8`）

**注意**:
- デプロイせずにフォームの現在の編集状態をプレビューするためのエンドポイント
- `Cache-Control: no-cache` でキャッシュ無効化

---

## ⚙️ 管理者設定 API

### `GET /api/admin/settings`
サービス全体設定を取得（Google API 認証情報等）

**認証**: サービス管理者のみ

### `PUT /api/admin/settings`
サービス全体設定を更新

---

## 📚 関連ドキュメント

- [データベース設計](../README.md#-データベース設計supabase)
- [認証システム](../README.md#-認証システム)
- [セットアップガイド](./SETUP.md)

---

**最終更新**: 2026年3月

