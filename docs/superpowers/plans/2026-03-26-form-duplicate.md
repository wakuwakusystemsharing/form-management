# フォーム複製機能 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** サービス管理者が予約フォーム・アンケートフォームを同じ店舗内で複製し、即座に編集モーダルを開ける機能を追加する

**Architecture:** 各フォームタイプ（予約・アンケート）に `POST /api/forms/{formId}/duplicate` と `POST /api/surveys/{id}/duplicate` のAPIエンドポイントを新設。管理画面のフォームカードに複製ボタンを追加し、API呼び出し後にフォーム一覧を再取得して編集モーダルを自動オープンする。

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase, pnpm

**Spec:** `docs/superpowers/specs/2026-03-26-form-duplicate-design.md`

---

### Task 1: 予約フォーム複製 API

**Files:**
- Create: `src/app/api/forms/[formId]/duplicate/route.ts`

- [ ] **Step 1: APIルートファイルを作成**

```typescript
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { Form } from '@/types/form';
import { normalizeForm } from '@/lib/form-normalizer';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';

const DATA_DIR = path.join(process.cwd(), 'data');

function generateRandomFormId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ formId: string }> }
) {
  try {
    const { formId } = await params;
    const env = getAppEnvironment();
    const now = new Date().toISOString();

    if (env === 'local') {
      // ローカル: JSONファイルから元フォームを検索
      let sourceForm: Form | undefined;
      let targetFilePath = '';

      const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('forms_') && f.endsWith('.json'));
      for (const file of files) {
        const filePath = path.join(DATA_DIR, file);
        const data = fs.readFileSync(filePath, 'utf-8');
        const forms: Form[] = JSON.parse(data);
        const found = forms.find(f => f.id === formId);
        if (found) {
          sourceForm = found;
          targetFilePath = filePath;
          break;
        }
      }

      if (!sourceForm) {
        return NextResponse.json({ error: 'フォームが見つかりません' }, { status: 404 });
      }

      // 新しいIDを生成（重複チェック付き）
      const allForms: Form[] = [];
      for (const file of files) {
        const data = fs.readFileSync(path.join(DATA_DIR, file), 'utf-8');
        allForms.push(...JSON.parse(data));
      }
      let newId = generateRandomFormId();
      while (allForms.some(f => f.id === newId)) {
        newId = generateRandomFormId();
      }

      // configをディープコピーしてリセット
      const newConfig = JSON.parse(JSON.stringify(sourceForm.config));
      if (newConfig.basic_info) {
        newConfig.basic_info.form_name = (newConfig.basic_info.form_name || '') + '（コピー）';
        newConfig.basic_info.liff_id = '';
      }

      const newForm: Form = {
        ...sourceForm,
        id: newId,
        config: newConfig,
        status: 'inactive',
        draft_status: 'none',
        static_deploy: undefined,
        created_at: now,
        updated_at: now,
      };

      // 同じファイルに保存
      const existingData = fs.readFileSync(targetFilePath, 'utf-8');
      const existingForms: Form[] = JSON.parse(existingData);
      existingForms.push(newForm);
      fs.writeFileSync(targetFilePath, JSON.stringify(existingForms, null, 2));

      return NextResponse.json(normalizeForm(newForm), { status: 201 });
    }

    // staging/production: Supabase
    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json({ error: 'Supabase 接続エラー' }, { status: 500 });
    }

    // 元フォームを取得
    const { data: sourceForm, error: fetchError } = await adminClient
      .from('reservation_forms')
      .select('*')
      .eq('id', formId)
      .single();

    if (fetchError || !sourceForm) {
      return NextResponse.json({ error: 'フォームが見つかりません' }, { status: 404 });
    }

    // 新しいIDを生成（重複チェック付き）
    let newId = generateRandomFormId();
    let idExists = true;
    while (idExists) {
      const { data } = await adminClient
        .from('reservation_forms')
        .select('id')
        .eq('id', newId)
        .single();
      idExists = !!data;
      if (idExists) newId = generateRandomFormId();
    }

    // configをディープコピーしてリセット
    const config = typeof sourceForm.config === 'string'
      ? JSON.parse(sourceForm.config)
      : JSON.parse(JSON.stringify(sourceForm.config));

    if (config.basic_info) {
      config.basic_info.form_name = (config.basic_info.form_name || '') + '（コピー）';
      config.basic_info.liff_id = '';
    }

    const { data: newForm, error: insertError } = await adminClient
      .from('reservation_forms')
      .insert({
        id: newId,
        store_id: sourceForm.store_id,
        config,
        status: 'inactive',
        draft_status: 'none',
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();

    if (insertError || !newForm) {
      console.error('[API] Form duplicate error:', insertError);
      return NextResponse.json({ error: 'フォームの複製に失敗しました' }, { status: 500 });
    }

    return NextResponse.json(normalizeForm(newForm as Form), { status: 201 });
  } catch (error) {
    console.error('Form duplicate error:', error);
    return NextResponse.json({ error: 'フォームの複製に失敗しました' }, { status: 500 });
  }
}
```

- [ ] **Step 2: 型チェックを実行**

Run: `pnpm type-check`
Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
git add src/app/api/forms/[formId]/duplicate/route.ts
git commit -m "feat: add reservation form duplicate API endpoint"
```

---

### Task 2: アンケートフォーム複製 API

**Files:**
- Create: `src/app/api/surveys/[id]/duplicate/route.ts`

- [ ] **Step 1: APIルートファイルを作成**

```typescript
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { SurveyForm } from '@/types/survey';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';

const DATA_DIR = path.join(process.cwd(), 'data');

function generateRandomFormId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const env = getAppEnvironment();
    const now = new Date().toISOString();

    if (env === 'local') {
      // ローカル: JSONファイルから元フォームを検索
      let sourceForm: SurveyForm | undefined;
      let targetFilePath = '';

      const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('surveys_') && f.endsWith('.json'));
      for (const file of files) {
        const filePath = path.join(DATA_DIR, file);
        const data = fs.readFileSync(filePath, 'utf-8');
        const forms: SurveyForm[] = JSON.parse(data);
        const found = forms.find(f => f.id === id);
        if (found) {
          sourceForm = found;
          targetFilePath = filePath;
          break;
        }
      }

      if (!sourceForm) {
        return NextResponse.json({ error: 'フォームが見つかりません' }, { status: 404 });
      }

      // 新しいIDを生成（重複チェック付き）
      const allForms: SurveyForm[] = [];
      for (const file of files) {
        const data = fs.readFileSync(path.join(DATA_DIR, file), 'utf-8');
        allForms.push(...JSON.parse(data));
      }
      let newId = generateRandomFormId();
      while (allForms.some(f => f.id === newId)) {
        newId = generateRandomFormId();
      }

      // configをディープコピーしてリセット
      const newConfig = JSON.parse(JSON.stringify(sourceForm.config));
      if (newConfig.basic_info) {
        newConfig.basic_info.title = (newConfig.basic_info.title || '') + '（コピー）';
        newConfig.basic_info.liff_id = '';
      }

      const newForm: SurveyForm = {
        ...sourceForm,
        id: newId,
        config: newConfig,
        status: 'inactive',
        draft_status: 'none',
        static_deploy: undefined,
        created_at: now,
        updated_at: now,
      };

      // 同じファイルに保存
      const existingData = fs.readFileSync(targetFilePath, 'utf-8');
      const existingForms: SurveyForm[] = JSON.parse(existingData);
      existingForms.push(newForm);
      fs.writeFileSync(targetFilePath, JSON.stringify(existingForms, null, 2));

      return NextResponse.json(newForm, { status: 201 });
    }

    // staging/production: Supabase
    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json({ error: 'Supabase 接続エラー' }, { status: 500 });
    }

    // 元フォームを取得
    const { data: sourceForm, error: fetchError } = await adminClient
      .from('survey_forms')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !sourceForm) {
      return NextResponse.json({ error: 'フォームが見つかりません' }, { status: 404 });
    }

    // 新しいIDを生成（重複チェック付き）
    let newId = generateRandomFormId();
    let idExists = true;
    while (idExists) {
      const { data } = await adminClient
        .from('survey_forms')
        .select('id')
        .eq('id', newId)
        .single();
      idExists = !!data;
      if (idExists) newId = generateRandomFormId();
    }

    // configをディープコピーしてリセット
    const config = typeof sourceForm.config === 'string'
      ? JSON.parse(sourceForm.config)
      : JSON.parse(JSON.stringify(sourceForm.config));

    if (config.basic_info) {
      config.basic_info.title = (config.basic_info.title || '') + '（コピー）';
      config.basic_info.liff_id = '';
    }

    const { data: newForm, error: insertError } = await adminClient
      .from('survey_forms')
      .insert({
        id: newId,
        store_id: sourceForm.store_id,
        config,
        status: 'inactive',
        draft_status: 'none',
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();

    if (insertError || !newForm) {
      console.error('[API] Survey duplicate error:', insertError);
      return NextResponse.json({ error: 'フォームの複製に失敗しました' }, { status: 500 });
    }

    return NextResponse.json(newForm, { status: 201 });
  } catch (error) {
    console.error('Survey duplicate error:', error);
    return NextResponse.json({ error: 'フォームの複製に失敗しました' }, { status: 500 });
  }
}
```

- [ ] **Step 2: 型チェックを実行**

Run: `pnpm type-check`
Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
git add src/app/api/surveys/[id]/duplicate/route.ts
git commit -m "feat: add survey form duplicate API endpoint"
```

---

### Task 3: 管理画面に複製ボタンと複製ハンドラーを追加

**Files:**
- Modify: `src/app/admin/[storeId]/page.tsx`

- [ ] **Step 1: lucide-reactのインポートに `CopyPlus` を追加**

`Copy` は既にURL コピー用に使われているので、複製ボタンには `CopyPlus` を使って区別する。

既存のインポート（line 20-36）を変更:
```typescript
import {
  ArrowLeft,
  Edit,
  Trash2,
  Plus,
  FileText,
  ClipboardList,
  Calendar,
  Settings,
  ExternalLink,
  Copy,
  CopyPlus,   // ← 追加
  Store as StoreIcon,
  AlertTriangle,
  MessageCircle,
  Info,
  HelpCircle
} from 'lucide-react';
```

- [ ] **Step 2: `duplicatingFormId` ステートを追加**

既存のステート（`deletingFormId` 付近、line 605前後）の近くに追加:
```typescript
const [duplicatingFormId, setDuplicatingFormId] = useState<string | null>(null);
```

- [ ] **Step 3: 予約フォーム複製ハンドラーを追加**

`handleEditForm` 関数（line 838-841）の後に追加:
```typescript
const handleDuplicateForm = async (formId: string) => {
  setDuplicatingFormId(formId);
  try {
    const response = await fetch(`/api/forms/${formId}/duplicate`, {
      method: 'POST',
      credentials: 'include',
    });

    if (response.ok) {
      const newForm = await response.json();
      setForms(prev => [newForm, ...prev]);
      toast({
        title: '成功',
        description: 'フォームを複製しました',
      });
      // 複製後に編集モーダルを開く
      handleEditForm(newForm);
    } else {
      const error = await response.json();
      toast({
        title: 'エラー',
        description: error.error || 'フォームの複製に失敗しました',
        variant: 'destructive',
      });
    }
  } catch (error) {
    console.error('Form duplicate error:', error);
    toast({
      title: 'エラー',
      description: 'フォームの複製に失敗しました',
      variant: 'destructive',
    });
  } finally {
    setDuplicatingFormId(null);
  }
};
```

- [ ] **Step 4: アンケートフォーム複製ハンドラーを追加**

`handleDuplicateForm` の直後に追加:
```typescript
const handleDuplicateSurveyForm = async (formId: string) => {
  setDuplicatingFormId(formId);
  try {
    const response = await fetch(`/api/surveys/${formId}/duplicate`, {
      method: 'POST',
      credentials: 'include',
    });

    if (response.ok) {
      const newForm = await response.json();
      setSurveyForms(prev => [newForm, ...prev]);
      toast({
        title: '成功',
        description: 'アンケートフォームを複製しました',
      });
      // 複製後に編集モーダルを開く
      handleEditForm(newForm);
    } else {
      const error = await response.json();
      toast({
        title: 'エラー',
        description: error.error || 'アンケートフォームの複製に失敗しました',
        variant: 'destructive',
      });
    }
  } catch (error) {
    console.error('Survey duplicate error:', error);
    toast({
      title: 'エラー',
      description: 'アンケートフォームの複製に失敗しました',
      variant: 'destructive',
    });
  } finally {
    setDuplicatingFormId(null);
  }
};
```

- [ ] **Step 5: 予約フォームカードに複製ボタンを追加**

予約フォームのボタングループ（line 1681-1698）の「編集」と「削除」の間に複製ボタンを挿入:
```typescript
<div className="flex gap-2 shrink-0">
  <Button
    size="sm"
    variant="outline"
    onClick={() => handleEditForm(form)}
  >
    <Edit className="mr-2 h-4 w-4" />
    編集
  </Button>
  <Button
    size="sm"
    variant="outline"
    onClick={() => handleDuplicateForm(form.id)}
    disabled={duplicatingFormId === form.id}
  >
    <CopyPlus className="mr-2 h-4 w-4" />
    {duplicatingFormId === form.id ? '複製中...' : '複製'}
  </Button>
  <Button
    size="sm"
    variant="destructive"
    onClick={() => handleDeleteForm(form.id)}
  >
    <Trash2 className="mr-2 h-4 w-4" />
    削除
  </Button>
</div>
```

- [ ] **Step 6: アンケートフォームカードに複製ボタンを追加**

アンケートフォームのボタングループ（line 1841-1858）の「編集」と「削除」の間に複製ボタンを挿入:
```typescript
<div className="flex gap-2 shrink-0">
  <Button
    size="sm"
    variant="outline"
    onClick={() => handleEditForm(form)}
  >
    <Edit className="mr-2 h-4 w-4" />
    編集
  </Button>
  <Button
    size="sm"
    variant="outline"
    onClick={() => handleDuplicateSurveyForm(form.id)}
    disabled={duplicatingFormId === form.id}
  >
    <CopyPlus className="mr-2 h-4 w-4" />
    {duplicatingFormId === form.id ? '複製中...' : '複製'}
  </Button>
  <Button
    size="sm"
    variant="destructive"
    onClick={() => handleDeleteSurveyForm(form.id)}
  >
    <Trash2 className="mr-2 h-4 w-4" />
    削除
  </Button>
</div>
```

- [ ] **Step 7: 型チェックを実行**

Run: `pnpm type-check`
Expected: エラーなし

- [ ] **Step 8: コミット**

```bash
git add src/app/admin/[storeId]/page.tsx
git commit -m "feat: add duplicate buttons for reservation and survey forms in admin UI"
```

---

### Task 4: 動作確認とビルド検証

- [ ] **Step 1: ビルド確認**

Run: `pnpm build`
Expected: ビルド成功

- [ ] **Step 2: lint確認**

Run: `pnpm lint`
Expected: エラーなし

- [ ] **Step 3: ローカル動作確認メモ**

ローカルで `pnpm dev` を起動し、以下を確認:
1. 予約フォームカードに「複製」ボタンが表示される
2. アンケートフォームカードに「複製」ボタンが表示される
3. 複製ボタン押下で「〇〇（コピー）」フォームが作成される
4. 作成後に編集モーダルが自動で開く
5. 複製されたフォームは `inactive`（非公開）状態
6. トースト通知が表示される
