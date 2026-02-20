**詳細はルートの [CLAUDE.md](/CLAUDE.md) を参照。** 以下はクイックリファレンスです。

## Agent Quick Start (form-management)

目的: LINE LIFF 連携の予約フォームを Next.js (App Router) で編集・静的HTML化し **Supabase Storage** へデプロイする管理/生成システム。

### 0. パッケージ管理・開発コマンド (pnpm 必須)
- **インストール**: `pnpm install` (npm/yarn 使用禁止、lockfile 整合性維持)
- **開発**: `pnpm dev` (ローカルサーバ起動、JSON ストレージ + Storage モック)
- **型チェック**: `pnpm type-check` (コミット前必須)
- **Lint**: `pnpm lint` (ESLint 実行)
- **ビルド**: `pnpm build` (Next.js プロダクションビルド、CI で実行)
- **環境変数**: `.env.local.example` をコピーして `.env.local` を用意

### 1. 環境モードと挙動 (local / staging / production)
- **環境判定**: `getAppEnvironment()` → `NEXT_PUBLIC_APP_ENV` (local|staging|production)
- **local (ローカル開発)**:
  - JSON ファイル (`data/*.json`) で永続化
  - 静的HTMLは `public/static-forms/` に出力（Supabase Storage はモック）
  - 認証スキップ
- **staging / production (本番系)**:
  - Supabase 接続 (RLS 適用、店舗別アクセス制御)
  - **staging**: 既存の Supabase プロジェクト（staging 専用）
  - **production**: 新規の Supabase プロジェクト（Pro プラン推奨）
  - 環境変数で環境ごとに異なるプロジェクトを指定
  - フォームHTML: Supabase Storage にデプロイ。パスは環境別: `reservations/{storeId}/{formId}/index.html` / `surveys/{storeId}/{formId}/index.html`
  - 公開は `/api/public-form/*` プロキシ経由

### 2. データレイヤ構成
- **local**: JSON ファイル (`data/forms_st{storeId}.json`, `data/stores.json`, `data/reservations.json` 等)
- **staging / production**: Supabase PostgreSQL（`stores`, `forms`, `reservation_forms`, `reservations`, `store_admins` 等、RLS 適用）
- **互換性**: 旧フラット形式と新 `config.*` 形式 → `normalizeForm(form)` で常に正規化
- 保存系 API は全体上書き (差分マージなし)。API 認証はルート内で独立実施

### 3. 型とフォーム構造
- 代表型: `src/types/form.ts` (`Form`, `FormConfig`) – 新機能追加時はここを最初に拡張
- 正規化: API・画面とも `normalizeForm()` (`src/lib/form-normalizer.ts`) を使用。ページ内の重複 `normalizeFormData` は使わない

### 4. 主なフロー
1. 管理 UI (`/[storeId]/forms/[formId]`) が `/api/forms/{formId}` を取得 → フォーム編集 (state で全体保持)
2. 保存: PUT `/api/forms/{formId}` (丸ごと送信)
3. 本番反映: POST `/api/forms/{formId}/deploy` → 静的HTML生成 → **Supabase Storage** にアップロード → `static_deploy` 更新
4. 顧客: `/api/public-form/reservations/{storeId}/{formId}/index.html` 等でアクセス

### 5. 静的HTML生成
- 予約: `src/lib/static-generator-reservation.ts` の `StaticReservationGenerator.generateHTML()`
- アンケート: `src/lib/static-generator-survey.ts` の `StaticSurveyGenerator.generateHTML()`
- LIFF 互換のため vanilla JS のみ。テーマ色は `config.basic_info.theme_color`。設定は `FORM_CONFIG` として JSON 埋め込み

### 6. Supabase Storage デプロイ (`SupabaseStorageDeployer`)
- パス: 予約 `reservations/{storeId}/{formId}/index.html`、アンケート `surveys/{storeId}/{formId}/index.html`
- Content-Type: `text/html; charset=utf-8`。画像は `menu_images/{storeId}/{menuId}.{ext}` 等
- バケットは環境別プロジェクトで分離。Vercel Blob は使用しない（`vercel-blob-deployer.ts` は非推奨）

### 7. API パターン
- GET: 取得後に `normalizeForm()` して返却。404 等は日本語メッセージ
- PUT: フォーム全体で更新。環境は `getAppEnvironment()` で分岐

### 8. UI 実装方針
- フォームは `useState<Form>` で全体保持。深い更新はイミュータブルに。認証済み fetch は `credentials: 'include'`

### 9. 変更時の指針 (Agent 用)
- 新フィールド追加: 1) `types/form.ts` 2) `form-normalizer.ts` の defaultConfig 3) FormEditor UI 4) static-generator-reservation.ts / static-generator-survey.ts の 4 箇所を更新
- デプロイは `SupabaseStorageDeployer` を利用。日本語メッセージを英語に変更しない

### 10. 守るべき注意点
- JSON ファイルを直接書き換えない (API 経由)
- 日本語ユーザー向けメッセージを英語に置換しない

### 11. MCP 設定
- `.mcp.json` または `.cursor/mcp.json` で Supabase MCP 等を設定。認証は環境変数で管理。本番接続は避ける

### 12. Git ワークフロー（CLAUDE.md / docs/WORKFLOW.md に準拠）
- **dev** – 直接プッシュ可。**staging** – dev / feature/* から PR。**main** – staging からのみ PR（保護）
- コミット前: `pnpm type-check` 必須。PR で ESLint / type-check / build 実行

### 13. コード整理ポリシー
- `deprecated` は 1-2 リリース後に削除。`*-old.ts`, `*-preview.ts` 等は即削除。`normalizeForm()` は互換性のため保持

不足/不明点は CLAUDE.md および docs/ を参照。
