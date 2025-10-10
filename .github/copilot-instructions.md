## 🤖 Agent Quick Start (form-management)

目的: LINE LIFF 連携の予約フォームを Next.js (App Router) で編集・静的HTML化し Vercel Blob へデプロイする管理/生成システム。

### 0. パッケージ管理・開発コマンド (pnpm 必須)
- **インストール**: `pnpm install` (npm/yarn 使用禁止、lockfile 整合性維持)
- **開発**: `pnpm dev` (ローカルサーバ起動、JSON ストレージ + Blob モック)
- **型チェック**: `pnpm type-check` (コミット前必須)
- **Lint**: `pnpm lint` (ESLint 実行)
- **ビルド**: `pnpm build` (Next.js プロダクションビルド、CI で実行)
- **環境変数取得**: `pnpm vercel env pull .env.local` (Vercel 環境変数をローカルに同期)

### 1. 環境モードと挙動 (dev / staging / prod)
- **環境判定**: `getAppEnvironment()` → `NEXT_PUBLIC_APP_ENV` (local|staging|production)
- **dev (ローカル開発)**:
  - JSON ファイル (`data/*.json`) で永続化
  - Blob モック: `BLOB_READ_WRITE_TOKEN` 未設定時 → `/public/static-forms/{formId}.html` に出力
  - Supabase 未接続 (モック予定)
- **staging / production (本番系)**:
  - Supabase 接続 (RLS 適用、店舗別アクセス制御)
  - Vercel Blob 実デプロイ: `staging/forms/{storeId}/{formId}.html` or `prod/forms/{storeId}/{formId}.html`
  - CI/CD: Vercel 自動デプロイ (staging は preview ブランチ、prod は main ブランチ)
  - 環境変数は Vercel Dashboard で管理 (`NEXT_PUBLIC_APP_ENV`, `BLOB_READ_WRITE_TOKEN`, Supabase keys)

### 2. データレイヤ構成
- **dev 環境**: JSON ファイル (`data/forms.json`, `data/forms_st{storeId}.json`, `data/stores.json`, `data/reservations.json`)
- **staging / prod 環境**: Supabase PostgreSQL
  - テーブル: `stores`, `forms`, `reservations`, `store_admins`
  - RLS (Row Level Security) で店舗別アクセス制御
  - `store_admins.store_id` で自店舗のみ CRUD 可能
  - サービス管理者は全店舗アクセス可
- **互換性**: 旧「フラット形式」(`form_name` 等) と新 `config.*` 形式共存 → `normalizeForm(form)` が API GET で統一
- 保存系 API は全体上書き + `updated_at` 更新 (差分マージなし)

### 3. 型とフォーム構造
- 代表型: `types/form.ts` (`Form`, `FormConfig`) – 新機能追加時はここを最初に拡張
- 互換ヘルパ: UI 側 `getFormConfig()` / API 側 `normalizeForm()` で欠損フィールドを安全補完 (Null 直接追加禁止、既存パターン踏襲)

### 4. 主なフロー
1. 管理 UI (`/[storeId]/forms/[formId]`) が `/api/forms/{formId}` を取得 → フォーム編集 (state 内で全体オブジェクト保持)
2. 保存: PUT `/api/forms/{formId}` (丸ごと送信) → JSON 書き込み
3. プレビュー: 直後 `/form/{formId}?preview=true` (まだ Blob 未反映)
4. 本番反映: POST `/api/forms/{formId}/deploy` → 静的HTML生成 (`StaticFormGenerator.generateHTML`) → Blob / ローカル出力 → `static_deploy` 情報更新

### 5. 静的HTML生成のポイント
- 生成元: `src/lib/static-generator.ts` 内 `StaticFormGenerator`
- 出力 HTML は LIFF SDK script 埋め込み + インライン CSS (テーマ色 `config.basic_info.theme_color` 適用)
- メニュー/オプション有無は `config.*.enabled` フラグで条件レンダリング

### 6. Blob デプロイ仕様 (`VercelBlobDeployer`)
- **環境別 prefix**: staging → `staging/forms/{storeId}/{formId}.html`, production → `prod/forms/{storeId}/{formId}.html`
- **Blob ストレージ分離**: Vercel Dashboard で staging 用・prod 用の Blob トークンを別々に設定推奨
- エラーハンドリング: Blob 失敗時は throw → 呼び出し側でユーザ通知必須 (再試行ロジック未実装: 追加する際は指数バックオフ推奨)
- 画像アップロード API で同クラス `uploadImage()` 利用 (パス命名一貫: `menu_images/{storeId}/{menuId}.{ext}`)

### 7. API パターン (例: `api/forms/[formId]/route.ts`)
- GET: 正規化して単一返却 (404 メッセージは日本語固定)
- PUT: グローバル → 店舗順に探索し最初にヒットした領域で更新
- DELETE: 同じ探索順で削除。レスポンスは `{ success, message, deletedForm { id, name } }`
- 新規 API 追加時は: 1) ファイル先頭で data dir 初期化 2) 読み込み関数分離 3) 日本語エラーメッセージ整合 4) 時刻は ISO 文字列

### 8. UI 実装方針 (編集ページ)
- 全フォームオブジェクトを `useState<Form>` で保持し、深い更新はイミュータブル spread (Immer 未使用)
- 保存ステータス表示: `saveStatus` (idle|saving|saved|error) + 2 秒後 reset の一貫パターン
- タブ切替: `activeTab` ローカル state、URL クエリ同期は未実装 (導入時は戻る遷移影響に注意)

### 9. 環境判定 / URL 生成
- `getBaseUrl()` が SSR/CSR 両対応 (window 判定) – 新規サーバ util では直接 `process.env` よりも既存関数再利用

### 10. 変更時の指針 (Agent 用)
- 新フィールド追加: `types/form.ts` → `normalizeForm()` で後方互換初期値 → UI 編集フォーム & Static HTML へのレンダリング追加
- デプロイ動作変更: `VercelBlobDeployer.deployForm()` のみ集中修正 (ローカルモードとの差分壊さない)
- 旧形式排除作業を行う場合は先に API レイヤで migration (normalize 結果を保存) を実装し UI を後追い

### 11. 守るべき注意点
- 直接 JSON ファイルを miscellaneous スクリプトで書き換えない (API 経由 or 既存 utility 関数流用)
- `BLOB_READ_WRITE_TOKEN` 無しで本番/ステージング Deploy ロジックを誤実行しない (条件分岐維持)
- 日本語メッセージ定型を英語に置換しない (ユーザ表示整合性)

不足/不明点があればこのファイルを更新する形で質問を追記してください。
