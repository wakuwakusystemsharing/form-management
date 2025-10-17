# システムアーキテクチャ全体設計

LINE LIFFを活用した予約フォーム管理システムの全体設計、要件、データフロー、技術的決定を説明します。

## 📊 システム概要

```
┌─────────────────────────────────────────────────────────────────┐
│                        LINE LIFF ユーザー                         │
│              (LINE内の予約フォーム - 静的HTML)                   │
└────────────────┬────────────────────────────────────────────────┘
                 │
         ┌───────▼────────┐
         │  Vercel Blob   │
         │ Static Forms   │
         │ (HTML Deploy)  │
         └────────────────┘
                 ▲
                 │
┌────────────────┴────────────────────────────────────────────────┐
│                    Vercel Deployment                            │
├──────────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────────────┐│
│ │               Next.js 15 (App Router)                         ││
│ ├──────────────────────────────────────────────────────────────┤│
│ │ Frontend (React/TypeScript)                                   ││
│ │ ├─ /admin - サービス管理者ページ                              ││
│ │ ├─ /[storeId]/admin - 店舗管理ダッシュボード                 ││
│ │ ├─ /[storeId]/forms/[formId] - フォーム編集画面              ││
│ │ └─ /login - ログイン画面                                     ││
│ ├──────────────────────────────────────────────────────────────┤│
│ │ Backend (API Routes)                                          ││
│ │ ├─ /api/stores/* - 店舗管理API                               ││
│ │ ├─ /api/forms/* - フォーム管理API                            ││
│ │ ├─ /api/forms/[formId]/deploy - 静的HTML生成・デプロイ       ││
│ │ ├─ /api/reservations/* - 予約管理API                        ││
│ │ └─ /api/upload/* - 画像アップロードAPI                       ││
│ ├──────────────────────────────────────────────────────────────┤│
│ │ Middleware (認証・ルーティング)                              ││
│ │ ├─ UI ページアクセス制御 (/admin, /[storeId]/admin など)      ││
│ │ ├─ RLS バイパス判定                                          ││
│ │ └─ アクセストークン検証                                       ││
│ └──────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
         │                  │                 │
         ├─ staging        ├─ production     └─ local dev
         │                 │                    (JSON)
    ┌────▼──────┐    ┌────▼──────┐
    │ Supabase  │    │ Supabase  │
    │ Staging   │    │ Production│
    └───────────┘    └───────────┘
```

## 🏗️ レイヤー構成

### 1. プレゼンテーション層（React/TypeScript）

**責務**: ユーザーインターフェース、ユーザー入力の処理、API との通信

**主要ページ**:
- `/admin` - サービス管理者ダッシュボード（店舗・フォーム・予約一覧）
- `/[storeId]/admin` - 店舗管理者ダッシュボード
- `/[storeId]/forms/[formId]` - フォーム編集画面（複数タブ対応）
- `/login` - ログイン画面（Supabase Auth連携）
- `/form/[formId]` - 顧客向けプレビュー（静的HTML描画）

**特徴**:
- Server Components + Client Components を適切に分離
- 状態管理は React hooks のみ（Zustand/Redux 不使用）
- 深くコピーしてイミュータブルな更新
- 認証は middleware + ログイン画面で制御

### 2. API 層（Next.js API Routes）

**責務**: ビジネスロジック、データベース操作、外部サービス連携

**API エンドポイント**:
```
POST /api/stores - 店舗作成
GET  /api/stores - 店舗一覧
GET  /api/stores/[storeId] - 店舗詳細
PUT  /api/stores/[storeId] - 店舗更新
DELETE /api/stores/[storeId] - 店舗削除

POST /api/stores/[storeId]/forms - フォーム作成
GET  /api/stores/[storeId]/forms - フォーム一覧（店舗別）
GET  /api/forms/[formId] - フォーム詳細
PUT  /api/forms/[formId] - フォーム更新
DELETE /api/forms/[formId] - フォーム削除
POST /api/forms/[formId]/deploy - 静的HTML生成・デプロイ

POST /api/reservations - 予約作成
GET  /api/reservations - 全予約一覧（管理者用）
GET  /api/stores/[storeId]/reservations - 店舗別予約一覧

POST /api/upload/menu-image - メニュー画像アップロード
```

**認証方針**:
- middleware では UI ページアクセスのみ制御
- API 内で独立した認証チェック（admin client 使用可能）
- 全 API に `credentials: 'include'` で Cookie 送信

### 3. データアクセス層

#### ローカル開発（JSON ファイル）
```
data/
├── stores.json - 店舗一覧
├── forms.json - 全フォーム（マイグレーション用）
├── forms_st{storeId}.json - 店舗別フォーム
├── reservations.json - 予約一覧
└── forms_st{storeId}.json - 店舗別フォーム
```

#### Staging / Production（Supabase）
```
Database Tables:
├── stores - 店舗マスタ
├── forms - フォーム定義（config は JSONB）
├── reservations - 予約データ
├── store_admins - 店舗管理者の権限管理
└── profiles - ユーザープロファイル

RLS (Row Level Security):
├── stores: 全員読み取り可、管理者のみ更新/削除
├── forms: 店舗別RLS、管理者は全店舗アクセス可
├── reservations: 同上
└── store_admins: 管理者のみアクセス可
```

### 4. ストレージ層

#### Vercel Blob（顧客向けフォーム HTML）
```
Staging:  staging/forms/{storeId}/{formId}.html
Prod:     prod/forms/{storeId}/{formId}.html
Local:    /public/static-forms/{formId}.html (mock)
```

#### Vercel Blob（メニュー画像）
```
Staging:  staging/menu_images/{storeId}/{menuId}.{ext}
Prod:     prod/menu_images/{storeId}/{menuId}.{ext}
Local:    /public/uploads/{storeId}/{menuId}.{ext} (mock)
```

### 5. 静的HTML生成・デプロイ

**フロー**:
1. サービス管理者が「保存＆デプロイ」をクリック
2. API `/api/forms/{formId}/deploy` を呼び出し
3. `StaticFormGenerator.generateHTML()` で HTML を生成
4. `VercelBlobDeployer.deployForm()` で Blob に アップロード
5. `static_deploy` 情報を DB に記録
6. 顧客が LINE で フォーム URL にアクセス → 静的 HTML を表示

**技術的特徴**:
- HTML 内に LIFF SDK + JavaScript を埋め込み
- React 不使用（軽量化のため vanilla JS）
- テーマカラーはインライン CSS で適用
- すべての設定（menu_structure など）を `FORM_CONFIG` として JSON 埋め込み

## 🔐 認証・認可設計

### ユーザー役割

| 役割 | アクセス可能な機能 | 認証方法 |
|------|-------------------|---------|
| **サービス管理者** | 全店舗・全フォーム・全予約 | Supabase Auth + admin email 確認 |
| **店舗管理者** | 自店舗のみ（admin email は不要） | Supabase Auth + RLS |
| **顧客（LINE LIFF）** | 該当フォームのみ | 不要（公開URL） |
| **ローカル開発** | 全機能（認証スキップ） | -（開発用） |

### 認証フロー

```
① ユーザーが /admin にアクセス
   ↓
② middleware が認証チェック
   - ローカル環境: スキップ
   - 本番系: Supabase から user 取得
   ↓
③ user が見つからない → /login にリダイレクト
④ ログイン成功 → accessToken を Cookie に保存
   ↓
⑤ API 呼び出し時に credentials: 'include' で Cookie 送信
⑥ API ルート内で getUser() でトークン検証
⑦ RLS で 店舗別データ 制御
```

## 📝 データモデル

### Form（フォーム定義）

```typescript
interface Form {
  id: string; // UUID または st{timestamp}
  store_id: string; // UUID または st{timestamp}
  config: FormConfig; // JSONB - 複雑な構造化データ
  draft_config?: FormConfig; // 下書き版config
  status: 'active' | 'inactive' | 'paused';
  draft_status: 'none' | 'draft' | 'ready_to_publish';
  form_name: string; // フォーム名（タイトル）
  line_settings?: { liff_id: string }; // LIFF ID
  gas_endpoint?: string; // Google Apps Script URL
  static_deploy?: StaticDeploy; // デプロイ情報
  created_at: string; // ISO 形式
  updated_at: string;
  last_published_at?: string;
}

interface FormConfig {
  basic_info: {
    form_name: string;
    store_name: string;
    liff_id: string;
    theme_color: string;
    logo_url?: string;
  };
  menu_structure: {
    structure_type: 'category_based' | 'simple';
    categories: MenuCategory[];
    display_options: DisplayOptions;
  };
  gender_selection: {
    enabled: boolean;
    required: boolean;
    options: SelectOption[];
  };
  visit_count_selection: { ... };
  coupon_selection: { ... };
  calendar_settings: {
    business_hours: BusinessHours;
    advance_booking_days: number;
  };
  ui_settings: {
    theme_color: string;
    button_style: 'rounded' | 'square';
    show_repeat_booking: boolean;
    show_side_nav: boolean;
  };
  validation_rules: { ... };
}
```

### Store（店舗）

```typescript
interface Store {
  id: string; // UUID
  name: string;
  owner_name: string;
  owner_email: string;
  phone?: string;
  address?: string;
  description?: string;
  website_url?: string;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}
```

## 🔄 主要フロー

### 1. フォーム作成フロー

```
サービス管理者
  ↓ 店舗を選択 → フォーム作成ボタン
  ↓ テンプレート選択 → 基本情報入力
API: POST /api/stores/[storeId]/forms
  ↓
  ├─ Local: JSON に保存
  └─ Staging/Prod: Supabase に INSERT
  ↓ 同時に自動デプロイ
  ├─ StaticFormGenerator で HTML 生成
  └─ VercelBlobDeployer で Blob にアップロード
  ↓ 初期状態
  - status: 'inactive'
  - draft_status: 'none'
  - static_deploy: { url, deployed_at, status: 'deployed' }
```

### 2. フォーム編集・保存フロー

```
店舗管理者が /[storeId]/forms/[formId] でフォーム編集
  ↓ 複数タブでメニュー・営業時間などを設定
  ↓ 「保存」ボタン クリック
API: PUT /api/forms/[formId]
  ↓
  ├─ Local: JSON ファイル更新
  └─ Staging/Prod: Supabase 更新（RLS 確認）
  ↓ レスポンス
  - status: 200
  - updated_at: 現在時刻
  - アラート: "フォームを保存しました"
```

### 3. 静的HTML デプロイフロー

```
店舗管理者が「保存＆デプロイ」クリック
  ↓ 1. PUT /api/forms/{formId} で保存
  ↓ 2. POST /api/forms/{formId}/deploy でデプロイ
  ↓
StaticFormGenerator:
  ├─ config から HTML テンプレート生成
  ├─ すべての設定を FORM_CONFIG に埋め込み
  ├─ テーマカラーをインライン CSS で適用
  └─ LIFF SDK + JavaScriptで予約処理実装
  ↓
VercelBlobDeployer:
  ├─ 環境別 path に決定
  │  ├─ staging: staging/forms/{storeId}/{formId}.html
  │  └─ prod: prod/forms/{storeId}/{formId}.html
  ├─ Blob API で アップロード
  └─ URL を返す
  ↓ DB 更新
  - static_deploy: { url, deployed_at: now, status: 'deployed' }
  - last_published_at: now
  ↓ 顧客が LINE でフォーム URL アクセス
  → 静的 HTML が表示される（React なし）
```

## 🛡️ エラーハンドリング

### 防御的な実装

1. **normalizeForm()** - 旧形式・新形式の互換性
   - Supabase JSONB が string で返される場合をパース
   - 不足しているフィールドにデフォルト値を補完

2. **StaticFormGenerator.generateHTML()** - undefined チェック
   - safeConfig に深コピーして修正
   - 全フィールドを初期化（null check を明示的に）
   - テンプレート内で ?. オプショナルチェーニング

3. **API エラー** - 日本語メッセージ
   - 400: "必須フィールドが不足しています"
   - 404: "フォームが見つかりません"
   - 500: "内部サーバーエラーが発生しました"

## 📚 関連ドキュメント

- **SETUP.md** - 環境セットアップ手順
- **API_SPECIFICATION.md** - API 詳細仕様
- **DATABASE_MIGRATION.md** - DB マイグレーション歴
- **WORKFLOW.md** - 開発ワークフロー
- **SUPABASE_BEST_PRACTICES.md** - Supabase ベストプラクティス
- **MCP_SETUP_GUIDE.md** - MCP サーバ設定

---

**最終更新**: 2025年1月
