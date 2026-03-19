# GCP（Google Cloud Platform）セットアップガイド

Google Calendar 連携に必要な GCP 設定の手順書です。

## 前提

- Google アカウント（wakuwakusystemsharing@gmail.com）でログイン
- 本番用とステージング用で同じ GCP プロジェクトを共用可能

## 1. GCP プロジェクト作成

1. [Google Cloud Console](https://console.cloud.google.com/) にアクセス
2. 上部のプロジェクトセレクターから「新しいプロジェクト」をクリック
3. プロジェクト名: `wakuwaku-form-management`（任意）
4. 「作成」をクリック

## 2. Google Calendar API を有効化

1. 左メニュー → 「APIとサービス」→「ライブラリ」
2. 「Google Calendar API」を検索
3. 「有効にする」をクリック

## 3. サービスアカウント作成（方式A用）

カレンダーを持っていない店舗向けに、サービス管理者がカレンダーを作成する際に使用します。

### 3-1. サービスアカウントを作成

1. 左メニュー → 「APIとサービス」→「認証情報」
2. 「認証情報を作成」→「サービスアカウント」
3. サービスアカウント名: `form-management-calendar`
4. 「作成して続行」→ ロールは不要（スキップ可）→「完了」

### 3-2. JSON キーを発行

1. 作成したサービスアカウントをクリック
2. 「キー」タブ →「鍵を追加」→「新しい鍵を作成」
3. キーのタイプ: **JSON** を選択
4. 「作成」→ JSON ファイルがダウンロードされる

### 3-3. Vercel 環境変数に設定

1. [Vercel Dashboard](https://vercel.com/) → プロジェクト → Settings → Environment Variables
2. 以下を追加:

| Key | Value | 環境 |
|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | ダウンロードした JSON ファイルの中身をそのまま貼り付け | Production, Preview |

**注意:** JSON は1行にする必要はありません。Vercel は複数行の環境変数に対応しています。

### 3-4. ローカル開発用（任意）

`.env.local` に追加:
```
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"...","private_key_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"...@....iam.gserviceaccount.com",...}
```

## 4. OAuth クライアント作成（方式B用）

既に Google Calendar を使っている店舗が、自分のカレンダーに予約を反映させるために使用します。

### 4-1. OAuth 同意画面を設定

1. 左メニュー → 「APIとサービス」→「OAuth 同意画面」
2. User Type: **外部** を選択 →「作成」
3. アプリ情報:
   - アプリ名: `NAS 予約フォーム管理`（顧客に表示される名前）
   - ユーザーサポートメール: `wakuwakusystemsharing@gmail.com`
   - デベロッパーの連絡先: `wakuwakusystemsharing@gmail.com`
4. 「保存して次へ」

### 4-2. スコープを追加

1. 「スコープを追加または削除」をクリック
2. 以下のスコープを追加:
   - `https://www.googleapis.com/auth/calendar`
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/calendar.acls`
3. 「更新」→「保存して次へ」

### 4-3. テストユーザーを追加（公開前）

GCPプロジェクトが「テスト」ステータスの間は、登録したユーザーのみ OAuth フローを使用できます。

1. 「テストユーザー」→「ユーザーを追加」
2. テストで使用する Google アカウントのメールアドレスを追加
3. 「保存して次へ」→「ダッシュボードに戻る」

**本番公開時:** OAuth 同意画面を「公開」ステータスに変更する必要があります。Google の審査が必要になる場合があります。

### 4-4. OAuth クライアント ID を作成

1. 左メニュー → 「APIとサービス」→「認証情報」
2. 「認証情報を作成」→「OAuth クライアント ID」
3. アプリケーションの種類: **ウェブアプリケーション**
4. 名前: `NAS Form Management`
5. **承認済みのリダイレクト URI** に以下を追加:

| 環境 | URI |
|---|---|
| ローカル開発 | `http://localhost:3000/api/integrations/google-calendar/callback` |
| Staging | `https://form-management-staging.vercel.app/api/integrations/google-calendar/callback` |
| Production | `https://{本番ドメイン}/api/integrations/google-calendar/callback` |

6. 「作成」→ クライアント ID とクライアントシークレットが表示される

### 4-5. 暗号化キーを生成

店舗の OAuth リフレッシュトークンを暗号化するためのキーです。

ターミナルで実行:
```bash
openssl rand -hex 32
```

出力例: `a1b2c3d4e5f6...`（64文字の16進数文字列）

### 4-6. Vercel 環境変数に設定

| Key | Value | 環境 |
|---|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | 4-4 で取得したクライアント ID | Production, Preview |
| `GOOGLE_OAUTH_CLIENT_SECRET` | 4-4 で取得したクライアントシークレット | Production, Preview |
| `GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY` | 4-5 で生成した暗号化キー | Production, Preview |

### 4-7. ローカル開発用（任意）

`.env.local` に追加:
```
GOOGLE_OAUTH_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-xxxx
GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY=a1b2c3d4e5f6...
```

## 5. 設定確認チェックリスト

### 方式A（サービスアカウント）
- [ ] GCP プロジェクト作成済み
- [ ] Google Calendar API 有効化済み
- [ ] サービスアカウント作成 & JSON キー発行済み
- [ ] `GOOGLE_SERVICE_ACCOUNT_JSON` を Vercel に設定済み
- [ ] 管理画面で「カレンダー作成」ボタンが動作する

### 方式B（店舗OAuth連携）
- [ ] OAuth 同意画面設定済み（スコープ追加済み）
- [ ] テストユーザー追加済み（テスト段階の場合）
- [ ] OAuth クライアント ID 作成済み（リダイレクト URI 設定済み）
- [ ] 暗号化キー生成済み
- [ ] `GOOGLE_OAUTH_CLIENT_ID` を Vercel に設定済み
- [ ] `GOOGLE_OAUTH_CLIENT_SECRET` を Vercel に設定済み
- [ ] `GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY` を Vercel に設定済み
- [ ] 店舗管理画面で「Googleアカウントで連携」が動作する

## 環境変数一覧

| 環境変数 | 用途 | 必須 |
|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | 方式A: サービスアカウント認証 | 方式A使用時 |
| `GOOGLE_OAUTH_CLIENT_ID` | 方式B: OAuth クライアント ID | 方式B使用時 |
| `GOOGLE_OAUTH_CLIENT_SECRET` | 方式B: OAuth クライアントシークレット | 方式B使用時 |
| `GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY` | 方式B: トークン暗号化キー | 方式B使用時 |

## トラブルシューティング

### 「Google Calendar APIの認証情報が設定されていません」エラー
→ `GOOGLE_SERVICE_ACCOUNT_JSON` が未設定、または JSON が不正です。Vercel の Environment Variables を確認してください。

### OAuth フローで「redirect_uri_mismatch」エラー
→ GCP の OAuth クライアント設定で、リダイレクト URI が正確に一致しているか確認してください。末尾のスラッシュの有無にも注意。

### OAuth フローで「access_denied」エラー
→ GCP プロジェクトが「テスト」ステータスの場合、テストユーザーに登録されたアカウントでのみ認証できます。
