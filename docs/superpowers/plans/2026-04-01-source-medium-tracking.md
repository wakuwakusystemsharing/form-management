# Web予約フォーム流入経路追跡 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web予約フォームからの予約に流入経路（Google検索、Instagram等）を自動推定・保存し、管理画面にテキスト表示する

**Architecture:** 静的HTMLフォームのJSで `document.referrer` / `navigator.userAgent` から流入元を推定し、予約POSTデータに `source_medium` を含める。API側でそのまま保存し、管理画面の予約一覧テーブルに「経路」カラムとしてテキスト表示する。

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase PostgreSQL, vanilla JS (静的HTML内)

---

## ファイル構成

| ファイル | 変更種別 | 役割 |
|---|---|---|
| `supabase/migrations/20250103000000_add_source_medium.sql` | 新規作成 | DBマイグレーション |
| `src/types/form.ts` | 修正 | Reservation型に `source_medium` 追加 |
| `src/app/api/reservations/route.ts` | 修正 | `source_medium` の受け取り・保存（local/Supabase両方） |
| `src/lib/static-generator-reservation.ts` | 修正 | `detectSourceMedium()` 埋め込み + POSTデータに追加 |
| `src/app/admin/reservations/page.tsx` | 修正 | 「経路」カラム追加（サービス管理者用） |
| `src/app/admin/[storeId]/reservations/page.tsx` | 修正 | 「経路」カラム追加（店舗管理者用） |

---

### Task 1: DBマイグレーション + 型定義

**Files:**
- Create: `supabase/migrations/20250103000000_add_source_medium.sql`
- Modify: `src/types/form.ts:346-401`
- Modify: `src/app/api/reservations/route.ts:29-45`

- [ ] **Step 1: マイグレーションファイル作成**

`supabase/migrations/20250103000000_add_source_medium.sql`:
```sql
-- Web予約フォームの流入経路を記録するカラムを追加
ALTER TABLE reservations ADD COLUMN source_medium TEXT;

-- インデックス（流入経路別の集計用）
CREATE INDEX idx_reservations_source_medium ON reservations (source_medium);
```

- [ ] **Step 2: Database型にsource_medium追加**

`src/types/form.ts` の `reservations` テーブル定義（Row/Insert/Update 全て）に追加:

Row (line 359の後に追加):
```typescript
source_medium: string | null; // 流入経路（web予約のみ）
```

Insert (line 377の後に追加):
```typescript
source_medium?: string | null; // 流入経路（web予約のみ）
```

Update (line 395の後に追加):
```typescript
source_medium?: string | null; // 流入経路（web予約のみ）
```

- [ ] **Step 3: ローカルReservation interfaceにsource_medium追加**

`src/app/api/reservations/route.ts` の `Reservation` interface (line 41の後に追加):
```typescript
source_medium?: string | null; // 流入経路（web予約のみ）
```

- [ ] **Step 4: 型チェック実行**

Run: `pnpm type-check`
Expected: PASS（既存コードに影響なし、新フィールドはoptional）

- [ ] **Step 5: コミット**

```bash
git add supabase/migrations/20250103000000_add_source_medium.sql src/types/form.ts src/app/api/reservations/route.ts
git commit -m "feat: reservationsテーブルにsource_mediumカラムを追加"
```

---

### Task 2: API — source_mediumの受け取り・保存

**Files:**
- Modify: `src/app/api/reservations/route.ts:270-286` (local JSON path)
- Modify: `src/app/api/reservations/route.ts:394-416` (Supabase path)

- [ ] **Step 1: バリデーション用の定数を追加**

`src/app/api/reservations/route.ts` のファイル先頭付近（interface定義の後、line 46あたり）に追加:
```typescript
const VALID_SOURCE_MEDIUMS = ['line', 'instagram', 'facebook', 'x_twitter', 'google_maps', 'google_search', 'yahoo_search', 'direct'] as const;
```

- [ ] **Step 2: ローカルJSON保存パスにsource_medium追加**

`src/app/api/reservations/route.ts` line 282（`line_user_id` の行）の後に追加:
```typescript
source_medium: VALID_SOURCE_MEDIUMS.includes(body.source_medium) ? body.source_medium : null,
```

- [ ] **Step 3: Supabase保存パスにsource_medium追加**

`src/app/api/reservations/route.ts` line 414（`customer_id` の行）の後に追加:
```typescript
source_medium: VALID_SOURCE_MEDIUMS.includes(body.source_medium) ? body.source_medium : null,
```

- [ ] **Step 4: 型チェック実行**

Run: `pnpm type-check`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/app/api/reservations/route.ts
git commit -m "feat: 予約APIでsource_mediumを受け取り・保存"
```

---

### Task 3: 静的HTMLジェネレータ — detectSourceMedium()埋め込み

**Files:**
- Modify: `src/lib/static-generator-reservation.ts:1443-1467` (reservationData構築部分)

- [ ] **Step 1: detectSourceMedium関数をBookingFormクラス内に追加**

`src/lib/static-generator-reservation.ts` の `reservationData` 構築の直前（line 1442 `// APIに送信するデータを構築` の前）に追加:

```javascript
            // 流入経路を推定（Web予約フォームのみ）
            const sourceMedium = (function() {
              try {
                const ref = (document.referrer || '').toLowerCase();
                const ua = (navigator.userAgent || '').toLowerCase();
                if (ua.includes('line/') || ref.includes('liff.line.me')) return 'line';
                if (ua.includes('instagram') || ref.includes('instagram.com')) return 'instagram';
                if (ua.includes('fbav') || ua.includes('fban') || ref.includes('facebook.com') || ref.includes('l.facebook.com')) return 'facebook';
                if (ua.includes('twitter') || ref.includes('t.co') || ref.includes('x.com')) return 'x_twitter';
                if (ref.includes('google.') && ref.includes('/maps')) return 'google_maps';
                if (ref.includes('google.')) return 'google_search';
                if (ref.includes('yahoo.')) return 'yahoo_search';
                return 'direct';
              } catch(e) { return 'direct'; }
            })();
```

- [ ] **Step 2: reservationDataにsource_mediumを追加**

`src/lib/static-generator-reservation.ts` line 1466（`line_friend_flag` の行）の後に追加:

```javascript
                source_medium: sourceMedium
```

（前の行 `line_friend_flag: this.state.lineFriendFlag || false` の末尾にカンマを追加すること）

- [ ] **Step 3: 型チェック実行**

Run: `pnpm type-check`
Expected: PASS

- [ ] **Step 4: ローカルテスト（手動確認）**

1. `pnpm dev` で開発サーバー起動
2. Web予約フォームを開き、DevToolsのNetworkタブで予約送信時のPOSTボディに `source_medium: "direct"` が含まれることを確認

- [ ] **Step 5: コミット**

```bash
git add src/lib/static-generator-reservation.ts
git commit -m "feat: 静的HTMLフォームに流入経路推定ロジックを埋め込み"
```

---

### Task 4: 管理画面 — 「経路」カラム追加

**Files:**
- Modify: `src/app/admin/reservations/page.tsx:238-271`
- Modify: `src/app/admin/[storeId]/reservations/page.tsx:200-229`

- [ ] **Step 1: source_mediumの表示テキストマッピング定数を作成**

両ファイルで使えるように、各ファイルのインポート文の後（コンポーネント関数の前）に以下を追加:

```typescript
const SOURCE_MEDIUM_LABELS: Record<string, string> = {
  line: 'LINE',
  instagram: 'Instagram',
  facebook: 'Facebook',
  x_twitter: 'X（旧Twitter）',
  google_maps: 'Googleマップ',
  google_search: 'Google検索',
  yahoo_search: 'Yahoo!検索',
  direct: '直接アクセス',
};
```

- [ ] **Step 2: サービス管理者用予約一覧にカラム追加**

`src/app/admin/reservations/page.tsx`:

テーブルヘッダー（line 245 `<TableHead>ステータス</TableHead>` の前）に追加:
```tsx
<TableHead>経路</TableHead>
```

テーブルボディ（line 262 `<TableCell>` ステータスセルの前）に追加:
```tsx
<TableCell className="text-muted-foreground">
  {reservation.source_medium ? (SOURCE_MEDIUM_LABELS[reservation.source_medium] || reservation.source_medium) : '-'}
</TableCell>
```

- [ ] **Step 3: 店舗管理者用予約一覧にカラム追加**

`src/app/admin/[storeId]/reservations/page.tsx`:

テーブルヘッダー（line 207 `<TableHead>ステータス</TableHead>` の前）に追加:
```tsx
<TableHead>経路</TableHead>
```

テーブルボディ（line 220 `<TableCell>` ステータスセルの前）に追加:
```tsx
<TableCell className="text-muted-foreground">
  {reservation.source_medium ? (SOURCE_MEDIUM_LABELS[reservation.source_medium] || reservation.source_medium) : '-'}
</TableCell>
```

- [ ] **Step 4: 型チェック + ビルド確認**

Run: `pnpm type-check && pnpm build`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/app/admin/reservations/page.tsx src/app/admin/\[storeId\]/reservations/page.tsx
git commit -m "feat: 管理画面の予約一覧に流入経路カラムを追加"
```

---

### Task 5: 最終検証

- [ ] **Step 1: フルビルド確認**

Run: `pnpm type-check && pnpm build`
Expected: PASS

- [ ] **Step 2: ローカル動作確認チェックリスト**

1. `pnpm dev` でサーバー起動
2. Web予約フォームを作成・デプロイ
3. フォームから予約を送信
4. 管理画面の予約一覧で「経路」カラムに「直接アクセス」と表示されることを確認
5. 既存の予約データでは「-」と表示されることを確認（後方互換性）
