# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

Next.js 16 (App Router) で構築された LINE LIFF ベースの予約フォーム管理システム。サービス管理者がテンプレートからフォームを作成し、店舗管理者が設定を行い、顧客が LINE 経由で予約を行います。フォームは静的 HTML として生成され、Supabase Storage にデプロイされます。

## 必須コマンド

### パッケージ管理（pnpm 必須）
```bash
pnpm install              # 依存関係インストール（npm/yarn 使用禁止）
pnpm dev                  # 開発サーバー起動（localhost:3000）
pnpm build                # プロダクションビルド
pnpm lint                 # ESLint チェック
pnpm type-check           # TypeScript 検証（コミット前必須）
```

### データベースシーディング
```bash
pnpm seed:local           # ローカル JSON ファイルにシード
pnpm seed:staging         # Supabase staging にシード
pnpm seed:staging-demo    # staging にデモデータをシード
```

### 環境設定
```bash
cp .env.local.example .env.local
# ローカル開発: NEXT_PUBLIC_APP_ENV=local のまま（JSON ファイルを使用）
```

### 主な環境変数
```bash
# 環境切り替え（local / staging / production）
NEXT_PUBLIC_APP_ENV=local

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# LINE Platform（オプション）
NEXT_PUBLIC_LINE_CHANNEL_ID=
LINE_CHANNEL_SECRET=

# Google Calendar OAuth（店舗連携用、オプション）
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY=  # リフレッシュトークン暗号化用
```

## アーキテクチャ概要

### 多層設計

**データ層戦略:**
- **Local（開発）**: `data/` ディレクトリ内の JSON ファイル（`stores.json`、`forms_st{storeId}.json`、`reservations.json`）
- **Staging/Production**: Row Level Security (RLS) を使用した Supabase PostgreSQL
- API は `NEXT_PUBLIC_APP_ENV` に基づいて JSON と Supabase を自動切り替え

**環境分離:**
- **Local**: JSON ストレージ、認証スキップ、Supabase Storage モック
- **Staging**: 既存の Supabase プロジェクト（staging 専用）
- **Development**: Supabase staging プロジェクトの dev ブランチ（ブランチ機能使用時）
- **Production**: 新規の独立した Supabase プロジェクト（Pro プラン推奨）
- 各環境は別々の Supabase Storage パスを使用: `reservations/{storeId}/{formId}/index.html` および `surveys/{storeId}/{formId}/index.html`

### 重要なアーキテクチャパターン

**フォーム正規化（`normalizeForm()`）:**
- レガシーのフラット構造 vs 新しい `config.*` 構造を処理
- API 層で全フォームを正規化し、UI の一貫性を確保
- Supabase からの JSONB 文字列を必要に応じてパース
- 常に欠落フィールドをデフォルト値で補完

**静的 HTML 生成:**
- 予約フォーム: `src/lib/static-generator-reservation.ts` の `StaticReservationGenerator.generateHTML()`
- アンケートフォーム: `src/lib/static-generator-survey.ts` の `StaticSurveyGenerator.generateHTML()`
- LINE LIFF 互換性のため vanilla JS のみ使用（React なし）
- 動的テーマカラーを使用したインライン CSS
- すべての設定を `FORM_CONFIG` 定数として JSON 埋め込み

**Supabase Storage デプロイ:**
- `src/lib/supabase-storage-deployer.ts` の `SupabaseStorageDeployer`
- 環境ベースのプロジェクト選択（パスプレフィックスではない）
- Content-Type: `text/html; charset=utf-8` でブラウザレンダリングを正しく実行
- `/api/public-form/*` 経由のプロキシ配信で正しいヘッダーを付与
- パス構造:
  - 予約フォーム: `reservations/{storeId}/{formId}/index.html`
  - アンケートフォーム: `surveys/{storeId}/{formId}/index.html`

**認証アーキテクチャ:**
- Middleware（`src/middleware.ts`）: UI ページアクセス制御のみ
- API ルート: Supabase クライアントから `getUser()` を使用した独立認証チェック
- サービス管理者（ハードコードされたメール）: Admin Client 経由でフルアクセス（RLS バイパス）
- 店舗管理者: RLS で自店舗のみアクセス制御
- Local 環境: すべての認証をスキップ

**Google Calendar 統合:**
- サービスアカウント方式と店舗 OAuth 方式の2パターンをサポート
- `src/lib/google-calendar.ts` - カレンダー作成、イベント CRUD
- `src/lib/google-calendar-token.ts` - OAuth リフレッシュトークンの暗号化/復号化
- `/api/integrations/google-calendar/connect` - OAuth 認証開始
- `/api/integrations/google-calendar/callback` - OAuth コールバック処理
- `/api/stores/{storeId}/calendar` - カレンダー連携状態の取得・設定
- `/api/stores/{storeId}/calendar/disconnect` - カレンダー連携解除
- 店舗の `google_calendar_source` カラム: `'service_account'` | `'store_oauth'` で方式を区別
- `admin_settings` テーブル: `google_oauth_client_id`、`google_oauth_client_secret`、`google_service_account_json` を保存

**CRM（顧客管理）機能:**
- `src/lib/customer-utils.ts` - 顧客検索、作成、更新、セグメント分類
- LINE ユーザー ID または電話番号で顧客を自動紐付け
- 来店履歴（`customer_visits`）を自動記録
- セグメント分類: `new`（新規）、`returning`（リピーター）、`vip`（VIP）、`at_risk`（離脱リスク）
- `/api/stores/{storeId}/customers` - 顧客一覧・作成
- `/api/stores/{storeId}/customers/{customerId}` - 顧客詳細・更新・削除
- `/api/stores/{storeId}/customers/analytics` - 顧客分析データ
- `CustomerList.tsx`、`CustomerDetail.tsx`、`CustomerAnalytics.tsx` - UI コンポーネント

**予約分析機能:**
- `/api/stores/{storeId}/reservations/analytics` - 予約分析 API
- `ReservationAnalytics.tsx` - 日別・週別・月別の予約統計表示

**店舗管理者管理:**
- `/api/stores/{storeId}/admins` - 管理者一覧・追加
- `/api/stores/{storeId}/admins/{userId}` - 管理者削除
- `StoreAdminManager.tsx` - 管理者追加・削除 UI

### ID 生成パターン
- **店舗 ID**: 6文字ランダム `[a-z0-9]{6}`（新規）または UUID（レガシー互換性）
- **フォーム ID**: 12文字ランダム文字列
- **アンケート ID**: 12文字ランダム文字列
- **ローカル開発**: 店舗用に `st{timestamp}` 形式（JSON 互換性）

### 主要ファイルとその役割

**型定義:**
- `src/types/form.ts` - 予約フォーム型（`Form`、`FormConfig`）
- `src/types/survey.ts` - アンケートフォーム型（`SurveyForm`、`SurveyConfig`）
- `src/types/store.ts` - 店舗型

**コアユーティリティ:**
- `src/lib/form-normalizer.ts` - 後方互換性正規化
- `src/lib/env.ts` - 環境検出（`getAppEnvironment()`、`shouldSkipAuth()`）
- `src/lib/supabase.ts` - Supabase クライアントファクトリ（認証 vs 管理者）
- `src/lib/supabase-storage-deployer.ts` - Storage アップロード/デプロイ
- `src/lib/static-generator-reservation.ts` - 予約 HTML 生成
- `src/lib/static-generator-survey.ts` - アンケート HTML 生成
- `src/lib/store-id-generator.ts` - ID 生成ロジック
- `src/lib/google-calendar.ts` - Google Calendar API 操作
- `src/lib/google-calendar-token.ts` - OAuth トークン暗号化
- `src/lib/customer-utils.ts` - CRM 顧客管理ユーティリティ
- `src/lib/auth-helper.ts` - 認証ヘルパー（`getCurrentUser()` など）

**Middleware & 認証:**
- `src/middleware.ts` - ルート保護、サブドメイン/カスタムドメイン検出、RLS バイパスルーティング

## よくある開発ワークフロー

### 新しいフォーム機能の追加
1. `src/types/form.ts` で型を更新（`FormConfig` インターフェースに追加）
2. `normalizeForm()`（`src/lib/form-normalizer.ts`）にデフォルト値を追加
3. `src/components/FormEditor/` でフォーム編集 UI を更新
4. `src/lib/static-generator-reservation.ts` または `src/lib/static-generator-survey.ts` で静的 HTML ジェネレータを更新
5. staging にデプロイする前に、ローカル（JSON モード）でテスト

### API 開発パターン
```typescript
// 例: src/app/api/stores/[storeId]/route.ts
import { getAppEnvironment } from '@/lib/env';
import { getSupabaseAdminClient } from '@/lib/supabase';

export async function GET(req, { params }) {
  const env = getAppEnvironment();

  if (env === 'local') {
    // data/stores.json から読み取り
  } else {
    // Admin Client で Supabase をクエリ
    const supabase = getSupabaseAdminClient();
  }

  // 日本語のエラーメッセージを返す
  return NextResponse.json({ error: 'エラーメッセージ' }, { status: 404 });
}
```

### フォーム編集 & デプロイフロー
1. 店舗管理者が `/{storeId}/forms/{formId}` でフォーム編集
2. 「保存」クリック → `PUT /api/forms/{formId}` で DB/JSON 更新
3. 「保存＆デプロイ」クリック → さらに `POST /api/forms/{formId}/deploy` を呼び出し
4. Deployer が HTML 生成 → Supabase Storage にアップロード → `static_deploy` フィールド更新
5. 顧客が `/api/public-form/reservations/{storeId}/{formId}/index.html` プロキシ経由でアクセス

### サブドメイン & カスタムドメインルーティング
- Middleware がホスト名からサブドメインを検出（`{subdomain}.nas-rsv.com`）
- Supabase の `subdomain` または `custom_domain` カラムで店舗を検索
- URL をリライト: `/` → `/{storeId}/admin`（店舗ダッシュボード）
- サービス管理者ページ（`/admin`）はセキュリティのためサブドメインアクセスをブロック

## 重要なルールと制約

### 絶対にやってはいけないこと:
- **npm/yarn を使用しない** - 常に pnpm を使用（lockfile の整合性）
- **JSON ファイルを直接変更しない** - 常に API ルート経由
- **日本語のエラーメッセージを英語に変更しない** - ユーザー向け表示の一貫性
- **Supabase Storage パスに環境プレフィックスを追加しない** - プロジェクトはすでに分離されている
- **Vercel Blob を使用しない** - 非推奨、Supabase Storage のみ使用（`VercelBlobDeployer` は削除予定）

### 必ずやること:
- **コミット前に `pnpm type-check` を実行**
- **任意のソースからフォームを読み取る際は `normalizeForm()` を使用**
- **PUT リクエストではフォームオブジェクト全体を渡す**（部分更新なし）
- **すべての認証済み fetch 呼び出しに `credentials: 'include'` を含める**
- **ドラフト機能実装時は draft_config と config の両方を更新**
- **Supabase 統合テストの前にローカル JSON モードでテスト**

### コード整理ポリシー:
- 1-2 リリース後に `deprecated` メソッドを削除
- `*-old.ts`、`*-preview.ts`、`new-*.ts` という名前のファイルは即座に削除
- 実装後に `TODO:` コメントを更新/削除
- `normalizeForm()` のような互換性関数は無期限に保持

## Git ワークフロー

### ブランチ戦略:
- `dev` - 直接プッシュ可能、アクティブ開発
- `staging` - dev/feature/* からの PR 必須、staging 環境に自動デプロイ
- `main` - staging からのみ PR、production に自動デプロイ

### PR ベースマージ（ブランチ保護有効）:
1. `dev` または `feature/*` ブランチで作業
2. 変更をプッシュ: `git push origin dev`
3. GitHub で PR 作成: dev → staging
4. 自動チェック実行: ESLint、type-check、build
5. 承認後、マージで Vercel デプロイメントをトリガー
6. Production 用: PR を作成 staging → main

**main への force push は絶対禁止** - GitHub がブロック

## API 規約

### RESTful パターン:
- `GET /api/stores` - 全店舗一覧
- `POST /api/stores` - 店舗作成
- `GET /api/stores/{storeId}` - 店舗詳細取得
- `PUT /api/stores/{storeId}` - 店舗更新
- `DELETE /api/stores/{storeId}` - 店舗削除（フォームもカスケード削除）

### フォーム固有の API:
- `GET /api/forms/{formId}` - 公開エンドポイント（顧客アクセス）
- `PUT /api/forms/{formId}` - 保護（店舗管理者）
- `POST /api/forms/{formId}/deploy` - Supabase Storage へデプロイ
- アンケートフォームは `/api/surveys/{id}` で同じパターン

### 顧客管理 API:
- `GET /api/stores/{storeId}/customers` - 顧客一覧（ページネーション、検索対応）
- `POST /api/stores/{storeId}/customers` - 顧客作成
- `GET /api/stores/{storeId}/customers/{customerId}` - 顧客詳細（来店履歴含む）
- `PUT /api/stores/{storeId}/customers/{customerId}` - 顧客更新
- `DELETE /api/stores/{storeId}/customers/{customerId}` - 顧客削除
- `GET /api/stores/{storeId}/customers/analytics` - 顧客分析データ

### 予約分析 API:
- `GET /api/stores/{storeId}/reservations/analytics` - 予約統計

### Google Calendar 連携 API:
- `GET /api/integrations/google-calendar/connect?store_id=xxx` - OAuth 認証開始（リダイレクト）
- `GET /api/integrations/google-calendar/callback` - OAuth コールバック
- `GET /api/stores/{storeId}/calendar` - カレンダー連携状態取得
- `PUT /api/stores/{storeId}/calendar` - カレンダー ID 設定
- `POST /api/stores/{storeId}/calendar/disconnect` - カレンダー連携解除
- `GET /api/stores/{storeId}/calendar/availability` - カレンダー空き状況

### 店舗管理者 API:
- `GET /api/stores/{storeId}/admins` - 管理者一覧
- `POST /api/stores/{storeId}/admins` - 管理者追加（メールアドレス招待）
- `DELETE /api/stores/{storeId}/admins/{userId}` - 管理者削除

### Webhook:
- `POST /api/webhooks/line` - LINE Messaging API Webhook

### エラーレスポンス形式:
```json
{
  "error": "日本語のエラーメッセージ",
  "details": "オプションの追加情報"
}
```

## UI コンポーネントシステム

**shadcn/ui 統合:**
- すべての UI コンポーネントは `src/components/ui/` 内
- Radix UI プリミティブベース
- アイコンは `lucide-react` を使用
- Tailwind CSS v4 でスタイリング
- モバイルファーストレスポンシブデザイン

**主要 UI コンポーネント（`src/components/ui/`）:**
- `alert-dialog.tsx` - 確認ダイアログ
- `avatar.tsx` - ユーザーアバター
- `badge.tsx` - ステータスバッジ
- `button.tsx` - ボタン
- `card.tsx` - カード
- `dialog.tsx` - モーダルダイアログ
- `drawer.tsx` - ドロワー（モバイル用）
- `dropdown-menu.tsx` - ドロップダウンメニュー
- `input.tsx` - テキスト入力
- `select.tsx` - セレクトボックス
- `sheet.tsx` - サイドシート
- `table.tsx` - テーブル
- `tabs.tsx` - タブ
- `toast.tsx`, `toaster.tsx`, `use-toast.ts` - トースト通知

**主要ビジネスコンポーネント（`src/components/`）:**
- `StoreAdminLayout.tsx` - 店舗管理者ダッシュボードラッパー
- `StoreAdminManager.tsx` - 店舗管理者追加・削除
- `CustomerList.tsx` - 顧客一覧
- `CustomerDetail.tsx` - 顧客詳細
- `CustomerAnalytics.tsx` - 顧客分析
- `ReservationAnalytics.tsx` - 予約分析
- `FormEditor/` - フォーム編集コンポーネント群

## データベーススキーマ（Supabase）

**主要テーブル:**
- `stores` - 店舗マスタ（id: 6文字または UUID、subdomain、custom_domain、google_calendar_id、google_calendar_source、google_calendar_refresh_token）
- `forms` - 予約フォーム（config: JSONB）
- `survey_forms` - アンケートフォーム（config: JSONB）
- `reservations` - 予約レコード（line_user_id カラム追加）
- `store_admins` - アクセス制御マッピング（user_id → store_id）
- `customers` - 顧客マスタ（CRM 機能）
- `customer_visits` - 顧客来店履歴
- `admin_settings` - サービス全体の設定（Google API 認証情報など）

**RLS（Row Level Security）:**
- 店舗管理者に対して有効（`store_admins` テーブル経由で `store_id` でフィルタ）
- サービス管理者は Admin Client で RLS をバイパス
- 公開 API（フォーム取得、予約作成）は匿名アクセスを許可

## テンプレートシステム

予約フォームテンプレート 5 種類:
1. **基本** - シンプルなメニュー選択
2. **スタンダード** - + 性別選択
3. **プレミアム** - + サブメニュー
4. **コンプリート** - + オプション、来店回数
5. **アルティメット** - + クーポン、リピート予約

テンプレートは初期 `config` 構造を提供し、後からカスタマイズ可能。

## テストアプローチ

**ローカルテスト:**
```bash
# 1. 開発サーバー起動
pnpm dev

# 2. サービス管理者画面にアクセス
http://localhost:3000/admin

# 3. 店舗作成、フォーム作成
# 4. フォーム編集、保存＆デプロイ
# 5. public/static-forms/ で生成された HTML を確認
```

**Staging テスト:**
- `dev` ブランチにプッシュ → PR 作成 → `staging` にマージ
- https://form-management-staging.vercel.app に自動デプロイ
- staging Supabase プロジェクトを使用
- 実際の Supabase Storage でテスト

## 関連ドキュメント

詳細ガイドは `docs/` を参照:
- `SETUP.md` - 完全な環境セットアップ
- `WORKFLOW.md` - 日常的な開発フロー
- `ARCHITECTURE.md` - システム設計の詳細
- `API_SPECIFICATION.md` - 完全な API リファレンス
- `SUPABASE_BEST_PRACTICES.md` - Supabase 使用パターン
- `BRANCH_PROTECTION.md` - Git ワークフロールール
- `STORE_ADMIN_MANAGEMENT.md` - ユーザーロール管理
- `.github/copilot-instructions.md` - AI アシスタントクイックリファレンス（MCP セットアップを含む）
