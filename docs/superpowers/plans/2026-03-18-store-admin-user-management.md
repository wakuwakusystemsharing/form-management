# 店舗管理者ユーザー管理機能拡張 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 店舗管理者管理画面に「ログインURLコピー」「ユーザー編集（メール・パスワード変更）」機能を追加する。

**Architecture:** `StoreAdminManager.tsx` にコピーボタンと編集モーダルを追加し、バックエンドは既存の `admins/[userId]/route.ts` に PATCH ハンドラを追加する。認証は `getCurrentUser()` + `isServiceAdmin()` でサービス管理者のみに制限する。

**Tech Stack:** Next.js 16 App Router, TypeScript, shadcn/ui, Supabase Auth Admin API, pnpm

---

## ファイル構成

| ファイル | 変更種別 | 役割 |
|---------|---------|------|
| `src/app/api/stores/[storeId]/admins/[userId]/route.ts` | 修正 | PATCH エンドポイント追加（認証・認可付き） |
| `src/components/StoreAdminManager.tsx` | 修正 | ログインURLコピーボタン + 編集モーダル追加 |

---

## Task 1: PATCH API エンドポイントを追加する

**Files:**
- Modify: `src/app/api/stores/[storeId]/admins/[userId]/route.ts`

### 背景知識

- `getCurrentUser(request)` — `src/lib/auth-helper.ts` にある。Cookie または Authorization ヘッダーからトークンを取得し `{ id, email }` を返す。認証なしは `null`
- `isServiceAdmin(email)` — `src/lib/supabase.ts` にある。ハードコードされた管理者メールリストで判定
- `shouldSkipAuth()` — `src/lib/env.ts` にある。local 環境では `true` を返す
- `getSupabaseAdminClient()` — `src/lib/supabase.ts` にある。RLS をバイパスする Admin クライアントを返す
- local 環境のデータは `data/store_admins_{storeId}.json` に保存されている

- [ ] **Step 1: 既存の route.ts を確認する**

```bash
cat src/app/api/stores/\[storeId\]/admins/\[userId\]/route.ts
```

現在 `DELETE` ハンドラのみあることを確認する。

- [ ] **Step 2: PATCH ハンドラを追加する**

まず、ファイル冒頭の既存 import に以下を追加する:

```typescript
import { getCurrentUser } from '@/lib/auth-helper';
import { isServiceAdmin } from '@/lib/supabase';
```

次に、ファイル末尾（`DELETE` の後）に以下を追加する:

```typescript
// PATCH /api/stores/[storeId]/admins/[userId] - ユーザー情報更新
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ storeId: string; userId: string }> }
) {
  try {
    const { storeId, userId } = await params;
    const body = await request.json();
    const { email, password } = body;

    // email と password が両方省略の場合はエラー
    if (!email && !password) {
      return NextResponse.json(
        { error: '更新する項目（メールアドレスまたはパスワード）を指定してください' },
        { status: 400 }
      );
    }

    // パスワードが指定されている場合は6文字以上チェック
    if (password && password.length < 6) {
      return NextResponse.json(
        { error: 'パスワードは6文字以上で入力してください' },
        { status: 400 }
      );
    }

    const env = getAppEnvironment();

    // ローカル環境: JSON ファイルのメールアドレスのみ更新
    if (env === 'local') {
      const adminsPath = path.join(DATA_DIR, `store_admins_${storeId}.json`);

      if (!fs.existsSync(adminsPath)) {
        return NextResponse.json(
          { error: '店舗管理者が見つかりません' },
          { status: 404 }
        );
      }

      const data = fs.readFileSync(adminsPath, 'utf-8');
      const admins = JSON.parse(data) as Array<{ user_id: string; email?: string }>;
      const adminIndex = admins.findIndex(a => a.user_id === userId);

      if (adminIndex === -1) {
        return NextResponse.json(
          { error: '店舗管理者が見つかりません' },
          { status: 404 }
        );
      }

      if (email) {
        admins[adminIndex].email = email;
      }
      // パスワード変更はローカル環境ではスキップ

      fs.writeFileSync(adminsPath, JSON.stringify(admins, null, 2));
      return NextResponse.json({ success: true, email: admins[adminIndex].email });
    }

    // staging/production: 認証・認可チェック（ファイル冒頭で静的 import 済み）
    const currentUser = await getCurrentUser(request);
    if (!currentUser) {
      return NextResponse.json(
        { error: '認証が必要です' },
        { status: 401 }
      );
    }

    if (!currentUser.email || !isServiceAdmin(currentUser.email)) {
      return NextResponse.json(
        { error: 'この操作はサービス管理者のみ実行できます' },
        { status: 403 }
      );
    }

    // Supabase Admin API でユーザー情報を更新
    const adminClient = getSupabaseAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: 'Supabase 接続エラー' },
        { status: 500 }
      );
    }

    const updatePayload: { email?: string; password?: string } = {};
    if (email) updatePayload.email = email;
    if (password) updatePayload.password = password;

    const { data: updatedUser, error: updateError } = await adminClient.auth.admin.updateUserById(
      userId,
      updatePayload
    );

    if (updateError) {
      console.error('[API] User update error:', updateError);
      // メール重複エラーの判定
      if (updateError.message?.includes('already been registered') || updateError.message?.includes('duplicate')) {
        return NextResponse.json(
          { error: 'このメールアドレスは既に使用されています' },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: `ユーザー情報の更新に失敗しました: ${updateError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      email: updatedUser.user?.email,
    });
  } catch (error) {
    console.error('Store Admin update error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 3: 型チェックを実行する**

```bash
pnpm type-check
```

エラーがないことを確認する。

- [ ] **Step 4: コミットする**

```bash
git add src/app/api/stores/\[storeId\]/admins/\[userId\]/route.ts
git commit -m "feat: 店舗管理者ユーザー情報更新 PATCH API を追加"
```

---

## Task 2: StoreAdminManager にログインURLコピーボタンを追加する

**Files:**
- Modify: `src/components/StoreAdminManager.tsx`

### 背景知識

- `getBaseUrl()` は `src/lib/env.ts` にある。クライアントサイドでは `window.location.origin` を返す（`'use client'` コンポーネントなので問題なし）
- `navigator.clipboard.writeText()` でクリップボードにコピーする
- `Copy` アイコンは `lucide-react` から import する

- [ ] **Step 5: インポートに `Copy`、`Pencil` アイコンと `getBaseUrl` を追加する**

`StoreAdminManager.tsx` の import 部分を以下のように修正する:

```typescript
// 変更前
import { Plus, Trash2, Search, UserPlus } from 'lucide-react';

// 変更後
import { Plus, Trash2, Search, UserPlus, Copy, Pencil } from 'lucide-react';
```

```typescript
// 追加（既存 import の後）
import { getBaseUrl } from '@/lib/env';
```

- [ ] **Step 6: ログインURLコピーのハンドラを追加する**

`StoreAdminManager` コンポーネント内、`handleDeleteAdmin` 関数の後に以下を追加する:

```typescript
const handleCopyLoginUrl = async () => {
  const url = `${getBaseUrl()}/${storeId}/admin`;
  try {
    await navigator.clipboard.writeText(url);
    toast({
      title: 'コピーしました',
      description: `ログインURL: ${url}`,
    });
  } catch {
    toast({
      title: 'エラー',
      description: 'URLのコピーに失敗しました',
      variant: 'destructive',
    });
  }
};
```

- [ ] **Step 7: カードヘッダーにコピーボタンを追加する**

カードヘッダーのボタン部分を以下のように修正する:

```typescript
// 変更前
<Button onClick={() => setShowAddDialog(true)}>
  <UserPlus className="mr-2 h-4 w-4" />
  ユーザー追加
</Button>

// 変更後
<div className="flex gap-2">
  <Button variant="outline" onClick={handleCopyLoginUrl}>
    <Copy className="mr-2 h-4 w-4" />
    ログインURLをコピー
  </Button>
  <Button onClick={() => setShowAddDialog(true)}>
    <UserPlus className="mr-2 h-4 w-4" />
    ユーザー追加
  </Button>
</div>
```

- [ ] **Step 8: 型チェックを実行する**

```bash
pnpm type-check
```

- [ ] **Step 9: コミットする**

```bash
git add src/components/StoreAdminManager.tsx
git commit -m "feat: 店舗管理者管理画面にログインURLコピーボタンを追加"
```

---

## Task 3: StoreAdminManager にユーザー編集モーダルを追加する

**Files:**
- Modify: `src/components/StoreAdminManager.tsx`

- [ ] **Step 10: 編集用の state を追加する**

コンポーネント内の state 宣言部分（既存の `useState` の後）に以下を追加する:

```typescript
const [editingAdmin, setEditingAdmin] = useState<StoreAdmin | null>(null);
const [editEmail, setEditEmail] = useState('');
const [editPassword, setEditPassword] = useState('');
const [isSaving, setIsSaving] = useState(false);
```

- [ ] **Step 11: 編集保存ハンドラを追加する**

`handleCopyLoginUrl` の後に以下を追加する:

```typescript
const handleOpenEditDialog = (admin: StoreAdmin) => {
  setEditingAdmin(admin);
  setEditEmail(admin.email || '');
  setEditPassword('');
};

const handleSaveAdmin = async () => {
  if (!editingAdmin) return;

  // メールが変更なし、パスワードも空の場合は何もしない
  const emailChanged = editEmail.trim() !== (editingAdmin.email || '');
  if (!emailChanged && !editPassword) {
    setEditingAdmin(null);
    return;
  }

  if (!editEmail.trim()) {
    toast({
      title: 'エラー',
      description: 'メールアドレスを入力してください',
      variant: 'destructive',
    });
    return;
  }

  if (editPassword && editPassword.length < 6) {
    toast({
      title: 'エラー',
      description: 'パスワードは6文字以上で入力してください',
      variant: 'destructive',
    });
    return;
  }

  try {
    setIsSaving(true);
    const response = await fetch(`/api/stores/${storeId}/admins/${editingAdmin.user_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        email: emailChanged ? editEmail.trim() : undefined,
        password: editPassword || undefined,
      }),
    });

    if (response.ok) {
      const result = await response.json();
      // テーブルのメールアドレスを更新
      setAdmins(admins.map(a =>
        a.user_id === editingAdmin.user_id
          ? { ...a, email: result.email ?? editEmail.trim() }
          : a
      ));
      setEditingAdmin(null);
      toast({
        title: '更新しました',
        description: 'ユーザー情報を更新しました',
      });
    } else {
      const error = await response.json();
      toast({
        title: 'エラー',
        description: error.error || 'ユーザー情報の更新に失敗しました',
        variant: 'destructive',
      });
    }
  } catch {
    toast({
      title: 'エラー',
      description: 'ユーザー情報の更新に失敗しました',
      variant: 'destructive',
    });
  } finally {
    setIsSaving(false);
  }
};
```

- [ ] **Step 12: テーブルに編集ボタンを追加する**

テーブル操作列を以下のように修正する:

```typescript
// 変更前
<TableCell className="text-right">
  <Button
    variant="ghost"
    size="sm"
    onClick={() => handleDeleteAdmin(admin.user_id)}
    disabled={deletingId === admin.user_id}
  >
    <Trash2 className="h-4 w-4 text-destructive" />
  </Button>
</TableCell>

// 変更後
<TableCell className="text-right">
  <div className="flex justify-end gap-1">
    <Button
      variant="ghost"
      size="sm"
      onClick={() => handleOpenEditDialog(admin)}
    >
      <Pencil className="h-4 w-4" />
    </Button>
    <Button
      variant="ghost"
      size="sm"
      onClick={() => handleDeleteAdmin(admin.user_id)}
      disabled={deletingId === admin.user_id}
    >
      <Trash2 className="h-4 w-4 text-destructive" />
    </Button>
  </div>
</TableCell>
```

- [ ] **Step 13: 編集モーダルを追加する**

既存の「ユーザー追加ダイアログ」の `</Dialog>` の後に以下を追加する:

```typescript
{/* ユーザー編集ダイアログ */}
<Dialog open={!!editingAdmin} onOpenChange={(open) => {
  if (!open) {
    setEditingAdmin(null);
    setEditEmail('');
    setEditPassword('');
  }
}}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>ユーザー情報を編集</DialogTitle>
      <DialogDescription>
        メールアドレスまたはパスワードを変更できます。パスワードは空白のままにすると変更されません。
      </DialogDescription>
    </DialogHeader>
    <div className="space-y-4 py-4">
      <div className="space-y-2">
        <Label htmlFor="edit-email">メールアドレス</Label>
        <Input
          id="edit-email"
          type="email"
          value={editEmail}
          onChange={(e) => setEditEmail(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="edit-password">新しいパスワード（任意）</Label>
        <Input
          id="edit-password"
          type="password"
          placeholder="変更しない場合は空白のまま"
          value={editPassword}
          onChange={(e) => setEditPassword(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          6文字以上で入力してください
        </p>
      </div>
    </div>
    <DialogFooter>
      <Button variant="outline" onClick={() => setEditingAdmin(null)}>
        キャンセル
      </Button>
      <Button onClick={handleSaveAdmin} disabled={isSaving}>
        {isSaving ? '保存中...' : '保存'}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

- [ ] **Step 14: 型チェックを実行する**

```bash
pnpm type-check
```

エラーがないことを確認する。

- [ ] **Step 15: lint を実行する**

```bash
pnpm lint
```

エラーがないことを確認する。

- [ ] **Step 16: コミットする**

```bash
git add src/components/StoreAdminManager.tsx
git commit -m "feat: 店舗管理者管理画面にユーザー編集モーダルを追加"
```

---

## Task 4: 動作確認

- [ ] **Step 17: 開発サーバーを起動する**

```bash
pnpm dev
```

- [ ] **Step 18: ローカルで動作確認する（local/JSON モード）**

1. `http://localhost:3000/admin` にアクセス
2. 店舗を選択 → 「店舗管理者管理」セクションを確認
3. **ログインURLコピー:** 「ログインURLをコピー」ボタンをクリック → `http://localhost:3000/{storeId}/admin` がクリップボードにコピーされること
4. **ユーザー追加:** 「ユーザー追加」→「新規ユーザーを作成して追加」チェック → メールを入力して追加
5. **ユーザー編集:** 鉛筆アイコンをクリック → メールアドレスを変更して保存 → テーブルの表示が更新されること
6. **パスワード変更（local）:** 保存はできるが、local では実際のパスワード変更は発生しない（スキップ）

- [ ] **Step 19: 最終コミットを確認する**

```bash
git log --oneline -5
```

3つのコミットが追加されていることを確認する。

---

## チェックリスト（完了基準）

- [ ] `pnpm type-check` がエラーなしで通る
- [ ] `pnpm lint` がエラーなしで通る
- [ ] ログインURLコピーボタンが機能する
- [ ] 編集モーダルでメールアドレス変更ができる
- [ ] 編集モーダルでパスワード変更ができる（staging で確認）
- [ ] パスワード未入力時は変更されない
- [ ] 未認証/非管理者の PATCH リクエストが 401/403 で返る（staging で確認）
