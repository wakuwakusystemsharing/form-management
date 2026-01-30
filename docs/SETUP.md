# 環境セットアップガイド

このドキュメントでは、dev / staging / production 環境の構築手順を説明します。

## 📋 前提条件

- Node.js 20 以上
- pnpm 9 以上 (npm/yarn 使用禁止)
- Vercel アカウント (staging/prod デプロイ用)
- Supabase プロジェクト (staging/prod 用)

## 📦 主要依存関係

- **Next.js 16.0.10** - React フレームワーク
- **shadcn/ui** - UIコンポーネントライブラリ（Radix UIベース）
  - `@radix-ui/react-*` - アクセシブルなUIプリミティブ
  - `lucide-react` - アイコンライブラリ
  - `class-variance-authority` - バリアント管理
  - `tailwind-merge` - Tailwindクラス統合
- **Supabase** - データベース・認証・ストレージ
- **Tailwind CSS v4** - スタイリング

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
# Supabase 設定も不要 (JSON ファイル永続化)

# ローカル環境でログイン画面を確認する場合は、以下を設定:
# NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
# NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
# SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
# 
# 取得方法: Supabase Dashboard → Project Settings → API → Legacy Keys
# または: https://supabase.com/dashboard/project/[project-ref]/settings/api-keys/legacy
# 例: https://supabase.com/dashboard/project/ohplaysshllkinaiqksb/settings/api-keys/legacy
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
> 
> **📌 Supabase プロジェクト分離**: staging と production は **別々の Supabase プロジェクト** を使用します

### 1. Supabase プロジェクト（Staging 用）

1. **既存の Supabase プロジェクトを staging 用として運用**
   - 既存のプロジェクトをそのまま staging 環境として使用
   - プロジェクト名: `wakuwakusystemsharing-staging` など（既存のまま）
2. マイグレーション確認:
   - SQL Editor で以下のマイグレーションが適用されているか確認:
     - `supabase/migrations/20250101000000_initial_schema.sql` - 初期スキーマ
     - `supabase/migrations/20250116000000_update_draft_status.sql` - draft_status フィールド更新
   - 未適用の場合は順番に実行

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
NEXT_PUBLIC_SUPABASE_URL=https://[既存プロジェクト].supabase.co (Staging 用 Supabase プロジェクト)
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... (Staging プロジェクトの anon key)
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... (Staging プロジェクトの service_role key)
```

**重要**: 
- Preview 環境は `staging` ブランチのデプロイに適用されます
- **既存の Supabase プロジェクトを staging 用として使用**（新規作成不要）

### 3. Supabase Storage 設定（Staging 用）

1. Supabase Dashboard > Storage > Create bucket（未作成の場合）
2. バケット名: `forms`
3. Public bucket: 有効（匿名ユーザーがアクセス可能）
4. File size limit: 適切なサイズを設定（デフォルト: 50MB）
5. RLSポリシーを設定（詳細は [`SUPABASE_STORAGE_SETUP.md`](SUPABASE_STORAGE_SETUP.md) を参照）
6. 環境変数は既に設定済み（`NEXT_PUBLIC_SUPABASE_URL` で自動的に staging プロジェクトの Storage に接続）

**注意**: フォームHTMLは以下のパス構造で保存されます（2025-01-31更新）
- 予約フォーム: `reservations/{storeId}/{formId}/index.html`
- アンケートフォーム: `surveys/{storeId}/{formId}/index.html`

### 4. デプロイ

```bash
git push origin staging
```

→ Vercel が自動で Preview デプロイ

### 5. 動作確認

- データは Staging 用 Supabase プロジェクトに保存（既存プロジェクト）
- 静的HTML は Supabase Storage (`reservations/{storeId}/{formId}/index.html` または `surveys/{storeId}/{formId}/index.html`) に出力
- RLS で店舗別アクセス制御が有効
- Production 環境とは完全に分離されていることを確認

---

## 🚀 本番環境 (production)

> **📌 重要**: Production 環境は **staging とは別の Supabase プロジェクト** を使用します
> - 既存の Supabase プロジェクト → staging 用として継続使用
> - 新しい Supabase プロジェクト → production 用として新規作成

### 1. Supabase 本番プロジェクト作成

1. Supabase Dashboard で **新規の本番用プロジェクト** を作成
   - **重要**: staging とは別の Supabase プロジェクトを使用
   - プロジェクト名: `wakuwakusystemsharing-prod` など
   - プラン: **Pro プラン推奨**（本番運用のため）
2. SQL Editor で以下のマイグレーションを順番に実行:
   - `supabase/migrations/20250101000000_initial_schema.sql` - 初期スキーマ
   - `supabase/migrations/20250116000000_update_draft_status.sql` - draft_status フィールド更新
   - `supabase/migrations/20250125000000_add_survey_forms.sql` - アンケートフォーム用（必要に応じて）
   - `supabase/migrations/20251204000000_create_survey_forms.sql` - アンケートフォーム用（必要に応じて）
3. Storage バケット設定:
   - Storage → Create bucket
   - バケット名: `forms`
   - Public bucket: 有効（匿名ユーザーがアクセス可能）
   - File size limit: 適切なサイズを設定

### 2. Vercel カスタムドメイン設定

1. Vercel Dashboard > Settings > Domains にアクセス
2. **Add Domain** をクリック
3. カスタムドメイン `nas-rsv.com` を入力
4. DNS設定を確認（AレコードまたはCNAMEレコードの設定が必要）
5. ドメインが有効化されるまで待機（数分〜数時間）

> **📌 重要**: カスタムドメインが有効化されると、フォームのURLが自動的にカスタムドメインを使用するようになります。

### 3. Vercel 本番環境変数設定

同じ Vercel プロジェクトで、Vercel Dashboard > Settings > Environment Variables で **Production** にチェック:

```
NEXT_PUBLIC_APP_ENV=production
NEXT_PUBLIC_PRODUCTION_URL=https://nas-rsv.com (カスタムドメイン)
NEXT_PUBLIC_SUPABASE_URL=https://[新規プロジェクト].supabase.co (本番 Supabase URL、Staging と別プロジェクト)
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... (本番プロジェクトの anon key)
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... (本番プロジェクトの service_role key)
```

**重要**: 
- `NEXT_PUBLIC_PRODUCTION_URL` をカスタムドメイン `https://nas-rsv.com` に設定することで、フォームのURLがカスタムドメインを使用します
- Production 環境は `main` ブランチのデプロイに適用されます
- **Staging と Production で異なる Supabase プロジェクトを使用**（環境変数で自動切り替え）
- Supabase Storage も環境ごとに分離（`staging/forms/` と `prod/forms/`）

### 4. Supabase Storage (本番用)

> **注意**: 現在は Supabase Storage を使用しています（Vercel Blob は非推奨）

1. Supabase Dashboard > Storage > Create bucket
2. バケット名: `forms`（staging と同じ名前でOK、プロジェクトが別なので分離される）
3. Public bucket: 有効（匿名ユーザーがアクセス可能）
4. File size limit: 適切なサイズを設定（デフォルト: 50MB）
5. RLSポリシーを設定（詳細は [`SUPABASE_STORAGE_SETUP.md`](SUPABASE_STORAGE_SETUP.md) を参照）
6. 環境変数は既に設定済み（`NEXT_PUBLIC_SUPABASE_URL` で自動的に本番プロジェクトの Storage に接続）

**注意**: 
- フォームHTMLは `prod/forms/{storeId}/{formId}/config/current.html` のパス構造で保存されます
- プロキシURL (`/api/public-form/*`) 経由でアクセスすることで、正しいContent-Typeで配信されます

### 4. デプロイ

```bash
git push origin main
```

→ Vercel が自動で Production デプロイ

### 5. 動作確認

- データは本番 Supabase プロジェクトに保存（staging とは別プロジェクト）
- 静的HTML は Supabase Storage (`reservations/{storeId}/{formId}/index.html` または `surveys/{storeId}/{formId}/index.html`) に出力
- RLS で本番データが保護される
- staging 環境のデータと production 環境のデータは完全に分離されていることを確認

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
| データ永続化 | JSON ファイル | Supabase (既存プロジェクト) | Supabase (新規プロジェクト、Pro プラン) |
| Storage デプロイ | `/public/static-forms/` | Supabase Storage (`reservations/`, `surveys/`) | Supabase Storage (`reservations/`, `surveys/`) |
| 認証 | 未実装 | Supabase Auth | Supabase Auth |
| RLS | 無効 | 有効 | 有効 |
| CI/CD | - | GitHub Actions + Vercel | GitHub Actions + Vercel |
| プロジェクト分離 | - | 既存プロジェクト継続使用 | 新規プロジェクト作成 |

---

## 🛠 トラブルシューティング

### Supabase Storage デプロイエラー

```
Error: Supabase クライアントの初期化に失敗しました
```

→ Vercel Dashboard で環境変数（`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`）を設定してください

### Supabase 接続エラー

```
Error: Missing environment variables
```

→ `.env.local` または Vercel 環境変数で Supabase URL/Key を設定

### フォームが表示されない

→ Supabase Storage の RLSポリシーを確認してください（詳細は [`SUPABASE_STORAGE_SETUP.md`](SUPABASE_STORAGE_SETUP.md) を参照）

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
- [shadcn/ui Documentation](https://ui.shadcn.com/)

---

**最終更新**: 2025年12月
