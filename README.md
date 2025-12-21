# LINE予約フォーム管理システム (Next.js版)

LINE LIFFを活用した予約フォーム管理システムです。サービス管理者がテンプレートからフォームを作成し、店舗管理者がフォームを設定・管理し、顧客がLINE上で予約を行うことができます。

## 🌟 主な機能

### 🔧 サービス管理者機能
- **店舗管理**: 店舗の作成・編集・削除
- **テンプレート選択**: 5つのテンプレートから選択してフォーム作成
  - 基本テンプレート（シンプル）
  - スタンダードテンプレート（性別選択あり）
  - プレミアムテンプレート（サブメニュー対応）
  - コンプリートテンプレート（オプション機能あり）
  - アルティメットテンプレート（全機能搭載）
- **フォーム管理**: 全店舗のフォーム状況監視
- **予約管理**: 全店舗の予約データ一覧表示
- **店舗削除**: 店舗と関連フォームの一括削除（危険ゾーン）

### 📋 店舗管理者機能
- **フォーム基本情報設定**: 店舗名、フォーム名、LIFF ID、テーマカラーの設定
- **メニュー・カテゴリ管理**: メニューの追加・編集・削除、カテゴリの作成・管理
- **画像アップロード**: メニューに画像を添付（Supabase Storage統合）
- **性別フィルタリング**: 性別によるメニュー表示制御
- **営業時間設定**: 曜日別営業時間・定休日の設定
- **プレビュー機能**: 変更内容をリアルタイムで確認
- **フォーム公開管理**: アクティブ/非アクティブの切り替え
- **予約管理**: 自店舗の予約データ一覧表示
- **認証**: ログイン画面経由でのアクセス（実装予定）

### 👥 顧客向け機能
- **モバイル最適化**: LINE内での使いやすいインターフェース
- **性別選択**: 設定に応じたメニューフィルタリング
- **メニュー選択**: 画像付きメニューから選択
- **サブメニュー**: 詳細オプション選択
- **予約日時選択**: カレンダーから日時を選択
- **顧客情報入力**: 名前、電話番号、要望等の入力
- **Google Apps Script連携**: 予約データの自動送信

## 🛠 技術スタック

- **Framework**: Next.js 15.5.3 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4
- **Database**: Supabase (Staging/Production), JSON ファイル (Local開発)
- **Authentication**: Supabase Auth
- **Storage**: Supabase Storage（画像・フォームHTML）
- **Static Deployment**: Supabase Storage（顧客向けフォーム）
- **Backend Integration**: Google Apps Script
- **Package Manager**: pnpm

## 📁 プロジェクト構成

```
src/
├── app/                          # Next.js App Router
│   ├── api/                     # API Routes
│   │   ├── forms/[formId]/     # フォーム個別API
│   │   ├── stores/             # 店舗関連API
│   │   ├── reservations/       # 予約管理API（全店舗）
│   │   └── upload/             # 画像アップロードAPI
│   ├── admin/                  # サービス管理者画面
│   │   ├── [storeId]/          # 店舗詳細管理
│   │   └── reservations/       # 全予約一覧
│   ├── [storeId]/              # 店舗管理者画面
│   │   ├── admin/              # 店舗ダッシュボード
│   │   ├── forms/[formId]/     # フォーム編集画面
│   │   └── reservations/       # 店舗別予約一覧
│   ├── form/[formId]/          # 顧客向けフォーム
│   └── login/                  # 店舗管理者ログイン
├── components/                  # 再利用可能なコンポーネント
│   ├── Calendar/               # カレンダー関連
│   ├── FormEditor/             # フォーム編集コンポーネント
│   ├── FormRenderer/           # フォーム表示コンポーネント
│   └── Layout/                 # レイアウトコンポーネント
├── lib/                        # ユーティリティ・ビジネスロジック
│   ├── memory-storage.ts       # 一時データストレージ
│   ├── static-generator.ts     # 静的HTML生成
│   └── vercel-blob-deployer.ts # Blob Storage管理
├── middleware.ts               # 認証ミドルウェア
├── types/                      # TypeScript型定義
│   ├── form.ts                 # フォーム・予約型
│   └── store.ts                # 店舗型
└── utils/                      # ユーティリティ関数
data/                           # データファイル (開発用)
├── stores.json                 # 店舗データ
├── forms_st*.json              # 店舗別フォームデータ
└── reservations.json           # 予約データ（全店舗共通）
```

## 🚀 開発環境セットアップ

> **📖 詳細なセットアップガイド**: [`SETUP.md`](SETUP.md) を参照
> 
> **📋 日常的な開発フロー**: [`WORKFLOW.md`](WORKFLOW.md) を参照 ⭐ **開発者必読**

### 前提条件
- Node.js 20以上
- **pnpm 9以上** (npm/yarn 使用禁止)

#### 初回セットアップの方（Node.jsがまだインストールされていない場合）

**Node.jsのインストール:**
1. [Node.js公式サイト](https://nodejs.org/)にアクセス
2. LTS版（推奨版）をダウンロードしてインストール
3. インストール後、ターミナルで確認：
   ```bash
   node --version  # v18.0.0以上であることを確認
   npm --version   # npmも一緒にインストールされます
   ```

**Gitのインストール（必要な場合）:**
- [Git公式サイト](https://git-scm.com/)からダウンロード
- または、macOSの場合：`xcode-select --install`
- Windowsの場合：[Git for Windows](https://gitforwindows.org/)

**推奨エディタ:**
- [Visual Studio Code](https://code.visualstudio.com/) + 以下の拡張機能：
  - TypeScript and JavaScript Language Features
  - ES7+ React/Redux/React-Native snippets
  - Tailwind CSS IntelliSense
  - Prettier - Code formatter

### クイックスタート（ローカル開発）

```bash
# 1. リポジトリのクローン
git clone https://github.com/wakuwakusystemsharing/form-management.git
cd form-management

# 2. 依存関係のインストール (pnpm 必須)
pnpm install

# 3. 環境変数の設定
cp .env.local.example .env.local
# NEXT_PUBLIC_APP_ENV=local のまま (JSON ファイルモード)

# 4. 開発サーバーの起動
pnpm dev
```

ブラウザで http://localhost:3000 にアクセス

### 開発フロー（実際の作業）

```bash
# 1. 新機能の開発開始
git checkout staging
git pull origin staging
git checkout -b feature/your-feature

# 2. 開発
pnpm dev  # ローカルで開発

# 3. Staging で確認
git add .
git commit -m "feat: 新機能追加"
git push origin feature/your-feature
# → staging にマージして確認

# 4. 本番デプロイ
# staging → main の Pull Request を作成してマージ
```

詳細は [`WORKFLOW.md`](WORKFLOW.md) を参照

### 利用可能なコマンド

- `npm run dev` - 開発サーバー起動
- `npm run build` - プロダクションビルド
- `npm run start` - プロダクションサーバー起動
- `npm run lint` - ESLintによるコード検査
- `npm run type-check` - TypeScriptの型チェック

## 📖 使用方法

### サービス管理者画面
1. `/admin` でサービス管理画面にアクセス
2. 店舗管理で新規店舗を作成
3. `/admin/{storeId}` で店舗詳細画面を開く
4. テンプレート選択でフォームを作成：
   - **基本**: シンプルなメニュー選択
   - **スタンダード**: 性別選択機能付き
   - **プレミアム**: サブメニュー対応
   - **コンプリート**: オプション・来店回数選択
   - **アルティメット**: 全機能（クーポン・リピート予約）
5. 「全予約一覧」ボタンで全店舗の予約データを確認
6. 店舗削除（危険ゾーン）で店舗と関連フォームを一括削除

### 店舗管理者画面
1. `/login` でログイン（開発中は認証なしでアクセス可能）
2. `/{storeId}/admin` で店舗ダッシュボードにアクセス
3. 「予約一覧」ボタンで自店舗の予約データを確認
4. フォーム一覧で編集したいフォームを選択
5. 各タブで設定を行う：
   - **基本情報**: 店舗情報、テーマカラー設定
   - **メニュー**: カテゴリ・メニューの管理（画像アップロード対応）
   - **営業時間**: 営業時間、休業日設定
   - **オプション**: 性別選択、クーポン等の設定
6. プレビューで確認後、公開
7. 「再デプロイ」ボタンでVercel Blobに静的HTMLをデプロイ

### 顧客向けフォーム
1. `/form/{formId}` でフォームにアクセス
2. 設定に応じて以下を選択：
   - 性別選択（設定されている場合）
   - 来店回数選択（設定されている場合）
   - クーポン利用（設定されている場合）
3. メニュー選択（画像確認可能）
4. サブメニュー・オプション選択
5. 予約日時選択
6. 顧客情報入力
7. 予約確定（Google Apps Scriptに送信）

## 🔧 設定とカスタマイズ

### テンプレート機能
フォーム作成時に5つのテンプレートから選択可能：

| テンプレート | 機能 |
|------------|------|
| 基本 | シンプルなメニュー選択 |
| スタンダード | + 性別選択 |
| プレミアム | + サブメニュー |
| コンプリート | + オプション・来店回数 |
| アルティメット | + クーポン・リピート予約 |

### 画像アップロード
- 対応形式: PNG, JPEG, GIF, WebP (最大5MB)
- Vercel Blob Storage経由でアップロード
- パス: `menu_images/{storeId}/{menuId}.{ext}`
- 顧客フォームでポップアップ表示

### フォーム構造の互換性
- 新形式（簡易構造）と旧形式（config構造）の両方に対応
- APIレベルで自動正規化

## 🏗 アーキテクチャ

### データフロー
1. **サービス管理者** → テンプレート選択 → フォーム作成
2. **店舗管理者** → フォーム編集 → 設定保存
3. **顧客** → フォーム入力 → GAS送信 → 予約完了

### API設計
- `/api/stores` - 店舗管理（CRUD）
- `/api/stores/{storeId}` - 個別店舗操作
- `/api/stores/{storeId}/forms` - 店舗別フォーム管理
- `/api/stores/{storeId}/reservations` - 店舗別予約一覧
- `/api/forms/{formId}` - フォーム個別操作
- `/api/forms/{formId}/deploy` - Vercel Blobデプロイ
- `/api/reservations` - 全予約管理（サービス管理者用）
- `/api/upload/menu-image` - 画像アップロード
- RESTful設計でCRUD操作対応

## 🚀 デプロイメント

### プロダクションビルド
```bash
npm run build
npm run start
```

### 環境変数
`.env.local`ファイルで以下の設定：
```bash
# アプリケーション環境
NEXT_PUBLIC_APP_ENV=local  # local | staging | production

# Vercel Blob Storage（画像・静的デプロイ）
BLOB_READ_WRITE_TOKEN=your_vercel_blob_token

# Supabase（データベース・認証）
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# その他
NEXT_PUBLIC_APP_URL=https://your-domain.com
```

**環境の自動切り替え**:
- `NEXT_PUBLIC_APP_ENV=local`: JSON ファイルベース（ローカル開発）
- `NEXT_PUBLIC_APP_ENV=staging/production`: Supabase（本番環境）
- 環境変数未設定時: URLから自動判定（localhost → local, vercel.app → staging/production）

### Vercel Blob Storageの設定
1. Vercelプロジェクトで「Storage」タブを開く
2. 「Create Database」→「Blob」を選択
3. トークンを生成して`.env.local`に追加
4. 詳細: [Vercel Blob Documentation](https://vercel.com/docs/storage/vercel-blob)

### デプロイ先候補
- **Vercel**: Next.jsに最適化（推奨）
- **Netlify**: 静的サイトホスティング
- **AWS Amplify**: フルスタック対応

## 🤝 開発ガイド

### 新機能の追加
1. `src/types/form.ts` で型定義を追加
2. APIルートを `src/app/api/` に実装
3. UIコンポーネントを作成
4. テンプレート機能に統合

### コード規約
- TypeScriptの厳格モード使用
- ESLint + Prettier でコード品質維持
- Next.js App Routerの規約に従う
- Tailwind CSSでスタイリング

### デバッグ
- フォーム構造の互換性問題 → API正規化を確認
- 画像アップロード問題 → Vercel Blob設定を確認
- GAS連携問題 → エンドポイントURL設定を確認
- 認証エラー → ミドルウェアとSupabase設定を確認

## 🔐 認証システム

### ユーザー役割
- **サービス管理者**: 全店舗・全予約へのアクセス権限
- **店舗管理者**: 自店舗のみアクセス可能（ログイン必須）
- **顧客**: LINE LIFF経由で予約フォームにアクセス

### 実装状況
- ✅ ログインページ作成（`/login`）
- ✅ 認証ミドルウェア（`src/middleware.ts`）- UI ページアクセス制御のみ
- ✅ API 認証 - 各 API ルート内で独立処理
- ✅ Supabase Auth統合（middleware.ts で getUser() チェック）
- ✅ Admin Client（RLSバイパス）でサービス管理者権限実装
- ✅ 予約管理API（店舗別・全体）
- ✅ ローカル環境は認証スキップ（開発効率化）
- ✅ Row Level Security適用
- ✅ credentials: 'include' で Cookie 自動送信（本番環境対応）
- ✅ PR ベースマージ - GitHub branch protection rules で main 保護

## 📦 データベース設計（Supabase）

### 主要テーブル

#### `stores` テーブル
- `id` (uuid) - 店舗ID（自動生成）
- `name` (text) - 店舗名
- `owner_name`, `owner_email` (text) - オーナー情報
- `phone`, `address`, `website_url`, `description` (text, nullable) - 店舗詳細
- `created_at`, `updated_at` (timestamptz)

#### `forms` テーブル（予約フォーム）
- `id` (uuid) - フォームID（自動生成）
- `store_id` (uuid, nullable) - 店舗ID（外部キー）
- `name` (text, nullable) - フォーム名（後方互換性のため）
- `form_name` (text, nullable) - フォーム名（新形式）
- `status` (text, default 'inactive') - 'active' | 'inactive'
- `draft_status` (text, default 'none') - 'none' | 'draft' | 'ready_to_publish'
- `config` (jsonb) - フォーム設定
- `static_deploy` (jsonb, nullable) - デプロイ情報
- `last_published_at` (timestamptz, nullable)
- `line_settings` (jsonb, nullable) - LINE設定（LIFF ID等）
- `gas_endpoint` (text, nullable) - Google Apps Script URL
- `ui_settings` (jsonb, nullable) - UI設定
- `created_at`, `updated_at` (timestamptz)

#### `survey_forms` テーブル（アンケートフォーム）
- `id` (uuid) - アンケートフォームID（自動生成）
- `store_id` (uuid, NOT NULL) - 店舗ID（外部キー）
- `name` (text, NOT NULL) - アンケートフォーム名
- `config` (jsonb) - アンケート設定
- `status` (text, default 'draft') - 'active' | 'inactive' | 'paused' | 'draft'
- `draft_status` (text, default 'none') - 'none' | 'draft' | 'ready_to_publish'
- `public_url` (text, nullable) - 公開URL
- `storage_url` (text, nullable) - ストレージURL
- `static_deploy` (jsonb, nullable) - デプロイ情報
- `created_at`, `updated_at` (timestamptz)

#### `reservations` テーブル
- `id` (uuid) - 予約ID（自動生成）
- `form_id`, `store_id` (uuid, nullable) - 関連ID
- `customer_name` (text) - 顧客名
- `customer_email` (text, nullable) - 顧客メールアドレス
- `customer_phone` (text, nullable) - 顧客電話番号
- `reservation_date` (date) - 予約日
- `reservation_time` (time) - 予約時間
- `menu_items` (jsonb) - 選択メニュー
- `options` (jsonb) - 選択オプション
- `notes` (text, nullable) - 備考
- `created_at`, `updated_at` (timestamptz)

#### `store_admins` テーブル
- `id` (uuid) - 管理者ID（自動生成）
- `user_id` (uuid, nullable) - ユーザーID（外部キー）
- `store_id` (uuid, nullable) - 店舗ID（外部キー）
- `created_at` (timestamptz)

### データアクセス制御
- **サービス管理者**: Admin Client（RLSバイパス）で全データアクセス
- **店舗管理者**: RLSで `store_id` による制限（実装予定）
- **顧客**: 予約作成のみ（公開API）

### ID形式
- **Staging/Production**: UUID（Supabase自動生成）
- **Local開発**: `st{timestamp}` 形式（JSON互換性維持）

## 🌍 環境別設定

### 環境の種類

| 環境 | URL | ブランチ | 用途 | データベース | Storage |
|------|-----|---------|------|-------------|---------|
| **Production（本番）** | https://form-management-seven.vercel.app | `main` | 商用・実運用 | Supabase Production (新規プロジェクト、Pro プラン) | Supabase Storage Production |
| **Staging（プレビュー）** | https://form-management-staging.vercel.app | `staging` | テスト・検証 | Supabase Staging (既存プロジェクト) | Supabase Storage Staging |
| **Local（開発）** | http://localhost:3000 | `staging` | ローカル開発 | JSON ファイル | Mock (ローカルファイル) |

### 環境別の主な違い

#### 🟢 Production（form-management-seven.vercel.app）
- **用途**: 商用・実運用環境
- **認証**: Supabase Auth 本番環境
- **データベース**: Supabase Production プロジェクト（**新規作成、Pro プラン推奨**）
- **ストレージ**: Supabase Storage Production (`prod/forms/{storeId}/{formId}/config/current.html`)
- **デプロイ**: `main` ブランチへマージ時に自動デプロイ
- **RLS**: Row Level Security 有効
- **特徴**: 本番データが保存される、実際のユーザーが利用、**staging とは完全に分離**

#### 🟡 Staging（form-management-staging.vercel.app）
- **用途**: テスト・検証・デモ
- **認証**: Supabase Auth ステージング環境（テスト用アカウント）
- **データベース**: Supabase Staging プロジェクト（**既存プロジェクトを継続使用**）
- **ストレージ**: Supabase Storage Staging (`staging/forms/{storeId}/{formId}/config/current.html`)
- **デプロイ**: `staging` ブランチへプッシュ時に自動デプロイ
- **RLS**: Row Level Security 有効
- **特徴**: 開発チーム向け、新機能テスト、PR レビュー用、**production とは完全に分離**

#### 🔵 Local（localhost:3000）
- **用途**: ローカル開発・デバッグ
- **認証**: スキップ（全機能アクセス可能）
- **データベース**: `data/` フォルダの JSON ファイル
- **ストレージ**: Mock（`public/static-forms/` に出力）
- **デプロイ**: なし（`pnpm dev` で実行）
- **RLS**: 適用なし
- **特徴**: 認証不要、高速開発、オフライン対応可能

### 環境変数の管理

```bash
# Local 開発環境（.env.local）
NEXT_PUBLIC_APP_ENV=local

# Staging 環境（Vercel Environment Variables - Preview）
NEXT_PUBLIC_APP_ENV=staging
NEXT_PUBLIC_SUPABASE_URL=<既存プロジェクトのURL>  # Staging 用 Supabase プロジェクト
NEXT_PUBLIC_SUPABASE_ANON_KEY=<既存プロジェクトのanon-key>
SUPABASE_SERVICE_ROLE_KEY=<既存プロジェクトのservice-role-key>

# Production 環境（Vercel Environment Variables - Production）
NEXT_PUBLIC_APP_ENV=production
NEXT_PUBLIC_SUPABASE_URL=<新規プロジェクトのURL>  # Production 用 Supabase プロジェクト（新規作成）
NEXT_PUBLIC_SUPABASE_ANON_KEY=<新規プロジェクトのanon-key>
SUPABASE_SERVICE_ROLE_KEY=<新規プロジェクトのservice-role-key>
```

