# システム概要仕様書

> 対象読者: 新規開発者・AIエージェント
> 最終更新: 2026年3月15日

---

## 1. システム目的

LINE LIFF を活用した予約フォーム管理システム。サービス管理者がテンプレートから予約フォームを作成し、店舗管理者が設定をカスタマイズし、顧客が LINE 経由で予約を送信できる仕組みを提供する。フォームは静的 HTML として生成され Supabase Storage にデプロイされるため、ランタイム依存なしに顧客へ配信できる。

---

## 2. 3層アーキテクチャ

システムは利用者ロールに対応した3つの層で構成される。

### サービス管理者層（`/admin`）

- ハードコードされたメールアドレスで識別されるサービス全体の管理者
- 全店舗・全フォーム・全予約・全アンケートを横断的に管理
- 店舗の作成・削除、フォームテンプレートの選択、Google Calendar 連携設定などを担当
- Admin Client（RLS バイパス）を使用して Supabase に接続

### 店舗管理者層（`/{storeId}/admin`）

- 各店舗に紐づくユーザー（`store_admins` テーブルで管理）
- 自店舗のフォーム編集・デプロイ、予約確認・分析、顧客管理（CRM）を担当
- Supabase Auth + RLS によって自店舗データのみアクセス可能

### 顧客層（静的 HTML フォーム、LINE LIFF 経由）

- Supabase Storage にデプロイされた静的 HTML を `/api/public-form/*` プロキシ経由で受け取る
- LINE アプリ内の LIFF ブラウザ上で動作し、React は不使用（vanilla JS のみ）
- フォーム送信後、`/api/reservations` に POST して予約レコードを作成し、CRM へ自動紐付けされる

---

## 3. データ層戦略

`NEXT_PUBLIC_APP_ENV` 環境変数の値によってデータ層が切り替わる。

### Local（`NEXT_PUBLIC_APP_ENV=local`）

- `data/` ディレクトリ内の JSON ファイルを使用
  - `data/stores.json` — 店舗一覧
  - `data/forms_st{storeId}.json` — 店舗別フォーム
  - `data/reservations.json` — 予約一覧
- Supabase への接続なし
- 認証スキップ（`shouldSkipAuth()` が `true`）
- Supabase Storage はモック（`/public/static-forms/` にローカル保存）

### Staging / Production（`NEXT_PUBLIC_APP_ENV=staging` または `production`）

- Supabase PostgreSQL を使用（RLS 有効）
- `NEXT_PUBLIC_SUPABASE_URL` 環境変数で適切なプロジェクトに自動接続
- Staging と Production はそれぞれ **独立した Supabase プロジェクト**（パスプレフィックスでなくプロジェクトレベルで分離）
- Storage バケット名は両環境で `forms`（プロジェクトが別なので分離される）

---

## 4. 主要データフロー

### フォーム作成 → normalizeForm() → DB 保存

1. サービス管理者が `/admin` でテンプレートを選択しフォームを作成
2. `POST /api/stores/{storeId}/forms` に config オブジェクトを送信
3. API 内で `normalizeForm()` を通し、旧フラット形式と新 `config.*` 形式を統一してデフォルト値を補完
4. Local 環境は JSON ファイルに保存、Staging/Prod は Supabase に INSERT
5. 作成直後に自動デプロイも実行される（`static_deploy` フィールドが更新される）

### フォームデプロイ → 静的 HTML 生成 → Supabase Storage アップロード

1. 店舗管理者が「保存＆デプロイ」をクリック
2. `PUT /api/forms/{formId}` でフォーム全体を保存（部分更新なし）
3. `POST /api/forms/{formId}/deploy` を呼び出し
4. `StaticReservationGenerator.generateHTML()` が config から vanilla JS の HTML を生成（FORM_CONFIG を JSON 埋め込み）
5. `SupabaseStorageDeployer.deployForm()` が `reservations/{storeId}/{formId}/index.html` にアップロード
6. DB の `static_deploy` フィールドにデプロイ情報（URL・日時・status）を記録

### 顧客アクセス → /api/public-form/* プロキシ → 静的 HTML 表示

1. 顧客が LINE 上のフォーム URL を開く
2. `/api/public-form/reservations/{storeId}/{formId}/index.html` プロキシにリクエストが届く
3. Next.js API が Supabase Storage から HTML を取得し、`Content-Type: text/html; charset=utf-8` ヘッダーを付与して返す
4. LINE LIFF ブラウザ上で静的 HTML が描画される（React なし）

### 予約受付 → LINE LIFF → POST /api/reservations → CRM 自動紐付け

1. 顧客が静的フォーム上でメニュー・日時を選択し送信
2. 静的 HTML 内の JavaScript が `POST /api/reservations` を呼び出す
3. API が予約レコードを Supabase に INSERT（`line_user_id` も保存）
4. `customer-utils.ts` の `findOrCreateCustomer()` が LINE ユーザー ID または電話番号で顧客を検索・作成し、`customer_visits` に来店履歴を記録
5. Google Calendar が連携されている場合、カレンダーに予約イベントを作成し `google_calendar_event_id` を保存

---

## 5. 主要コンポーネント（`src/lib/` 配下の役割）

| ファイル | 役割 |
|---|---|
| `form-normalizer.ts` | 後方互換性正規化（`normalizeForm()`）。旧フラット形式と新 `config.*` 形式を統一。フォームを読み取る際は必ずここを通す |
| `static-generator-reservation.ts` | 予約フォーム静的 HTML 生成（vanilla JS のみ、React なし）。LIFF SDK + JavaScript を埋め込み、FORM_CONFIG を JSON として埋め込む |
| `static-generator-survey.ts` | アンケートフォーム静的 HTML 生成。質問設定を `questions` 配列として埋め込む |
| `supabase-storage-deployer.ts` | Storage アップロード/デプロイ。パス: `reservations/{storeId}/{formId}/index.html` および `surveys/{storeId}/{formId}/index.html` |
| `customer-utils.ts` | CRM 顧客管理。LINE ユーザー ID / 電話番号で顧客を自動紐付け。セグメント分類（`new` / `returning` / `vip` / `dormant`）を実施 |
| `google-calendar.ts` | Google Calendar API 操作（カレンダー作成・イベント CRUD）。`DEFAULT_CALENDAR_SHARE_EMAIL` で共有先を定義 |
| `google-calendar-token.ts` | OAuth リフレッシュトークンの暗号化/復号化。`GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY` 環境変数で鍵管理 |
| `auth-helper.ts` | 認証ヘルパー（`getCurrentUser()` 等）。API ルートから呼び出し、ユーザー情報を取得する |
| `env.ts` | 環境検出（`getAppEnvironment()` / `shouldSkipAuth()`）。`NEXT_PUBLIC_APP_ENV` に基づいて JSON vs Supabase を切り替える起点 |
| `supabase.ts` | Supabase クライアントファクトリ。認証クライアント（RLS 有効）と Admin Client（RLS バイパス）を使い分ける |
| `store-id-generator.ts` | ID 生成ロジック。店舗 ID: 6文字ランダム `[a-z0-9]{6}`、フォーム ID: 12文字ランダム文字列 |
| `vercel-blob-deployer.ts` | **⚠️ 廃止予定。使用禁止。** Supabase Storage のみ使用すること。次リリースで削除予定 |

---

## 6. 環境別挙動

### Local（`NEXT_PUBLIC_APP_ENV=local`）

- `data/` ディレクトリの JSON ファイルを直接読み書き
- 認証を完全スキップ（`shouldSkipAuth()` = `true`）
- Supabase Storage はモック（`/public/static-forms/` に保存）
- `pnpm dev` で `localhost:3000` に起動
- シード: `pnpm seed:local`

### Development（`NEXT_PUBLIC_APP_ENV=development`）

- Staging Supabase プロジェクトの dev ブランチを使用（Supabase Branching 機能）
- Vercel Preview デプロイに対応
- RLS 有効、実 Supabase Storage を使用
- `feature/*` または `dev` ブランチからの PR で自動起動

### Staging（`NEXT_PUBLIC_APP_ENV=staging`）

- 既存の Staging 専用 Supabase プロジェクトに接続
- RLS 有効、実 Supabase Storage を使用
- `staging` ブランチへのマージで Vercel に自動デプロイ
- シード: `pnpm seed:staging` / `pnpm seed:staging-demo`

### Production（`NEXT_PUBLIC_APP_ENV=production`）

- Staging とは独立した専用 Supabase プロジェクト（Pro プラン推奨）
- RLS 有効、実 Supabase Storage を使用
- `main` ブランチへのマージで Vercel に自動デプロイ
- `staging` → `main` の PR のみ受け付ける（`dev` からの直接マージ禁止）

---

## 7. 重要な制約（新規参加者・AIエージェントが犯しやすいミス）

1. **pnpm 必須（npm/yarn 禁止）** — `package-lock.json` や `yarn.lock` を生成するとリポジトリの `pnpm-lock.yaml` との整合性が壊れる。常に `pnpm install` / `pnpm add` を使用すること。

2. **フォームを読み取る際は必ず `normalizeForm()` を通す** — Supabase JSONB や JSON ファイルから読んだフォームデータは旧フラット形式の可能性がある。`normalizeForm()` を通さないと `config.*` フィールドが undefined になりランタイムエラーの原因となる。

3. **PUT リクエストはフォームオブジェクト全体を送る（部分更新なし）** — `PUT /api/forms/{formId}` は完全な `Form` オブジェクトを要求する。部分的なオブジェクトを送ると未指定フィールドが消える。

4. **`data/` ディレクトリの JSON ファイルを直接変更しない** — ローカル開発でも API ルート経由でのみデータを操作すること。直接編集するとスキーマ不整合が発生しやすい。

5. **Vercel Blob 使用禁止（Supabase Storage のみ）** — `vercel-blob-deployer.ts` は廃止予定。新規コードで `VercelBlobDeployer` や Vercel Blob API を呼び出してはいけない。

6. **コミット前に `pnpm type-check` 必須** — TypeScript エラーがあるままコミットすると CI が失敗する。`pnpm type-check` でエラーがゼロになることを確認してからコミットする。

7. **`subdomain` / `custom_domain` カラムは削除済み — コードに追加しない** — `stores` テーブルにこれらのカラムはもう存在しない（マイグレーション `20260308000000_remove_subdomain_columns.sql` で削除）。型定義や API コードに追加しないこと。

8. **フォーム編集時は4点更新ルールに従う** — 新しいフォーム機能を追加する際は以下の4点をすべて更新すること: (1) `src/types/form.ts` の `FormConfig` インターフェース、(2) `normalizeForm()`（`src/lib/form-normalizer.ts`）にデフォルト値追加、(3) `src/components/FormEditor/` の編集 UI、(4) `src/lib/static-generator-reservation.ts` または `src/lib/static-generator-survey.ts` の HTML 生成ロジック。
