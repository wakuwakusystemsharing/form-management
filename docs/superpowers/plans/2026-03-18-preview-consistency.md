# プレビュー不整合修正 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** プレビューボタンが未保存のエディタ状態を反映するよう修正する

**Architecture:** POST `/api/preview/generate` エンドポイントを新設し、エディタの現在のフォーム状態を受け取ってサーバーサイドで静的 HTML を生成。FormEditModal は Blob URL 経由で新しいウィンドウにプレビューを表示する。

**Tech Stack:** Next.js App Router API Route, StaticReservationGenerator, StaticSurveyGenerator, normalizeForm

**Spec:** `docs/superpowers/specs/2026-03-18-preview-consistency-design.md`

---

## ファイル構成

| ファイル | 操作 | 責務 |
|---------|------|------|
| `src/app/api/preview/generate/route.ts` | 新規作成 | POST でフォーム状態を受け取り HTML を生成して返す |
| `src/components/FormEditor/FormEditModal.tsx` | 修正 | handlePreview を POST 方式に変更、isPreviewing 追加、handleSaveAndDeploy に credentials 追加 |

---

### Task 1: POST `/api/preview/generate` エンドポイント作成

**Files:**
- Create: `src/app/api/preview/generate/route.ts`

- [ ] **Step 1: API ルートファイルを作成**

```typescript
import { NextResponse } from 'next/server';
import { Form } from '@/types/form';
import { SurveyForm, SurveyConfig } from '@/types/survey';
import { shouldSkipAuth } from '@/lib/env';
import { getCurrentUser } from '@/lib/auth-helper';
import { normalizeForm } from '@/lib/form-normalizer';
import { StaticReservationGenerator } from '@/lib/static-generator-reservation';
import { StaticSurveyGenerator } from '@/lib/static-generator-survey';

export async function POST(request: Request) {
  try {
    // 認証チェック
    if (!shouldSkipAuth()) {
      const user = await getCurrentUser(request);
      if (!user) {
        return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
      }
    }

    const body = await request.json();
    const { form, storeId, formType } = body;

    // 入力バリデーション
    if (!form || !storeId || !formType) {
      return NextResponse.json(
        { error: 'form、storeId、formType は必須です' },
        { status: 400 }
      );
    }

    if (formType !== 'reservation' && formType !== 'survey') {
      return NextResponse.json(
        { error: 'formType は "reservation" または "survey" を指定してください' },
        { status: 400 }
      );
    }

    let html: string;

    if (formType === 'reservation') {
      const normalizedForm = normalizeForm(form as Form);
      const generator = new StaticReservationGenerator();
      html = generator.generateHTML(normalizedForm.config, form.id, storeId);
    } else {
      const generator = new StaticSurveyGenerator();
      html = generator.generateHTML(
        (form as SurveyForm).config as SurveyConfig,
        form.id,
        storeId
      );
    }

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    console.error('Preview generate error:', error);
    return NextResponse.json(
      { error: 'プレビューの生成に失敗しました' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: type-check を実行して型エラーがないことを確認**

Run: `pnpm type-check`
Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
git add src/app/api/preview/generate/route.ts
git commit -m "feat: add POST /api/preview/generate endpoint for live preview"
```

---

### Task 2: FormEditModal の handlePreview を POST 方式に変更

**Files:**
- Modify: `src/components/FormEditor/FormEditModal.tsx`

- [ ] **Step 1: import に useRef を追加**

`useState` の隣に `useRef` を追加:

```typescript
import React, { useState, useRef } from 'react';
```

- [ ] **Step 2: isPreviewing state と previewUrlRef を追加**

`const [isSaving, setIsSaving] = useState(false);` の直後に追加:

```typescript
const [isPreviewing, setIsPreviewing] = useState(false);
const previewUrlRef = useRef<string | null>(null);
```

- [ ] **Step 3: handlePreview を async POST 方式に書き換え**

既存の `handlePreview` 関数 (line 122-127) を以下に置き換え:

```typescript
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
    // メモリリーク防止: 60秒後に URL を解放
    setTimeout(() => {
      URL.revokeObjectURL(url);
      if (previewUrlRef.current === url) previewUrlRef.current = null;
    }, 60000);
  } catch (error) {
    console.error('Preview error:', error);
    toast({ title: 'プレビューの生成に失敗しました', variant: 'destructive' });
  } finally {
    setIsPreviewing(false);
  }
};
```

- [ ] **Step 4: プレビューボタンの disabled 条件を更新**

```tsx
<Button
  variant="outline"
  onClick={handlePreview}
  disabled={isSaving || isPreviewing}
  className="flex-1 sm:flex-initial"
>
  <Eye className="mr-2 h-4 w-4" />
  {isPreviewing ? 'プレビュー生成中...' : 'プレビュー'}
</Button>
```

- [ ] **Step 5: handleSaveAndDeploy の fetch に credentials: 'include' を追加**

既存の `handleSaveAndDeploy` 内の fetch (line 85-93) に `credentials: 'include'` を追加:

```typescript
const deployResponse = await fetch(endpoint, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  credentials: 'include',
  body: JSON.stringify({
    storeId: storeId,
    formId: editingForm.id
  }),
});
```

- [ ] **Step 6: type-check を実行**

Run: `pnpm type-check`
Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add src/components/FormEditor/FormEditModal.tsx
git commit -m "fix: preview now reflects unsaved editor state via POST API"
```

---

### Task 3: 手動テスト

- [ ] **Step 1: 開発サーバー起動**

Run: `pnpm dev`

- [ ] **Step 2: 予約フォームのプレビューテスト**

1. `http://localhost:3000/admin` にアクセス
2. 店舗を選択 → フォーム編集モーダルを開く
3. 注意書き（`config.basic_info.notice`）に「テスト注意書き」を入力
4. **保存せずに**「プレビュー」をクリック
5. 新しいウィンドウにピンク色の注意書きバナーが表示されることを確認

- [ ] **Step 3: テーマカラー変更のプレビューテスト**

1. 基本情報タブでテーマカラーを変更
2. **保存せずに**「プレビュー」をクリック
3. 新しい色が反映されていることを確認

- [ ] **Step 4: アンケートフォームのプレビューテスト**

1. アンケートフォームの編集モーダルを開く
2. 質問を追加/変更
3. **保存せずに**「プレビュー」をクリック
4. 変更が反映されていることを確認

- [ ] **Step 5: 更新（デプロイ）フローが正常に動作することを確認**

1. フォームを編集
2. 「更新」ボタンをクリック
3. 従来通りデプロイが成功することを確認
