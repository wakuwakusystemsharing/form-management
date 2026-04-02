# Web予約フォーム流入経路追跡 設計仕様書

## 概要

Web予約フォームからの予約に対して、流入経路（Google検索、Instagram、直接アクセスなど）を自動推定・保存し、管理画面の予約一覧にテキスト表示する機能。

LINE予約フォームは対象外。

## 背景

参考実装（`original/ref.gs` の `detectSourceMedium()`）では、`document.referrer` と `navigator.userAgent` から流入元を推定し、管理者通知メールに含めていた。現システムではこの情報が一切記録されておらず、どの経路から予約が入ったか判別できない。

## スコープ

**対象：**
- Web予約フォーム（`form_type === 'web'`）のみ
- 管理画面の予約一覧テーブルにテキスト表示

**対象外：**
- LINE予約フォーム
- Google Calendar イベントへの記載
- LINE通知メッセージへの記載
- UTMパラメータ対応

## データモデル

### reservations テーブル

```sql
ALTER TABLE reservations ADD COLUMN source_medium TEXT;
```

### source_medium の値一覧

| 値 | 表示テキスト | 判定条件 |
|---|---|---|
| `line` | LINE | UA に `Line/` または referrer に `liff.line.me` |
| `instagram` | Instagram | UA に `instagram` または referrer に `instagram.com` |
| `facebook` | Facebook | UA に `fbav`/`fban` または referrer に `facebook.com`/`l.facebook.com` |
| `x_twitter` | X（旧Twitter） | UA に `twitter` または referrer に `t.co`/`x.com` |
| `google_maps` | Googleマップ | referrer に `google` + `/maps` |
| `google_search` | Google検索 | referrer に `google.`（maps以外） |
| `yahoo_search` | Yahoo!検索 | referrer に `yahoo.` |
| `direct` | 直接アクセス | 上記いずれにも該当しない |

- LINE予約の場合：`NULL`（フィールド未送信）
- ローカルJSON モードでも同フィールドを保存

## フロントエンド（静的HTMLジェネレータ）

### 対象ファイル
- `src/lib/static-generator-reservation.ts`

### 実装方針
- Web予約フォーム生成時のみ、`detectSourceMedium()` 関数をインラインJSとして埋め込む
- ページロード時に `document.referrer` と `navigator.userAgent` を取得し、流入元を推定
- フォーム送信時に `source_medium` を POST ボディに含める

### 推定ロジック（ref.gs ベース）

```javascript
function detectSourceMedium() {
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
}
```

## API

### POST /api/reservations

リクエストボディに `source_medium` フィールドを追加で受け取り：
- 値があればそのまま `reservations` テーブルに保存
- 値がなければ `NULL`（LINE予約など既存動作に影響なし）

バリデーション：許可値リスト（`line`, `instagram`, `facebook`, `x_twitter`, `google_maps`, `google_search`, `yahoo_search`, `direct`）以外は `NULL` として扱う。

## 管理画面

### 対象ファイル
- `src/app/admin/reservations/page.tsx`（サービス管理者用）
- `src/app/admin/[storeId]/reservations/page.tsx`（店舗管理者用）

### 表示仕様
- 予約一覧テーブルに「経路」カラムを追加
- `source_medium` の値を日本語テキストで表示
- `NULL` の場合は「-」を表示

### source_medium → 表示テキストのマッピング

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

## ローカルJSON モード

- `data/reservations.json` に `source_medium` フィールドを追加で保存
- 既存データは `source_medium` が未定義 → 「-」表示（後方互換）

## 影響範囲

| ファイル | 変更内容 |
|---|---|
| `supabase/migrations/` | 新規マイグレーション追加 |
| `src/types/form.ts` | Reservation 型に `source_medium` 追加 |
| `src/lib/static-generator-reservation.ts` | detectSourceMedium() 埋め込み + POST データに追加 |
| `src/app/api/reservations/route.ts` | `source_medium` の受け取り・保存 |
| `src/app/admin/reservations/page.tsx` | 「経路」カラム追加 |
| `src/app/admin/[storeId]/reservations/page.tsx` | 「経路」カラム追加 |
