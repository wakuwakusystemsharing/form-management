# 設計書: 店舗管理者画面の検索ウィンドウ追加

**日付:** 2026-05-06
**対象ブランチ:** staging（feature ブランチを切って PR）
**スコープ:** 店舗管理者の「予約一覧」「アンケート回答一覧」「ダッシュボードの最近の予約」に検索機能を追加

---

## 1. 概要

店舗管理者が顧客の名前 / メールアドレス / 電話番号で予約・アンケート回答を絞り込めるようにする。既存の顧客一覧（`/api/stores/{storeId}/customers?search=`）と同じサーバーサイド検索パターンを踏襲し、UI とサーバー双方に最小限の変更で実現する。

## 2. 検索方式

**サーバーサイド方式**（API クエリパラメータ `?search=`）を採用。

- データ量が増えてもスケールする
- ページネーションと両立する
- 既存 `customers` API と一貫する

クライアントサイド方式は採用しない（既存パターンと不一致になり、件数が増えると劣化する）。

## 3. 共通コンポーネント / ユーティリティ

### 3.1 `src/hooks/use-debounce.ts`（新規）

汎用デバウンスフック。lodash は導入しない。

```ts
export function useDebounce<T>(value: T, delayMs: number = 300): T
```

### 3.2 `src/components/ui/search-bar.tsx`（新規）

shadcn 風の共通検索バー。中身は `Input` + lucide `Search` アイコン + クリア（×）ボタン。

| Prop | 型 | 説明 |
|---|---|---|
| `value` | `string` | 現在の入力値（controlled） |
| `onChange` | `(v: string) => void` | 入力イベント（debounce はフック側で行う） |
| `placeholder` | `string?` | 既定: 「名前 / メール / 電話番号で検索」 |
| `className` | `string?` | レイアウト調整用 |

UI 仕様:
- 入力欄左に `Search` アイコン
- 値があるとき右端にクリア（×）ボタン → クリックで `onChange('')`
- IME 入力中は確定後に反映（`composition` イベントで制御）

## 4. API 変更

### 4.1 `GET /api/stores/{storeId}/reservations`（既存・改修）

**追加パラメータ**: `search: string?`

**ファイル**: `src/app/api/stores/[storeId]/reservations/route.ts`

**Supabase 環境**: 既存クエリビルダに以下を追加（trim 後、空文字なら無視）。

```ts
if (search?.trim()) {
  const q = search.trim();
  query = query.or(
    `customer_name.ilike.%${q}%,customer_email.ilike.%${q}%,customer_phone.ilike.%${q}%`
  );
}
```

`%` などの特殊文字を含む入力は事前にエスケープする（`q.replace(/[%_\\]/g, '\\$&')`）。

**Local（JSON）環境**: 配列を `Array.filter()` で同 3 カラムに対し case-insensitive 部分一致。

### 4.2 `GET /api/stores/{storeId}/surveys/responses`（既存・改修）

**追加パラメータ**: `search: string?`

**ファイル**: `src/app/api/stores/[storeId]/surveys/responses/route.ts`

**スキーマ前提（確認済み）**: `surveys` テーブルは
`{ id, responses: JSONB, survey_form_id, store_id, submitted_at, line_user_id, customer_id }`。
顧客識別カラム（`customer_name` 等）は持たず、回答者の名前 / メール / 電話は **すべて `responses` JSONB に動的フィールド ID で格納される**（フォームごとにキー名が異なる）。

そのため標準キーでの絞り込み（`responses->>'name'`）は不可能。次の 2 段構えで OR 検索する:

1. **`responses::text ILIKE '%q%'`** — JSONB を text にキャストして部分一致。回答者が入力した名前 / メール / 電話は確実にここに入る。
2. **`customer_id` 経由で `customers` を join** — `customers.name` / `customers.email` / `customers.phone` を ILIKE。CRM で紐付け済みの回答に対して有効。

副作用として `responses::text` 検索は回答本文中の文字列にもマッチする（例: 自由記述に "佐藤" が含まれていればヒット）。これは制約というより **店舗管理者にとって有用な検索体験**として許容する（厳密な「識別情報のみ」検索は動的キー構造上現実的でない）。

**Local（JSON）環境**: `JSON.stringify(r.responses).toLowerCase().includes(q)` で同等の挙動。

### 4.3 ダッシュボード最近の予約

新規 API は作らず `GET /api/stores/{storeId}/reservations` を再利用する。

**呼び出し側挙動**:
- 検索文字列が空: 既存どおり `limit=5`
- 検索文字列あり: `limit=50` に拡張（5 件では絞り込み結果が役に立たないため）

## 5. UI 配置

### 5.1 `/[storeId]/admin/page.tsx`（タブ型統合画面）

3 箇所に SearchBar を追加。

| 配置 | 概算行 | フィルタ対象 |
|---|---|---|
| ダッシュボード「最近の予約」カード上部 | 約 451 行 | 予約 |
| reservations タブ テーブル上部 | 約 856 行 | 予約 |
| surveys タブ テーブル上部 | 約 1070 行 | アンケート回答 |

それぞれ独立した `useState` で値を保持し、`useDebounce` で 300ms 遅延後に API を再フェッチ。

### 5.2 `/tenant/{tenantSlug}/admin/{storeId}/reservations/page.tsx`

予約一覧のテーブル上部に SearchBar を追加。同じ予約 API を呼ぶので 4.1 の改修で動作する。

## 6. URL 状態

URL クエリ `?search=...` を使う。

- `useSearchParams` で初期値を取得 → SearchBar の `value` 初期値に
- 入力 → debounce 後 → `router.replace(...)` で URL 更新（履歴を汚さない）
- ブラウザの戻る・URL 共有・リロードで同じ検索状態を再現可能

タブと search を併用するため、既存の `?tab=` クエリと共存させる（`URLSearchParams` で個別に扱う）。

## 7. 空状態 / エラー

| 状況 | 表示 |
|---|---|
| 0 件ヒット | 「『{query}』に一致する{予約\|回答}が見つかりませんでした」+ クリアボタン |
| API エラー | 既存のエラー表示パターンに従う（変更なし） |
| 検索文字列なし | 通常一覧 |

## 8. テスト

### 8.1 単体テスト（Vitest）

- `useDebounce`: 値の遅延反映、連続更新時のキャンセル、unmount 時のクリーンアップ
- `<SearchBar />`: クリアボタン挙動、IME 中の onChange 抑制
- API ルートの search ロジック（local JSON モードでフィルタ結果が期待通り）

### 8.2 手動テスト

- localhost（JSON モード）で 3 画面それぞれ検索が効くこと
- staging Supabase で `ilike` が日本語を正しく扱うこと
- URL 共有 → 同じ検索状態が再現されること
- タブ切り替えで検索クエリがクリアされる/保持されるかの挙動を仕様化（仕様: タブ切り替えでは保持しない＝タブごとに独立）

## 9. やらないこと（スコープ外）

- メニュー名・予約ステータス文字列での全文検索（既存ステータスフィルタを使う）
- アンケート回答本文（JSONB の動的フィールド）の全文検索
- フォーム一覧 / 店舗一覧の検索（既存システム管理者ページに既に存在）
- 高度な検索（AND/OR、日付レンジとの複合）
- 検索履歴 / サジェスト

## 10. 影響ファイル一覧

**新規:**
- `src/hooks/use-debounce.ts`
- `src/components/ui/search-bar.tsx`
- `src/hooks/__tests__/use-debounce.test.ts`
- `src/components/ui/__tests__/search-bar.test.tsx`

**改修:**
- `src/app/api/stores/[storeId]/reservations/route.ts`
- `src/app/api/stores/[storeId]/surveys/responses/route.ts`
- `src/app/[storeId]/admin/page.tsx`
- `src/app/tenant/[tenantSlug]/admin/[storeId]/reservations/page.tsx`

## 11. リスクと注意点

- **Supabase の `or()` 内引用符エスケープ**: 値に `,` や `)` を含む場合に PostgREST 式が壊れる可能性 → `%` `_` `\` だけでなく PostgREST メタ文字も考慮する。実装時に `encodeURIComponent` ではなく PostgREST 仕様準拠でエスケープする。
- **電話番号のハイフン揺れ**: `090-1234-5678` と `09012345678` の正規化は今回行わない（既存の顧客検索でも未対応のため）。将来の改善タスク。
- **インデックス**: `customer_name` / `customer_email` / `customer_phone` への ILIKE 検索は seq scan になる可能性。データ量が小規模なうちは問題ないが、将来 `pg_trgm` の GIN インデックスを検討（今回スコープ外）。
