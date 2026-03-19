# プレビュー不整合修正 — 設計ドキュメント

**日付**: 2026-03-18
**ステータス**: Draft

## 問題

FormEditModal のプレビューボタンは `/preview/{storeId}/forms/{formId}` を新しいウィンドウで開く。このルートは DB/JSON から**保存済みのデータ**を取得して HTML を生成するため、エディタ内の未保存の変更（注意書きの追加など）がプレビューに反映されない。

### 再現手順

1. フォームエディタで注意書き（`config.basic_info.notice`）を追加
2. 「プレビュー」ボタンをクリック
3. 新しいウィンドウが開くが、注意書きが表示されない
4. 「更新」ボタンを押してからプレビューすると表示される

### 根本原因

`handlePreview()` が `/preview/...` URL を `window.open()` で開く → プレビュールートが DB から保存済みデータを取得 → エディタの `editingForm` ステート（メモリ内）の変更は反映されない。

## 採用アプローチ: POST でエディタ状態を送信し、サーバーサイドで HTML 生成

### 選定理由

- **アプローチ A（自動保存→プレビュー）**: 保存が強制され「プレビューで確認してから保存」ができない
- **アプローチ B（POST 送信）**: 保存不要で最新状態をプレビュー可能、DB 書き込みなし ← **採用**
- **アプローチ C（クライアントサイド生成）**: 静的ジェネレータ（2000 行超）のクライアント移植は工数大、二重メンテナンス問題

## 設計

### 1. 新規 API エンドポイント

**`POST /api/preview/generate`**

エディタの現在のフォーム状態を受け取り、静的 HTML を生成して返す。

```typescript
// Request Body
{
  form: Form | SurveyForm,  // エディタの現在の状態
  storeId: string,
  formType: "reservation" | "survey"
}

// Response
// Content-Type: text/html; charset=utf-8
// Body: 生成された HTML 文字列
```

**処理フロー:**

1. リクエストボディから `form`、`storeId`、`formType` を取得
2. 入力バリデーション: `form`、`storeId`、`formType` の存在チェック。ボディサイズは 1MB 以下を想定
3. `formType` に応じて:
   - `"reservation"`: `normalizeForm(form)` で正規化 → `new StaticReservationGenerator().generateHTML(normalizedForm.config, form.id, storeId)`
   - `"survey"`: `form.config` をそのまま使用（`normalizeSurveyForm` は存在しないため） → `new StaticSurveyGenerator().generateHTML(form.config, form.id, storeId)`
4. 生成された HTML をレスポンスとして返却

**注意**: レスポンスが `text/html` であることは、JSON を返す他の POST エンドポイントとは異なるが、プレビュー HTML の直接返却という目的上、意図的な設計。

**エラーレスポンス（JSON）:**
```json
{ "error": "日本語のエラーメッセージ" }
```

**セキュリティ考慮:**

- 認証チェック: `getCurrentUser(request)` from `@/lib/auth-helper` を使用。null の場合は 401 を返す（`shouldSkipAuth()` が true の場合はスキップ）
- 入力バリデーション: `form`、`storeId`、`formType` の必須チェック。`formType` は `"reservation"` | `"survey"` のみ許可
- DB 書き込みなし（副作用なし）

### 2. FormEditModal の変更

**ファイル**: `src/components/FormEditor/FormEditModal.tsx`

`handlePreview()` を以下に変更:

```typescript
const [isPreviewing, setIsPreviewing] = useState(false);
const previewUrlRef = useRef<string | null>(null);

const handlePreview = async () => {
  try {
    setIsPreviewing(true);
    const formType = isSurvey(editingForm) ? 'survey' : 'reservation';

    const response = await fetch('/api/preview/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        form: editingForm,
        storeId,
        formType,
      }),
    });

    if (!response.ok) {
      toast({ title: 'プレビューの生成に失敗しました', variant: 'destructive' });
      return;
    }

    // 前回の Blob URL を解放
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
    }

    const html = await response.text();
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    previewUrlRef.current = url;
    window.open(url, '_blank');
    // メモリリーク防止: 少し待ってから URL を解放
    setTimeout(() => {
      URL.revokeObjectURL(url);
      if (previewUrlRef.current === url) previewUrlRef.current = null;
    }, 60000);
  } finally {
    setIsPreviewing(false);
  }
};
```

**変更点:**
- 同期関数 → `async` 関数に変更
- `isPreviewing` state でローディング状態を管理。プレビューボタンは `disabled={isSaving || isPreviewing}` に変更
- `previewUrlRef` で前回の Blob URL を追跡し、連続クリック時のメモリリークを防止
- エラー時はトースト通知

### 3. 設計上の注意

- API はクライアントから渡された `formType` フィールドでジェネレータを決定する（フォームオブジェクトの introspection ではない）
- 既存の `handleSaveAndDeploy` の fetch にも `credentials: 'include'` を追加する（既存の欠落を修正）

### 4. 既存プレビュールートの維持

`/preview/[storeId]/forms/[formId]/route.ts` と `/preview/[storeId]/surveys/[formId]/route.ts` は**そのまま残す**。

理由:
- 外部からのプレビューリンク用途
- 後方互換性
- FormEditModal 以外の場所からの利用可能性

### 5. 影響範囲

| ファイル | 変更内容 |
|---------|---------|
| `src/app/api/preview/generate/route.ts` | **新規作成** — POST エンドポイント |
| `src/components/FormEditor/FormEditModal.tsx` | `handlePreview()` を POST 方式に変更 |

### 6. デプロイフローへの影響

**なし**。「更新」ボタン（`handleSaveAndDeploy`）のフローは一切変更しない:
1. `onSave(editingForm)` で DB/JSON に保存
2. `/api/forms/{formId}/deploy` で静的 HTML 生成 → Supabase Storage アップロード
3. 顧客は Storage 上の静的 HTML にアクセス

## テスト計画

1. **手動テスト（ローカル）**:
   - フォームエディタで注意書きを追加 → 保存せずにプレビュー → 注意書きが表示されること
   - メニュー項目を追加 → 保存せずにプレビュー → メニューが反映されること
   - テーマカラーを変更 → 保存せずにプレビュー → 色が反映されること
   - アンケートフォームでも同様のテスト

2. **エッジケース**:
   - 空のフォーム状態でプレビュー → エラーにならないこと
   - 大きなフォーム（多数のメニュー項目）でプレビュー → 正常に生成されること
