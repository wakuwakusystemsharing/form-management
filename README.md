# 予約フォーム管理システム

Next.js 16 (App Router) で構築された LINE LIFF / Web 両対応の予約・アンケートフォーム管理システム。マルチテナント運用に対応し、フォームは静的 HTML として生成 → Supabase Storage 経由で配信されます。

## 🌟 主な機能

### マルチテナント管理（3 階層）
- **マスター管理者** (`/master-admin`): 全テナント・全店舗にアクセス可能
- **システム管理者** (`/tenant/{slug}/admin`): 自テナント内の店舗のみアクセス可能
- **店舗管理者** (`/{storeId}/admin`): 自店舗のみアクセス可能（RLS で制御）

### 店舗・フォーム管理
- 5 種類の予約フォームテンプレート（基本 / スタンダード / プレミアム / コンプリート / アルティメット）
- 予約フォーム / アンケートフォームの 2 系統に対応
- 「保存＆デプロイ」で Supabase Storage に静的 HTML を生成・配信
- 「保存前プレビュー」機能でリアルタイム確認

### 予約フォームの機能
- **2 つの予約モード**: Google カレンダー連携式 / 第一〜第三希望日時選択式
- **時間間隔設定**: 10/15/30/60 分から選択
- **同時刻イベント数閾値**: N 件以上のイベント重なりで予約不可
- **同一ユーザー同時予約数上限**: 0（制限なし）/ 1 / 2... の整数で制御
- **祝日自動✕表示**: 1980〜2099 年対応、祝日種類別に個別 ON/OFF 可能
- **顧客フィールドの表示制御**: 名前 / 電話番号 / メールアドレス / メニュー欄を個別に表示・非表示
- **CRM 連携**: 予約と同時に customers / customer_visits を自動更新
- **流入経路（source_medium）追跡**: line / instagram / facebook / x_twitter / google_maps / google_search / yahoo_search / direct
- **カスタムフィールド**: text / textarea / radio / checkbox / date / datetime / select の 7 種

### 予約後の自動処理
- **Google Calendar 連携**: SA 方式 + 店舗 OAuth 方式の両対応、複数カレンダーから選択可
- **LINE Webhook 返信**: 予約フォーム送信を検知して Flex 確認メッセージを返信
- **LIFF 2 通目メッセージ**: 公式 LINE「完全一致応答メッセージ」連携用に固定テキストを送信
- **Web 予約自動メール通知**（Resend）: お客様 + 店舗の両方に予約確定メール
- **LINE リマインダー**: 翌日予約に対して指定時刻で Flex メッセージ送信（pg_cron 駆動）

### 予約管理・分析
- 予約ステータス管理（pending / confirmed / cancelled / completed）
- 予約分析ダッシュボード（日別・週別・月別の予約統計）
- 顧客分析（性別分布 / 来店回数 / クーポン利用 / セグメント分類）

## 🛠 技術スタック

- **Framework**: Next.js 16 (App Router) / TypeScript / React 19
- **Styling**: Tailwind CSS v4 / shadcn/ui (Radix UI ベース) / lucide-react
- **Database**: Supabase (PostgreSQL + Row Level Security) / Local 開発時は JSON ファイル
- **Auth**: Supabase Auth (3 階層ロール)
- **Storage**: Supabase Storage（フォーム HTML / メニュー画像）
- **Email**: Resend（Web 予約フォーム自動メール通知）
- **Calendar**: Google Calendar API (SA + OAuth)
- **CRON**: Supabase Edge Functions + pg_cron（リマインダー）
- **Package Manager**: pnpm（npm/yarn 使用禁止）
- **Deploy**: Vercel

## 📁 主要ディレクトリ

```
src/
├── app/
│   ├── (public)/              # 公開ページ（home / privacy / terms）
│   ├── master-admin/          # マスター管理者画面
│   ├── tenant/[slug]/admin/   # システム管理者画面
│   ├── [storeId]/admin/       # 店舗管理者画面
│   ├── form/[formId]/         # 顧客向けフォーム（プレビュー用）
│   └── api/
│       ├── reservations/      # 予約 CRUD + メール送信トリガー
│       ├── stores/            # 店舗 CRUD + カレンダー連携
│       ├── forms/             # 予約フォーム CRUD + デプロイ
│       ├── surveys/           # アンケート CRUD + デプロイ
│       ├── integrations/google-calendar/  # OAuth 連携
│       ├── webhooks/line/     # LINE Webhook
│       ├── preview/generate/  # 保存前プレビュー HTML 生成
│       └── public-form/       # Storage プロキシ配信
├── components/
│   ├── FormEditor/            # 予約・アンケートのフォーム編集 UI
│   ├── Customer*.tsx          # CRM 顧客関連 UI
│   ├── ReservationAnalytics.tsx
│   └── ui/                    # shadcn/ui プリミティブ
├── lib/
│   ├── form-normalizer.ts          # 旧/新形式の互換性正規化（必須）
│   ├── static-generator-reservation.ts  # 予約フォーム HTML 生成
│   ├── static-generator-survey.ts       # アンケート HTML 生成
│   ├── supabase-storage-deployer.ts     # Storage アップロード
│   ├── google-calendar.ts               # Calendar API（SA / OAuth 統合）
│   ├── customer-utils.ts                # CRM ユーティリティ
│   ├── email-sender.ts                  # Resend ラッパ
│   ├── email-templates.ts               # メール本文テンプレ
│   └── reservation-email.ts             # 予約完了時メール送信オーケストレーション
├── types/                     # TypeScript 型定義
└── middleware.ts              # ルート保護
supabase/
├── migrations/                # DB マイグレーション
└── functions/send-reminders/  # 翌日予約リマインダー Edge Function
data/                          # ローカル開発用 JSON（store / forms / reservations 等）
docs/                          # 詳細ドキュメント
```

## 🚀 クイックスタート（ローカル開発）

```bash
# 前提: Node.js 20+, pnpm 9+
git clone https://github.com/wakuwakusystemsharing/form-management.git
cd form-management
pnpm install

# 環境変数のテンプレートをコピー（NEXT_PUBLIC_APP_ENV=local のまま）
cp .env.local.example .env.local

# 開発サーバー起動
pnpm dev
# → http://localhost:3000
```

ローカルモード（`NEXT_PUBLIC_APP_ENV=local`）では:
- データは `data/*.json` に保存
- 認証はスキップ
- Supabase Storage はモック（`public/static-forms/`）
- メール送信は `RESEND_API_KEY` 未設定時にスキップ（ログのみ）

詳細は [`docs/SETUP.md`](docs/SETUP.md) を参照。

## 🌍 環境構成

| 環境 | ブランチ | URL | DB | Auth |
|---|---|---|---|---|
| **Production** | `main` | https://nas-rsv.com | Supabase Prod プロジェクト | 有効 |
| **Staging** | `staging` | https://form-management-staging.vercel.app | Supabase Staging プロジェクト | 有効 |
| **Local** | - | http://localhost:3000 | JSON ファイル | スキップ |

`staging` と `production` は **別々の Supabase プロジェクト** で完全分離。

## 🔧 主要コマンド

```bash
pnpm dev                  # 開発サーバー
pnpm build                # プロダクションビルド
pnpm lint                 # ESLint
pnpm type-check           # TypeScript 検証（コミット前必須）
pnpm seed:local           # ローカル JSON にダミーデータ投入
pnpm seed:staging         # Staging Supabase にダミーデータ投入
pnpm seed:staging-demo    # Staging にデモデータ投入
```

## 📡 API 概要

```
# 公開
POST   /api/reservations                          # 予約作成（認証不要、メール自動送信）
GET    /api/forms/{formId}                        # フォーム取得（顧客向け）
GET    /api/public-form/[...path]                 # Storage プロキシ配信
POST   /api/preview/generate                      # 保存前プレビュー
POST   /api/webhooks/line                         # LINE Webhook（署名検証）

# 認証必須（マスター/システム/店舗管理者）
GET    /api/stores                                # 店舗一覧
PUT    /api/stores/{storeId}                      # 店舗情報更新
GET    /api/stores/{storeId}/forms                # 予約フォーム一覧
PUT    /api/forms/{formId}                        # フォーム保存
POST   /api/forms/{formId}/deploy                 # 静的 HTML デプロイ
POST   /api/stores/{storeId}/calendar             # Calendar 作成（SA）
PUT    /api/stores/{storeId}/calendar             # Calendar ID 切替（OAuth）
GET    /api/stores/{storeId}/calendar/list        # OAuth カレンダー一覧
GET    /api/stores/{storeId}/customers            # 顧客一覧（CRM）
PATCH  /api/reservations/{reservationId}          # 予約ステータス更新
```

詳細は [`docs/API_SPECIFICATION.md`](docs/API_SPECIFICATION.md) を参照。

## 🔒 ブランチ運用

```
dev → staging → main
```

- `dev`: 直接プッシュ可（開発用）
- `staging`: PR 必須（dev / feature/* から）→ staging Vercel 自動デプロイ
- `main`: PR 必須（staging から）→ production 自動デプロイ
- **main への force push は禁止**（GitHub branch protection）

詳細は [`docs/WORKFLOW.md`](docs/WORKFLOW.md) と [`docs/BRANCH_PROTECTION.md`](docs/BRANCH_PROTECTION.md) を参照。

## 📦 主要マイグレーション

```
20250101000000_initial_schema.sql                  # 初期スキーマ
20250204000000_add_crm_tables.sql                  # CRM テーブル追加
20250211000000_add_google_calendar_oauth_columns.sql
20260407000000_add_multi_tenant_admin.sql          # マスター/システム管理者
20260411000000_add_organizations.sql               # テナント
20260411100000_add_reminder_settings.sql           # LINE リマインダー
20260429000000_add_store_postal_code.sql           # メール通知用
```

詳細は [`docs/DATABASE_MIGRATION.md`](docs/DATABASE_MIGRATION.md) を参照。

## 📚 関連ドキュメント

- [`docs/SETUP.md`](docs/SETUP.md) - 環境セットアップ完全ガイド
- [`docs/WORKFLOW.md`](docs/WORKFLOW.md) - 日常的な開発フロー
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) - システム設計詳細
- [`docs/API_SPECIFICATION.md`](docs/API_SPECIFICATION.md) - API リファレンス
- [`docs/SUPABASE_BEST_PRACTICES.md`](docs/SUPABASE_BEST_PRACTICES.md) - Supabase 使用パターン
- [`docs/SUPABASE_STORAGE_SETUP.md`](docs/SUPABASE_STORAGE_SETUP.md) - Storage 構成
- [`docs/STORE_ADMIN_MANAGEMENT.md`](docs/STORE_ADMIN_MANAGEMENT.md) - ロール管理
- [`docs/BRANCH_PROTECTION.md`](docs/BRANCH_PROTECTION.md) - Git ワークフロー
- [`docs/GCP_SETUP.md`](docs/GCP_SETUP.md) - Google Calendar OAuth セットアップ
- [`docs/MCP_SETUP_GUIDE.md`](docs/MCP_SETUP_GUIDE.md) - Supabase MCP 接続
- [`CLAUDE.md`](CLAUDE.md) - AI アシスタント向けクイックリファレンス
