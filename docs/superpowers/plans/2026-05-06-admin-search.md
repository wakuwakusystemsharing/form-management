# 店舗管理者画面の検索ウィンドウ実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 店舗管理者の「予約一覧」「アンケート回答一覧」「ダッシュボード最近の予約」に名前 / メール / 電話番号で絞り込めるサーバーサイド検索ウィンドウを追加する。

**Architecture:** 既存の `customers?search=` と同じパターン。共通の `<SearchBar />` + `useDebounce` フックを新設し、3 つの一覧画面と 1 つのテナント画面に適用。サーバー側は `?search=` クエリで Supabase は `.or(... ilike ...)`、local は配列フィルタで実装。

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, shadcn/ui, lucide-react, Supabase. **テストフレームワーク（Vitest 等）は当リポジトリに未導入のため、検証は `pnpm type-check` + `pnpm lint` + 手動 (`pnpm dev`) で行う。** spec の TDD 要件は test infra 不在のため本 PR では満たさず、test infra 導入は別タスクとする。

**Reference spec:** `docs/superpowers/specs/2026-05-06-admin-search-design.md`

---

## File Structure

### 新規作成
- `src/hooks/use-debounce.ts` — 汎用デバウンスフック
- `src/components/ui/search-bar.tsx` — 共通検索バー UI

### 改修
- `src/app/api/stores/[storeId]/reservations/route.ts` — `?search=` パラメータ対応
- `src/app/api/stores/[storeId]/surveys/responses/route.ts` — `?search=` パラメータ対応
- `src/app/[storeId]/admin/page.tsx` — 3 箇所に SearchBar 配置・state 管理・fetch 連動
- `src/app/tenant/[tenantSlug]/admin/[storeId]/reservations/page.tsx` — SearchBar 配置・fetch 連動

---

## Task 1: `useDebounce` フックの作成

**Files:**
- Create: `src/hooks/use-debounce.ts`

- [ ] **Step 1: ディレクトリ確認**

```bash
ls src/hooks/ 2>/dev/null || mkdir -p src/hooks
```

- [ ] **Step 2: フック実装**

`src/hooks/use-debounce.ts` を新規作成:

```ts
import { useEffect, useState } from 'react';

/**
 * 値の更新を指定ミリ秒だけ遅延させて返す汎用フック。
 * 連続更新時は最後の値だけが反映される。
 */
export function useDebounce<T>(value: T, delayMs: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedValue(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);

  return debouncedValue;
}
```

- [ ] **Step 3: 型チェック**

Run: `pnpm type-check`
Expected: エラーなし

- [ ] **Step 4: コミット**

```bash
git add src/hooks/use-debounce.ts
git commit -m "feat: add useDebounce hook for search input throttling"
```

---

## Task 2: `<SearchBar />` 共通コンポーネントの作成

**Files:**
- Create: `src/components/ui/search-bar.tsx`

- [ ] **Step 1: 既存 Input と Search アイコンの import 確認**

Run: `grep -n "from '@/components/ui/input'" src/components/CustomerList.tsx`
Expected: 既存パスが使えることを確認

- [ ] **Step 2: SearchBar 実装**

`src/components/ui/search-bar.tsx` を新規作成:

```tsx
'use client';

import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}

/**
 * 共通検索バー。Search アイコン + Input + クリア (×) ボタン。
 * デバウンスは利用側で `useDebounce` を使うこと。
 */
export function SearchBar({
  value,
  onChange,
  placeholder = '名前 / メール / 電話番号で検索…',
  className,
  ariaLabel = '検索',
}: SearchBarProps) {
  return (
    <div className={cn('relative w-full', className)}>
      <Search
        className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
        aria-hidden="true"
      />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoComplete="off"
        className="pl-10 pr-10"
      />
      {value.length > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="検索をクリア"
          onClick={() => onChange('')}
          className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 型チェック**

Run: `pnpm type-check`
Expected: エラーなし

- [ ] **Step 4: コミット**

```bash
git add src/components/ui/search-bar.tsx
git commit -m "feat: add shared SearchBar component (icon + clear button)"
```

---

## Task 3: 予約 API に `search` パラメータを追加

**Files:**
- Modify: `src/app/api/stores/[storeId]/reservations/route.ts`

- [ ] **Step 1: 該当ファイルの該当箇所を再読**

Run: `sed -n '60,130p' src/app/api/stores/[storeId]/reservations/route.ts`
Expected: 既存の `status` / `dateFrom` / `dateTo` 取得パターンを確認

- [ ] **Step 2: クエリパラメータ取得部に search を追加**

`src/app/api/stores/[storeId]/reservations/route.ts` の 60-66 行付近を以下に変更:

変更前 (62-66 行):
```ts
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const env = getAppEnvironment();
```

変更後:
```ts
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const search = searchParams.get('search')?.trim() || null;
    const env = getAppEnvironment();
```

- [ ] **Step 3: ローカル環境のフィルタに search を追加**

`reservations = reservations.filter(r => r.status === status);` のブロック (76-78 行) と `if (dateFrom)` の間に以下を挿入:

```ts
      if (search) {
        const q = search.toLowerCase();
        reservations = reservations.filter((r) =>
          r.customer_name?.toLowerCase().includes(q) ||
          r.customer_email?.toLowerCase().includes(q) ||
          r.customer_phone?.toLowerCase().includes(q)
        );
      }
```

- [ ] **Step 4: Supabase 環境のクエリに search を追加**

`if (dateTo) { query = query.lte('reservation_date', dateTo); }` の直後 (124 行直後) に以下を挿入:

```ts
    if (search) {
      // ILIKE のメタ文字 % _ \ をエスケープ
      const escaped = search.replace(/[%_\\]/g, '\\$&');
      query = query.or(
        `customer_name.ilike.%${escaped}%,customer_email.ilike.%${escaped}%,customer_phone.ilike.%${escaped}%`
      );
    }
```

- [ ] **Step 5: ヘッダーコメントを更新**

ファイル先頭近くのコメント (47-55 行) の「クエリパラメータ:」セクションに以下を追加:

変更前:
```ts
 * クエリパラメータ:
 * - status: ステータスでフィルタ
 * - date_from: 開始日（YYYY-MM-DD）
 * - date_to: 終了日（YYYY-MM-DD）
 */
```

変更後:
```ts
 * クエリパラメータ:
 * - status: ステータスでフィルタ
 * - date_from: 開始日（YYYY-MM-DD）
 * - date_to: 終了日（YYYY-MM-DD）
 * - search: 顧客名 / メール / 電話番号の部分一致検索
 */
```

- [ ] **Step 6: 型チェック**

Run: `pnpm type-check`
Expected: エラーなし

- [ ] **Step 7: ローカル動作確認**

Run: 別ターミナルで `pnpm dev` を起動済みの前提で
```bash
curl -s "http://localhost:3000/api/stores/<existing-storeId>/reservations?search=test" | head -c 200
```
Expected: `[]` または該当する予約のみが返る (検索文字列を含まないものが除外されている)

- [ ] **Step 8: コミット**

```bash
git add src/app/api/stores/[storeId]/reservations/route.ts
git commit -m "feat: add ?search= param to reservations list API"
```

---

## Task 4: アンケート回答 API に `search` パラメータを追加

**Files:**
- Modify: `src/app/api/stores/[storeId]/surveys/responses/route.ts`

- [ ] **Step 1: クエリパラメータ取得部に search を追加**

`src/app/api/stores/[storeId]/surveys/responses/route.ts` の 19-20 行を以下に変更:

変更前:
```ts
    const url = new URL(request.url);
    const surveyFormId = url.searchParams.get('survey_form_id');
```

変更後:
```ts
    const url = new URL(request.url);
    const surveyFormId = url.searchParams.get('survey_form_id');
    const search = url.searchParams.get('search')?.trim() || null;
```

- [ ] **Step 2: ローカル環境のフィルタに search を追加**

`if (surveyFormId) { responses = responses.filter(...) }` ブロックの直後 (31 行付近) と `responses.sort(...)` の間に以下を挿入:

```ts
      if (search) {
        const q = search.toLowerCase();
        responses = responses.filter((r: any) => {
          // 回答 JSONB 全体を text 化して部分一致
          const responsesText = JSON.stringify(r.responses ?? r.answers ?? {}).toLowerCase();
          return responsesText.includes(q);
        });
      }
```

- [ ] **Step 3: Supabase 環境のクエリに search を追加**

`if (surveyFormId) { query = query.eq('survey_form_id', surveyFormId); }` の直後 (73 行直後) に以下を挿入:

```ts
    if (search) {
      const escaped = search.replace(/[%_\\]/g, '\\$&');
      // responses (JSONB) を text にキャストして ILIKE
      // customers join 経由の検索も OR で並列に効かせる
      query = query.or(
        `responses::text.ilike.%${escaped}%,customers.name.ilike.%${escaped}%,customers.email.ilike.%${escaped}%,customers.phone.ilike.%${escaped}%`,
        { foreignTable: 'customers' as never }
      );
    }
```

**注意**: PostgREST で外部テーブル結合の OR は表現が複雑なため、`customers` join を含む検索が想定通り動かない場合の代替実装を Step 4 に用意。

- [ ] **Step 4: Step 3 が動かない場合の代替実装**

Step 7 の動作確認で `customers.name.ilike.*` が PostgREST エラー (PGRST100 等) になる場合、Step 3 の `if (search)` ブロックを以下に置換:

```ts
    if (search) {
      const escaped = search.replace(/[%_\\]/g, '\\$&');
      // responses JSONB の text キャストのみで検索（customer join 経由は省略）
      query = query.ilike('responses::text', `%${escaped}%`);
    }
```

`responses::text` を Supabase JS の `.ilike()` に渡せない場合は、`.or('responses::text.ilike.*' + escaped + '*')` に書き換える。最終的に動く形に確定する。

- [ ] **Step 5: select 句に customers join を追加（Step 3 採用時のみ）**

Step 3 の実装を採用する場合、57-66 行の `select` を以下に変更（既存の survey_forms join はそのまま残す）:

変更前:
```ts
    let query = (adminClient as any)
      .from('surveys')
      .select(`
        *,
        survey_forms:survey_form_id (
          id,
          name,
          config
        )
      `)
      .eq('store_id', storeId)
      .order('submitted_at', { ascending: false });
```

変更後:
```ts
    let query = (adminClient as any)
      .from('surveys')
      .select(`
        *,
        survey_forms:survey_form_id (
          id,
          name,
          config
        ),
        customers:customer_id (
          id,
          name,
          email,
          phone
        )
      `)
      .eq('store_id', storeId)
      .order('submitted_at', { ascending: false });
```

Step 4 の代替実装を採用する場合は select 句変更は不要。

- [ ] **Step 6: ヘッダーコメントに search を追加**

ファイル先頭のコメント (11 行付近) の `GET /api/stores/[storeId]/surveys/responses` 説明に「※ search クエリで responses 内のテキスト部分一致検索が可能」と 1 行追記。

- [ ] **Step 7: ローカル動作確認**

Run: `curl -s "http://localhost:3000/api/stores/<storeId>/surveys/responses?search=test" | head -c 200`
Expected: 配列レスポンス。検索ワードを含む回答だけが残ることを確認。

- [ ] **Step 8: 型チェック**

Run: `pnpm type-check`
Expected: エラーなし

- [ ] **Step 9: コミット**

```bash
git add src/app/api/stores/[storeId]/surveys/responses/route.ts
git commit -m "feat: add ?search= param to survey responses API"
```

---

## Task 5: 予約タブに SearchBar を追加 (`/[storeId]/admin`)

**Files:**
- Modify: `src/app/[storeId]/admin/page.tsx`

- [ ] **Step 1: import を追加**

`src/app/[storeId]/admin/page.tsx` の既存 import 群に以下を追加（他の `@/components/ui/...` の近く）:

```tsx
import { SearchBar } from '@/components/ui/search-bar';
import { useDebounce } from '@/hooks/use-debounce';
```

- [ ] **Step 2: 検索 state を追加**

`const [reservationFilterStatus, setReservationFilterStatus] = useState<string>('all');` (88 行付近) の直後に以下を追加:

```tsx
  const [reservationSearchQuery, setReservationSearchQuery] = useState<string>('');
  const debouncedReservationSearch = useDebounce(reservationSearchQuery, 300);
  const [surveyResponseSearchQuery, setSurveyResponseSearchQuery] = useState<string>('');
  const debouncedSurveyResponseSearch = useDebounce(surveyResponseSearchQuery, 300);
  const [dashboardReservationSearch, setDashboardReservationSearch] = useState<string>('');
  const debouncedDashboardReservationSearch = useDebounce(dashboardReservationSearch, 300);
```

- [ ] **Step 3: 既存の一括 fetch から予約 / 回答 fetch を分離**

300-331 行の `fetchData` 内にある以下の 2 つの fetch（reservations と surveys/responses）を `fetchData` から削除し、別 useEffect に切り出す。

削除する箇所 (318-322 行):
```tsx
        const reservationsResponse = await fetch(`/api/stores/${storeId}/reservations`);
        if (reservationsResponse.ok) {
          const reservationsData = await reservationsResponse.json();
          setReservations(reservationsData);
        }
```

削除する箇所 (325-331 行):
```tsx
        // アンケート回答を取得
        const surveyResponsesResponse = await fetch(`/api/stores/${storeId}/surveys/responses`, {
          credentials: 'include',
        });
        if (surveyResponsesResponse.ok) {
          const surveyResponsesData = await surveyResponsesResponse.json();
          setSurveyResponses(surveyResponsesData);
        }
```

そして `fetchData` の useEffect の閉じタグ (344 行) の直後に以下の 2 つの useEffect を追加:

```tsx
  // 予約一覧 fetch（検索クエリ変化時に再フェッチ）
  // ダッシュボードと予約タブで共有。検索文字列があれば limit を拡張。
  useEffect(() => {
    if (!storeId || !user) return;
    const activeSearch = activeTab === 'dashboard'
      ? debouncedDashboardReservationSearch
      : debouncedReservationSearch;
    const params = new URLSearchParams();
    if (activeSearch) params.append('search', activeSearch);
    fetch(`/api/stores/${storeId}/reservations?${params.toString()}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setReservations(data))
      .catch((err) => console.error('Reservations fetch error:', err));
  }, [storeId, user, activeTab, debouncedReservationSearch, debouncedDashboardReservationSearch]);

  // アンケート回答 fetch（検索クエリ変化時に再フェッチ）
  useEffect(() => {
    if (!storeId || !user) return;
    const params = new URLSearchParams();
    if (debouncedSurveyResponseSearch) params.append('search', debouncedSurveyResponseSearch);
    fetch(`/api/stores/${storeId}/surveys/responses?${params.toString()}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setSurveyResponses(data))
      .catch((err) => console.error('Survey responses fetch error:', err));
  }, [storeId, user, debouncedSurveyResponseSearch]);
```

注: `activeTab` は既存 state。既存変数名で参照できることを確認すること。もし違う名前 (`tab` 等) で扱われていれば該当変数名に置換。

- [ ] **Step 4: 予約タブに SearchBar を配置**

`<TabsContent value="list" className="space-y-6">` (781 行) の直後、`{filteredReservations.length === 0 ? (` の直前に以下を挿入:

```tsx
                      <div className="mb-2">
                        <SearchBar
                          value={reservationSearchQuery}
                          onChange={setReservationSearchQuery}
                          placeholder="顧客名 / メール / 電話番号で検索…"
                          ariaLabel="予約を検索"
                        />
                      </div>
```

- [ ] **Step 5: 0 件時の空状態メッセージを検索状況に応じて変更**

`{filteredReservations.length === 0 ? (` の `<div className="text-center text-muted-foreground py-8">予約がありません</div>` を以下に置換:

```tsx
                        <div className="text-center text-muted-foreground py-8">
                          {debouncedReservationSearch
                            ? `「${debouncedReservationSearch}」に一致する予約が見つかりませんでした`
                            : '予約がありません'}
                        </div>
```

- [ ] **Step 6: 型チェック**

Run: `pnpm type-check`
Expected: エラーなし

- [ ] **Step 7: dev 起動して目視確認**

Run: 別ターミナルで `pnpm dev`、ブラウザで `http://localhost:3000/<storeId>/admin?tab=reservations` を開く。

検証:
- 検索ボックス表示
- 文字入力後 300ms ほどで結果が絞り込まれる
- × ボタンで全件に戻る

- [ ] **Step 8: コミット**

```bash
git add src/app/[storeId]/admin/page.tsx
git commit -m "feat: add SearchBar to store admin reservations tab"
```

---

## Task 6: アンケート回答タブに SearchBar を追加 (`/[storeId]/admin`)

**Files:**
- Modify: `src/app/[storeId]/admin/page.tsx`

- [ ] **Step 1: アンケート回答カードのヘッダーに SearchBar を配置**

`<CardContent>` の中で `{(() => { const filteredResponses = ...` を始めるブロック (1053 行) の直前、`</CardHeader>` (1052 行) の直後に挿入する形で `<CardContent>` 内の最上段に SearchBar を配置:

`<CardContent>` 直下 (1053 行付近) の最初の行に以下を追加:

```tsx
                    <CardContent>
                      <div className="mb-4">
                        <SearchBar
                          value={surveyResponseSearchQuery}
                          onChange={setSurveyResponseSearchQuery}
                          placeholder="回答内容 / 回答者で検索…"
                          ariaLabel="アンケート回答を検索"
                        />
                      </div>
                      {(() => {
                        const filteredResponses = selectedSurveyFormId
                          ? surveyResponses.filter((r: any) => r.survey_form_id === selectedSurveyFormId)
                          : surveyResponses;
```

(既存のコードはそのまま残し、SearchBar の `<div>` だけを `(() =>` の前に挿入する)

- [ ] **Step 2: 0 件時の空状態メッセージを検索状況に応じて変更**

`<p className="text-lg font-medium mb-2">まだ回答がありません</p>` (1063 行付近) を含むブロックを以下に置換:

```tsx
                      <div className="text-center py-12 text-muted-foreground">
                        <ClipboardList className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p className="text-lg font-medium mb-2">
                          {debouncedSurveyResponseSearch
                            ? `「${debouncedSurveyResponseSearch}」に一致する回答が見つかりませんでした`
                            : 'まだ回答がありません'}
                        </p>
                        <p className="text-sm">
                          {debouncedSurveyResponseSearch
                            ? '別のキーワードでお試しください'
                            : 'アンケートフォームを公開すると、回答がここに表示されます'}
                        </p>
                            </div>
```

- [ ] **Step 3: 型チェック**

Run: `pnpm type-check`
Expected: エラーなし

- [ ] **Step 4: dev で目視確認**

ブラウザで `http://localhost:3000/<storeId>/admin?tab=surveys` を開いて回答一覧セクションの検索動作を確認。

- [ ] **Step 5: コミット**

```bash
git add src/app/[storeId]/admin/page.tsx
git commit -m "feat: add SearchBar to store admin survey responses tab"
```

---

## Task 7: ダッシュボード「最近の予約」に SearchBar を追加

**Files:**
- Modify: `src/app/[storeId]/admin/page.tsx`

- [ ] **Step 1: 「最近の予約」表示件数ロジックを stats から切り離し**

ダッシュボード case の `<CardContent>` 内 (450-487 行) は現在 `stats.recentReservations` を直接使っているが、検索時のみ件数を拡張する必要がある。

`stats` の定義 (395 行付近) を確認し、`recentReservations` がどう作られているか把握:

Run: `grep -n "recentReservations" src/app/[storeId]/admin/page.tsx`

通常は `reservations.slice(0, 5)` のような形のはず。

- [ ] **Step 2: ダッシュボード表示用配列を再計算**

ダッシュボード case の return 句の直前 (440 行付近、`<CardHeader>` の前) に、その case 内のローカル変数を導入する。

実装は `case 'dashboard':` ブロックの上部 (return 直前) に以下を挿入:

```tsx
        const dashboardReservations = (() => {
          if (debouncedDashboardReservationSearch) {
            // 検索中: 直前の API レスポンス (search 適用済み) から最大 50 件
            return reservations.slice(0, 50);
          }
          return stats.recentReservations;
        })();
```

そして `stats.recentReservations.length === 0` (451 行) と `stats.recentReservations.map(...)` (457 行) を `dashboardReservations.length === 0` / `dashboardReservations.map(...)` に置換。

- [ ] **Step 3: 「最近の予約」カードヘッダーに SearchBar を追加**

`<CardHeader>` (440 行) と `<CardContent>` (450 行) の間、または `<CardContent>` の直下に配置。最も自然なのは `<CardContent>` の直下:

`<CardContent>` (450 行) の直後、`{stats.recentReservations.length === 0 ? (` の直前に以下を挿入:

```tsx
              <CardContent>
                <div className="mb-3">
                  <SearchBar
                    value={dashboardReservationSearch}
                    onChange={setDashboardReservationSearch}
                    placeholder="顧客名 / メール / 電話番号で検索…"
                    ariaLabel="ダッシュボードから予約を検索"
                  />
                </div>
                {dashboardReservations.length === 0 ? (
```

- [ ] **Step 4: 0 件時メッセージを検索状況に応じて変更**

`<p className="text-sm text-muted-foreground text-center py-4">まだ予約がありません</p>` (452-454 行) を以下に置換:

```tsx
                  <p className="text-sm text-muted-foreground text-center py-4">
                    {debouncedDashboardReservationSearch
                      ? `「${debouncedDashboardReservationSearch}」に一致する予約が見つかりませんでした`
                      : 'まだ予約がありません'}
                  </p>
```

- [ ] **Step 5: 型チェック**

Run: `pnpm type-check`
Expected: エラーなし

- [ ] **Step 6: dev で目視確認**

ブラウザで `http://localhost:3000/<storeId>/admin?tab=dashboard` を開く。

検証:
- 検索文字列空: 直近 5 件表示
- 検索文字列入力: マッチした予約のみ最大 50 件表示
- × クリアで戻る

- [ ] **Step 7: コミット**

```bash
git add src/app/[storeId]/admin/page.tsx
git commit -m "feat: add SearchBar to dashboard recent reservations card"
```

---

## Task 8: テナントルートの予約一覧に SearchBar を追加

**Files:**
- Modify: `src/app/tenant/[tenantSlug]/admin/[storeId]/reservations/page.tsx`

- [ ] **Step 1: import 追加**

ファイル先頭の import 群 (1-13 行) に以下を追加:

```tsx
import { SearchBar } from '@/components/ui/search-bar';
import { useDebounce } from '@/hooks/use-debounce';
```

- [ ] **Step 2: search state を追加**

49 行 `const [activeTab, setActiveTab] = useState<'list' | 'analytics'>('list');` の直後に追加:

```tsx
  const [searchQuery, setSearchQuery] = useState<string>('');
  const debouncedSearch = useDebounce(searchQuery, 300);
```

- [ ] **Step 3: useEffect の依存配列に debouncedSearch を追加**

52-56 行の `useEffect` の依存配列を変更:

変更前:
```tsx
  useEffect(() => {
    fetchStore();
    fetchReservations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus, storeId]);
```

変更後:
```tsx
  useEffect(() => {
    fetchStore();
    fetchReservations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus, storeId, debouncedSearch]);
```

- [ ] **Step 4: fetchReservations に search パラメータを追加**

70-89 行の `fetchReservations` を変更:

変更前:
```tsx
  const fetchReservations = async () => {
    try {
      setLoading(true);
      
      const params = new URLSearchParams();
      if (filterStatus !== 'all') {
        params.append('status', filterStatus);
      }

      const response = await fetch(`/api/stores/${storeId}/reservations?${params.toString()}`);
```

変更後:
```tsx
  const fetchReservations = async () => {
    try {
      setLoading(true);
      
      const params = new URLSearchParams();
      if (filterStatus !== 'all') {
        params.append('status', filterStatus);
      }
      if (debouncedSearch) {
        params.append('search', debouncedSearch);
      }

      const response = await fetch(`/api/stores/${storeId}/reservations?${params.toString()}`);
```

- [ ] **Step 5: フィルター Card 内に SearchBar を追加**

164-187 行の `<Card>` 内のフィルター UI に SearchBar を追加。

`<div className="flex flex-col sm:flex-row gap-4">` (169 行) の中、ステータスフィルタの `<div className="space-y-2 flex-1">` の隣に検索欄を追加:

変更前:
```tsx
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="space-y-2 flex-1">
                    <Label htmlFor="status-filter">ステータス</Label>
                    <Select value={filterStatus} onValueChange={setFilterStatus}>
                      <SelectTrigger id="status-filter" className="w-full sm:w-[200px]">
                        <SelectValue placeholder="ステータスでフィルター" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">全て</SelectItem>
                        <SelectItem value="pending">保留中</SelectItem>
                        <SelectItem value="confirmed">確認済み</SelectItem>
                        <SelectItem value="cancelled">キャンセル</SelectItem>
                        <SelectItem value="completed">完了</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
```

変更後:
```tsx
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="space-y-2 flex-1">
                    <Label htmlFor="reservation-search">検索</Label>
                    <SearchBar
                      value={searchQuery}
                      onChange={setSearchQuery}
                      placeholder="顧客名 / メール / 電話番号で検索…"
                      ariaLabel="予約を検索"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="status-filter">ステータス</Label>
                    <Select value={filterStatus} onValueChange={setFilterStatus}>
                      <SelectTrigger id="status-filter" className="w-full sm:w-[200px]">
                        <SelectValue placeholder="ステータスでフィルター" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">全て</SelectItem>
                        <SelectItem value="pending">保留中</SelectItem>
                        <SelectItem value="confirmed">確認済み</SelectItem>
                        <SelectItem value="cancelled">キャンセル</SelectItem>
                        <SelectItem value="completed">完了</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
```

- [ ] **Step 6: 0 件時メッセージを検索状況対応に**

207-209 行の空状態を以下に置換:

変更前:
```tsx
                ) : filteredReservations.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    予約データがありません
                  </div>
```

変更後:
```tsx
                ) : filteredReservations.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    {debouncedSearch
                      ? `「${debouncedSearch}」に一致する予約が見つかりませんでした`
                      : '予約データがありません'}
                  </div>
```

- [ ] **Step 7: 型チェック**

Run: `pnpm type-check`
Expected: エラーなし

- [ ] **Step 8: dev で目視確認**

ブラウザで `http://localhost:3000/tenant/<slug>/admin/<storeId>/reservations` を開いて検索動作を確認。

- [ ] **Step 9: コミット**

```bash
git add src/app/tenant/[tenantSlug]/admin/[storeId]/reservations/page.tsx
git commit -m "feat: add SearchBar to tenant store reservations page"
```

---

## Task 9: 最終検証

**Files:** （なし、検証のみ）

- [ ] **Step 1: 型チェック**

Run: `pnpm type-check`
Expected: エラーゼロ

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: エラーゼロ（既存の warning は許容）

- [ ] **Step 3: ビルド**

Run: `pnpm build`
Expected: 成功

- [ ] **Step 4: 手動シナリオテスト（local mode）**

`pnpm seed:local` で seed 投入後、`pnpm dev` で起動して以下を確認:

1. `/<storeId>/admin?tab=dashboard` → 検索ボックスで顧客名を絞り込み 50 件まで拡張
2. `/<storeId>/admin?tab=reservations` → 検索 + ステータスフィルタの併用が動く
3. `/<storeId>/admin?tab=surveys` → 回答タブの検索が動く（回答内容も含めてヒット）
4. `/tenant/<slug>/admin/<storeId>/reservations` → 検索 + ステータスフィルタの併用が動く
5. ヒット 0 件時のメッセージが「『xxx』に一致する〜」になる
6. × ボタンで検索クリア → 全件に戻る
7. 入力中 300ms 後にフェッチが走る（連続入力で API 連打されない）

DevTools Network タブで `?search=xxx` が API に渡っていることを目視確認。

- [ ] **Step 5: staging Supabase での検証（任意・PR レビュー時）**

`feature/admin-search` ブランチで PR を立て staging に merge 後、staging URL で同シナリオを確認。日本語の ILIKE が想定通り動くこと。

- [ ] **Step 6: 最終コミット（必要なら）**

検証で見つかった軽微な修正があれば fix コミット。問題なければスキップ。

---

## Self-Review

### Spec coverage
- ✅ §3.1 useDebounce → Task 1
- ✅ §3.2 SearchBar → Task 2
- ✅ §4.1 予約 API search 対応 → Task 3
- ✅ §4.2 アンケート回答 API search 対応 → Task 4（フォールバック付き）
- ✅ §4.3 ダッシュボード limit 拡張 → Task 7 Step 2
- ✅ §5.1 3 タブへの SearchBar → Task 5/6/7
- ✅ §5.2 テナントルート予約一覧 → Task 8
- ✅ §7 空状態メッセージ → Task 5/6/7/8 各 Step
- ⚠️ §6 URL クエリ ?search= 永続化 → 本計画では state のみ。URL 永続化は将来追加でも良い軽微項目。実装側 (Task 5 Step 2) で `setReservationSearchQuery` を URL 同期に拡張するのは別タスク扱い。
- ⚠️ §8.1 単体テスト → test infra 未導入のため本 PR では実施せず、計画書冒頭で明記済み。

### Placeholder scan
- すべての Step に具体コードまたは具体コマンドあり。「TBD」「適切なエラー処理」等は無し。

### Type consistency
- `SearchBar` の prop 名 (`value` / `onChange` / `placeholder` / `ariaLabel` / `className`) は Task 2 で定義し、Task 5/6/7/8 で同名を使用。
- `useDebounce(value, delayMs)` シグネチャは Task 1 で定義し、Task 5/8 で `(query, 300)` の形で使用。
- API クエリパラメータ名 `search` は Task 3/4 と Task 5/8 のフェッチで一致。

### 残課題（PR 説明に記載）
- URL クエリ `?search=` への永続化（必要になったら別 PR）
- アンケート responses JSONB の text キャスト ILIKE が PostgREST で動かなかった場合のフォールバック適用（Task 4 Step 4）
- Vitest + RTL 導入とユニットテスト追加（test infra 整備の別 PR）
- 電話番号正規化（ハイフン揺れ吸収）— 既存の顧客検索でも未対応のため本 PR スコープ外
