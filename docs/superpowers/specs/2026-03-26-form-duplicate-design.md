# フォーム複製機能 設計書

## 概要

サービス管理者が予約フォーム・アンケートフォームを同じ店舗内で複製できる機能。複製後は即座に編集モーダルが開く。

## 要件

- 対象: 予約フォーム（`Form`）とアンケートフォーム（`SurveyForm`）
- スコープ: 同じ店舗内のみ
- 複製対象: フォーム設定（config）のみ
- 複製後: 即座に編集モーダルを開く

## API設計

### 予約フォーム複製

```
POST /api/forms/{formId}/duplicate
```

**リクエスト**: ボディ不要

**レスポンス**: 201 Created — 新しいフォームオブジェクト（`Form`型）

### アンケートフォーム複製

```
POST /api/surveys/{id}/duplicate
```

**リクエスト**: ボディ不要

**レスポンス**: 201 Created — 新しいアンケートフォームオブジェクト（`SurveyForm`型）

### エラーレスポンス

| ステータス | 条件 | メッセージ |
|-----------|------|-----------|
| 404 | 元フォームが見つからない | `フォームが見つかりません` |
| 500 | 保存失敗 | `フォームの複製に失敗しました` |

## 複製ロジック

1. 元フォームをIDで取得
2. 新しい12文字ランダムIDを生成（既存IDとの重複チェック付き）
3. configをディープコピー
4. `config.basic_info.form_name` に「（コピー）」を付与
5. 以下のフィールドをリセット:
   - `id` → 新規生成
   - `status` → `'inactive'`
   - `draft_status` → `'none'`
   - `static_deploy` → `null`
   - `liff_id` → `''`（空文字）
   - `created_at` / `updated_at` → 現在時刻
6. `store_id` は元フォームと同じ
7. DBまたはJSONに保存（環境に応じて分岐）
8. 自動デプロイは行わない

## UI変更

### フォーム一覧カード

- 既存の「編集」「削除」ボタンの横に「複製」ボタンを追加
- アイコン: `Copy`（lucide-react）
- 予約フォーム・アンケートフォーム両方のカードに配置

### インタラクション

1. 「複製」ボタンをクリック
2. API呼び出し（ローディング表示）
3. 成功 → フォーム一覧を再取得
4. 新しいフォームの編集モーダルを自動で開く
5. トースト通知:「フォームを複製しました」

### データフロー

```
複製ボタン押下
  → POST /api/forms/{formId}/duplicate
  → 元フォーム取得 → configコピー → 新ID生成 → 保存
  → 新フォームオブジェクトをレスポンス
  → フロント: 一覧再取得 + 新フォームの編集モーダルを開く
```

## 環境分岐

- **Local**: `data/forms_{storeId}.json` から読み取り・書き込み
- **Staging/Production**: Supabase `reservation_forms` / `survey_forms` テーブルへINSERT

## 対象ファイル

- `src/app/api/forms/[formId]/duplicate/route.ts` — 新規: 予約フォーム複製API
- `src/app/api/surveys/[id]/duplicate/route.ts` — 新規: アンケート複製API
- `src/app/admin/[storeId]/page.tsx` — 変更: フォームカードに複製ボタン追加、複製後の編集モーダル自動オープン
