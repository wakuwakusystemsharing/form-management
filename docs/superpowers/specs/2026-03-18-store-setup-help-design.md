# 店舗セットアップヘルプ & フォームカード設定ステータス表示

**日付:** 2026-03-18
**ステータス:** 承認済み

## 概要

サービス管理者向けの店舗セットアップ運用ガイド（ヘルプページ）と、フォームカード上の設定ステータスバッジを実装する。

## 背景

店舗を新規追加した後、Google Calendar連携やLINE設定など複数の手順が必要だが、現状それを案内する仕組みがない。また、設定が不足した状態でフォームを作成しても、何が足りないか一目でわからない。

## 対象ユーザー

- **サービス管理者のみ** — 店舗管理者は参照不要（設定はすべてサービス管理者が実施）

## 設計

### 1. 店舗設定状態の判定ユーティリティ

**新規ファイル:** `src/lib/store-setup-status.ts`

```typescript
type SetupItem = {
  key: string;           // 'google_calendar' | 'line_channel'
  label: string;         // 日本語ラベル
  status: 'complete' | 'incomplete';
  requiredFor: ('line' | 'web')[];
  helpAnchor: string;    // ヘルプページのアンカーID
};

type StoreSetupStatus = {
  items: SetupItem[];
  isReadyFor: (formType: 'line' | 'web') => boolean;
  getMissingFor: (formType: 'line' | 'web') => SetupItem[];
};

function getStoreSetupStatus(store: Store): StoreSetupStatus
```

**判定ルール:**

| 設定項目 | 判定条件 | 必須対象フォームタイプ |
|---|---|---|
| Google Calendar | `store.google_calendar_id` が存在する | `line`, `web`（全フォーム） |
| LINEチャネル | `store.line_channel_access_token` が存在する | `line` のみ |

### 2. フォームカード設定ステータスバッジ

**変更ファイル:** `src/app/admin/[storeId]/page.tsx`

フォームカードのフォーム名の下に、不足設定をバッジ型で表示。

- **不足あり:** 黄色の丸バッジ `⚠ {項目名}未設定`（クリックで `/admin/help#{helpAnchor}` に遷移）
- **設定完了:** 緑の丸バッジ `✓ 設定完了`
- フォームの `form_type`（`line` or `web`）に応じて、必要な設定項目のみチェック

### 3. ヘルプページ

**新規ファイル:** `src/app/admin/help/page.tsx`

左サイドバー目次 + 右メインコンテンツのレイアウト。

**セクション構成:**

1. **店舗作成** — 基本情報の入力手順（必須/任意項目の説明）
2. **Google Calendar連携**（必須ラベル）
   - 方式A: サービスアカウント（推奨） — 管理画面からカレンダー自動作成
   - 方式B: 店舗OAuth連携 — Googleアカウント認証フロー
3. **LINE設定**（LINEフォーム利用時必須ラベル）
   - 3-1. チャネルアクセストークン取得・設定
   - 3-2. Webhook URL設定（`https://{domain}/api/webhooks/line?storeId={storeId}`）
   - 3-3. LIFFアプリ作成・エンドポイント設定
4. **フォーム作成** — テンプレート選択、フォームタイプ選択
5. **デプロイ・公開** — 保存＆デプロイ手順、公開URL確認

各セクションにアンカーID付与（`#store-creation`, `#google-calendar`, `#line-setup`, `#form-creation`, `#deploy`）。

`?storeId={storeId}` パラメータがある場合、ページ上部に該当店舗の設定状態サマリーを表示。

### 4. ヘルプへのアクセス導線

**変更ファイル:** `src/app/admin/page.tsx`, `src/app/admin/[storeId]/page.tsx`

- ヘッダー右上に `HelpCircle`（lucide-react）アイコンを追加
- `/admin/page.tsx` → `/admin/help` にリンク
- `/admin/[storeId]/page.tsx` → `/admin/help?storeId={storeId}` にリンク

## ファイル一覧

| ファイル | 操作 | 内容 |
|---|---|---|
| `src/lib/store-setup-status.ts` | 新規 | 設定状態判定ユーティリティ |
| `src/app/admin/help/page.tsx` | 新規 | ヘルプページ |
| `src/app/admin/[storeId]/page.tsx` | 変更 | フォームカードバッジ + ヘッダーヘルプリンク |
| `src/app/admin/page.tsx` | 変更 | ヘッダーヘルプリンク |

## 補足事項

### Middleware対応
`/admin/help` はサービス管理者専用のため、認証必須で問題ない。現在のmiddleware（`src/middleware.ts`）は `/admin` 以下を認証必須としているが、`/admin/help` パスは既存のパターンマッチ（`/admin` 完全一致 or `/admin/{storeId}` パターン）に該当しない可能性がある。必要に応じてmiddlewareのルート判定を更新する。

### form_type のデフォルト値
`config.form_type` が `undefined` の場合は `'line'` として扱う（既存のフォーム作成フォームのデフォルトが `'line'`）。バッジ表示時は `form.config?.form_type ?? 'line'` で判定。

### アンケートフォーム
今回のスコープは予約フォームのみ。アンケートフォームへの拡張は別タスク。

### バッジ配置
既存のフォームカード構造（フォーム名 + ステータスバッジ行 → ID行 → URL行 → アクションボタン）に対し、ステータスバッジ行とID行の間に設定ステータスバッジ行を挿入する。

### ヘルプページの店舗データ取得
`?storeId` がある場合、クライアントサイドで `/api/stores/{storeId}` をfetchして設定状態を表示。storeIdが無効または取得失敗時はサマリーを非表示にし、手順のみ表示。

## UI仕様

- shadcn/ui + Tailwind CSS v4
- アイコン: lucide-react（`HelpCircle`, `AlertTriangle`, `CheckCircle2`）
- バッジ色: 警告=amber系（`bg-amber-100 text-amber-800`）、完了=green系（`bg-green-100 text-green-800`）
- ヘルプページ: レスポンシブ対応（モバイルではサイドバー非表示、上部に目次リスト）
