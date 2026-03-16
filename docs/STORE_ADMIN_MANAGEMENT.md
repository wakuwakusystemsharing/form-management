# 店舗管理者管理ガイド

このドキュメントでは、店舗管理者を追加・削除する方法を説明します。

## 概要

店舗管理者は、特定の店舗のダッシュボード（`/{storeId}/admin`）にアクセスできるユーザーです。サービス管理者が各店舗にアクセス可能なユーザーを割り当てることができます。

## 権限について

### 店舗管理者の権限
- 自店舗のダッシュボードにアクセス可能
- 自店舗のフォームを編集可能（ただし、LIFF ID は編集不可）
- 自店舗の予約データを閲覧・分析可能
- 自店舗のアンケートフォームを管理可能

### サービス管理者の権限
- 全店舗のダッシュボードにアクセス可能
- 全店舗のフォームを編集可能（LIFF ID も編集可能）
- 全店舗の予約データを閲覧・分析可能
- 店舗管理者の追加・削除が可能

## 店舗管理者の追加方法

### 方法 1: サービス管理者画面から追加（推奨）

1. **サービス管理者でログイン**
   - `/admin` にアクセス
   - サービス管理者アカウントでログイン

2. **店舗詳細ページに移動**
   - 店舗一覧から対象の店舗を選択
   - または `/admin/{storeId}` に直接アクセス

3. **「設定」タブを開く**
   - タブナビゲーションから「設定」を選択

4. **「店舗管理者管理」セクションで追加**
   - `StoreAdminManager` コンポーネント（`src/components/StoreAdminManager.tsx`）が表示されます
   - 「店舗管理者を追加」ボタンをクリック
   - 追加したいユーザーのメールアドレスを入力
   - 「追加」ボタンをクリック

### 方法 2: API 経由で追加

```bash
POST /api/stores/{storeId}/admins
Content-Type: application/json

{
  "email": "storeadmin@example.com"
}
```

> **注意**: `store_admins` テーブルに `role` カラムは存在しません（マイグレーション `20250128000000_sync_production_with_staging.sql` で削除済み）。全員 admin 扱いです。

## 重要な注意事項

### Supabase 環境（Staging/Production）の場合

**店舗管理者を追加する前に、必ず Supabase Auth でユーザーを作成する必要があります。**

#### 手順

1. **Supabase Dashboard でユーザーを作成**
   - Supabase Dashboard → Authentication → Users
   - 「Add user」をクリック
   - メールアドレスとパスワードを入力
   - 「Create user」をクリック

2. **サービス管理者画面から店舗管理者を追加**
   - `/admin/{storeId}` → 「設定」タブ → 「店舗管理者管理」
   - 作成したユーザーのメールアドレスを入力
   - 「追加」ボタンをクリック

#### エラーが発生した場合

- **「このメールアドレスのユーザーが見つかりません」**
  → Supabase Auth でユーザーが作成されていません。先に Supabase Dashboard でユーザーを作成してください。

- **「このユーザーは既に店舗管理者として登録されています」**
  → 既にそのユーザーは店舗管理者として登録されています。

### ローカル環境の場合

ローカル環境では、Supabase Auth のユーザー作成は不要です。メールアドレスを入力するだけで店舗管理者を追加できます。

- データは `data/store_admins_{storeId}.json` に保存されます
- 認証はスキップされるため、実際のユーザー作成は不要です

## 店舗管理者の削除方法

### サービス管理者画面から削除

1. `/admin/{storeId}` → 「設定」タブ → 「店舗管理者管理」
2. 削除したい店舗管理者の「削除」ボタンをクリック
3. 確認ダイアログで「削除」を確認

### API 経由で削除

```bash
DELETE /api/stores/{storeId}/admins/{userId}
```

## 店舗管理者の確認方法

### サービス管理者画面から確認

1. `/admin/{storeId}` → 「設定」タブ → 「店舗管理者管理」
2. 店舗管理者の一覧が表示されます

### API 経由で確認

```bash
GET /api/stores/{storeId}/admins
```

**レスポンス例**:
```json
[
  {
    "id": "uuid-here",
    "user_id": "uuid-here",
    "store_id": "st0001",
    "email": "storeadmin@example.com",
    "created_at": "2025-12-20T10:00:00.000Z"
  }
]
```

## API エンドポイント一覧

| メソッド | パス | 説明 |
|---------|------|------|
| `GET` | `/api/stores/{storeId}/admins` | 管理者一覧取得 |
| `POST` | `/api/stores/{storeId}/admins` | 管理者追加（メールアドレス招待） |
| `DELETE` | `/api/stores/{storeId}/admins/{userId}` | 管理者削除 |

## UI コンポーネント

`src/components/StoreAdminManager.tsx` が管理者追加・削除の UI を担当します。

- 現在の管理者一覧を表示
- メールアドレス入力フォームで新規管理者を追加
- 各管理者の削除ボタン

## データ構造

### ローカル環境

```
data/
└── store_admins_{storeId}.json
```

**ファイル形式**:
```json
[
  {
    "id": "admin_001",
    "user_id": "user_store_admin_001",
    "store_id": "st0001",
    "email": "storeadmin@example.com",
    "created_at": "2025-12-20T10:00:00.000Z",
    "updated_at": "2025-12-20T10:00:00.000Z"
  }
]
```

### Supabase 環境

**テーブル**: `store_admins`

| カラム | 型 | 説明 |
|--------|-----|------|
| `id` | UUID | 管理者 ID（自動生成） |
| `user_id` | UUID | ユーザー ID（auth.users 参照） |
| `store_id` | TEXT | 店舗 ID |
| `created_at` | TIMESTAMPTZ | 作成日時 |
| `updated_at` | TIMESTAMPTZ | 更新日時 |

> **注意**: `role` カラムは `20250128000000_sync_production_with_staging.sql` で削除されました。全管理者は同一権限（admin）です。

## ワークフロー

### 新規店舗管理者の追加フロー

```
1. Supabase Auth でユーザーを作成（Staging/Production 環境のみ）
   ↓
2. サービス管理者画面で店舗管理者を追加
   ↓
3. 店舗管理者がログインしてダッシュボードにアクセス
   ↓
4. 自店舗のフォーム・予約を管理
```

### ローカル環境での開発フロー

```
1. サービス管理者画面で店舗管理者を追加（メールアドレスのみ）
   ↓
2. data/store_admins_{storeId}.json に保存
   ↓
3. 認証をスキップしてダッシュボードにアクセス可能
```

## セキュリティ

- 店舗管理者は自店舗のデータのみアクセス可能（RLS で制御）
- サービス管理者は全店舗のデータにアクセス可能
- 店舗管理者は LIFF ID を編集できない（セキュリティ上の理由）

## 関連ドキュメント

- [API 仕様書](./API_SPECIFICATION.md)
- [アーキテクチャ](./ARCHITECTURE.md)
- [セットアップガイド](./SETUP.md)

---

**最終更新**: 2026年3月
