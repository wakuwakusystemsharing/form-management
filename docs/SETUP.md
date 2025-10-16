# 環境セットアップガイド

このドキュメントでは、dev / staging / production 環境の構築手順を説明します。

## 📋 前提条件

- Node.js 20 以上
- pnpm 9 以上 (npm/yarn 使用禁止)
- Vercel アカウント (staging/prod デプロイ用)
- Supabase プロジェクト (staging/prod 用)

## 🔧 ローカル開発環境 (dev)

### 1. リポジトリのクローン

```bash
git clone https://github.com/wakuwakusystemsharing/form-management.git
cd form-management
```

### 2. 依存関係のインストール

```bash
pnpm install
```

### 3. 環境変数の設定

```bash
cp .env.local.example .env.local
```

`.env.local` を編集:

```env
NEXT_PUBLIC_APP_ENV=local
# BLOB_READ_WRITE_TOKEN は未設定でOK (モックモード)
# Supabase 設定も不要 (JSON ファイル永続化)
```

### 4. 開発サーバー起動

```bash
pnpm dev
```

→ http://localhost:3000 でアクセス可能

### 5. 動作確認

- データは `data/*.json` に保存
- 静的HTML は `public/static-forms/` に出力
- Supabase は未接続 (JSON モード)

---

## 🧪 ステージング環境 (staging)

> **📌 重要**: Vercel プロジェクトは **1つ** で、ブランチごとに環境変数を分けます
> - `main` ブランチ → Production 環境変数を使用
> - `staging` ブランチ → Preview 環境変数を使用

### 1. Supabase プロジェクト作成

1. [Supabase Dashboard](https://supabase.com/dashboard) でプロジェクト作成
2. `staging-form-management` などの名前を推奨
3. SQL Editor で以下のマイグレーションを順番に実行:
   - `supabase/migrations/20250101000000_initial_schema.sql` - 初期スキーマ
   - `supabase/migrations/20250116000000_update_draft_status.sql` - draft_status フィールド更新（自動実行済みの場合はスキップ）

**注意**: Supabase MCPを使用している場合、マイグレーションは自動適用されています。

### 2. Vercel プロジェクト設定

1. Vercel で新規プロジェクトを作成
2. GitHub リポジトリ `wakuwakusystemsharing/form-management` を接続
3. **Production Branch** を `main` に設定
4. **Environment Variables** を環境ごとに設定:

#### 必須環境変数 (Preview 環境 = Staging)

Vercel Dashboard → Settings → Environment Variables で **Preview** にチェック:

```
NEXT_PUBLIC_APP_ENV=staging
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_xxxx (Staging 用トークン)
NEXT_PUBLIC_SUPABASE_URL=https://xxx-staging.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... (Staging)
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... (Staging 秘密鍵)
```

**重要**: Preview 環境は `staging` ブランチのデプロイに適用されます

### 3. Vercel Blob Storage 設定

1. Vercel Dashboard > Storage > Create Database > Blob
2. **Staging 専用の Blob ストレージ** を作成推奨
3. `BLOB_READ_WRITE_TOKEN` をコピーして環境変数に設定

### 4. デプロイ

```bash
git push origin staging
```

→ Vercel が自動で Preview デプロイ

### 5. 動作確認

- データは Supabase に保存
- 静的HTML は Vercel Blob (`staging/forms/`) に出力
- RLS で店舗別アクセス制御が有効

---

## 🚀 本番環境 (production)

### 1. Supabase 本番プロジェクト作成

1. Supabase Dashboard で **本番用プロジェクト** を新規作成
2. `prod-form-management` などの名前を推奨
3. SQL Editor で `supabase/migrations/20250101000000_initial_schema.sql` を実行

### 2. Vercel 本番環境変数設定

同じ Vercel プロジェクトで、Vercel Dashboard > Settings > Environment Variables で **Production** にチェック:

```
NEXT_PUBLIC_APP_ENV=production
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_yyyy (Production 用トークン、Staging と別)
NEXT_PUBLIC_SUPABASE_URL=https://yyy-prod.supabase.co (本番 Supabase URL、Staging と別)
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... (本番)
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... (本番秘密鍵)
```

**重要**: Production 環境は `main` ブランチのデプロイに適用されます

### 3. Vercel Blob Storage (本番用)

1. Vercel Dashboard > Storage > Create Database > Blob
2. **Production 専用の Blob ストレージ** を作成
3. `BLOB_READ_WRITE_TOKEN` を本番環境変数に設定

### 4. デプロイ

```bash
git push origin main
```

→ Vercel が自動で Production デプロイ

### 5. 動作確認

- データは本番 Supabase に保存
- 静的HTML は Vercel Blob (`prod/forms/`) に出力
- RLS で本番データが保護される

---

## 🔐 環境変数の管理

### ローカルで Vercel 環境変数を同期

```bash
pnpm vercel env pull .env.local
```

→ Vercel の環境変数をローカルに取得

### 環境変数の検証

```bash
pnpm type-check
pnpm build
```

---

## 📊 環境ごとの違い

| 項目 | dev (local) | staging | production |
|------|-------------|---------|------------|
| データ永続化 | JSON ファイル | Supabase | Supabase |
| Blob デプロイ | `/public/static-forms/` | `staging/forms/` | `prod/forms/` |
| 認証 | 未実装 | Supabase Auth | Supabase Auth |
| RLS | 無効 | 有効 | 有効 |
| CI/CD | - | GitHub Actions + Vercel | GitHub Actions + Vercel |

---

## 🛠 トラブルシューティング

### Blob デプロイエラー

```
Error: BLOB_READ_WRITE_TOKEN is not set
```

→ Vercel Dashboard で環境変数を設定してください

### Supabase 接続エラー

```
Error: Missing environment variables
```

→ `.env.local` または Vercel 環境変数で Supabase URL/Key を設定

### ビルドエラー

```bash
pnpm clean
pnpm install
pnpm build
```

→ キャッシュをクリアして再ビルド

---

## 📚 関連ドキュメント

- [`WORKFLOW.md`](WORKFLOW.md) - 開発・運用フローガイド ⭐ **日常的な開発はこちら**
- [`.github/copilot-instructions.md`](.github/copilot-instructions.md) - AI エージェント向けガイド
- [`README.md`](README.md) - プロジェクト概要
- [Vercel Documentation](https://vercel.com/docs)
- [Supabase Documentation](https://supabase.com/docs)
