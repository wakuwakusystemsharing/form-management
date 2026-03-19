# Store Setup Help & Form Card Status Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a service admin help page for store setup procedures and display setup status badges on form cards.

**Architecture:** New utility function `getStoreSetupStatus()` provides the single source of truth for store configuration completeness. A new `/admin/help` page renders step-by-step setup documentation. Form cards in `/admin/[storeId]` consume the utility to show amber warning badges or green completion badges.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind CSS v4, shadcn/ui, lucide-react

---

### Task 1: Store Setup Status Utility

**Files:**
- Create: `src/lib/store-setup-status.ts`

- [ ] **Step 1: Create the utility file**

```typescript
// src/lib/store-setup-status.ts
import type { Store } from '@/types/store';

export type SetupItemKey = 'google_calendar' | 'line_channel';
export type FormType = 'line' | 'web';

export interface SetupItem {
  key: SetupItemKey;
  label: string;
  status: 'complete' | 'incomplete';
  requiredFor: FormType[];
  helpAnchor: string;
}

export interface StoreSetupStatus {
  items: SetupItem[];
  isReadyFor: (formType: FormType) => boolean;
  getMissingFor: (formType: FormType) => SetupItem[];
}

export function getStoreSetupStatus(store: Store): StoreSetupStatus {
  const items: SetupItem[] = [
    {
      key: 'google_calendar',
      label: 'Google Calendar',
      status: store.google_calendar_id ? 'complete' : 'incomplete',
      requiredFor: ['line', 'web'],
      helpAnchor: 'google-calendar',
    },
    {
      key: 'line_channel',
      label: 'LINEチャネル',
      status: store.line_channel_access_token ? 'complete' : 'incomplete',
      requiredFor: ['line'],
      helpAnchor: 'line-setup',
    },
  ];

  const getMissingFor = (formType: FormType): SetupItem[] =>
    items.filter(
      (item) =>
        item.status === 'incomplete' && item.requiredFor.includes(formType)
    );

  const isReadyFor = (formType: FormType): boolean =>
    getMissingFor(formType).length === 0;

  return { items, isReadyFor, getMissingFor };
}
```

- [ ] **Step 2: Verify type-check passes**

Run: `pnpm type-check`
Expected: No errors related to `store-setup-status.ts`

- [ ] **Step 3: Commit**

```bash
git add src/lib/store-setup-status.ts
git commit -m "feat: add store setup status utility"
```

---

### Task 2: Middleware — Allow `/admin/help` Route

**Files:**
- Modify: `src/middleware.ts:61`

The current middleware allows `/admin` (exact) and `/admin/{storeId}` (pattern match). `/admin/help` doesn't match either, so it will trigger full auth flow and redirect non-admin users. We need to let it through the same way `/admin` is handled (page-level auth check).

- [ ] **Step 1: Update the middleware route check**

In `src/middleware.ts`, change line 61 from:

```typescript
  if (pathname === '/admin' || pathname.match(/^\/admin\/([a-z0-9]{6}|st\d{4})$/)) {
```

to:

```typescript
  if (pathname === '/admin' || pathname === '/admin/help' || pathname.match(/^\/admin\/([a-z0-9]{6}|st\d{4})$/)) {
```

This allows `/admin/help` to pass through to the page, which will handle its own auth check (same pattern as `/admin`).

- [ ] **Step 2: Verify type-check passes**

Run: `pnpm type-check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/middleware.ts
git commit -m "feat: allow /admin/help route through middleware"
```

---

### Task 3: Form Card Setup Status Badges

**Files:**
- Modify: `src/app/admin/[storeId]/page.tsx`

Add setup status badges to each reservation form card. Badges appear between the form name/status row and the ID row.

- [ ] **Step 1: Add imports**

In `src/app/admin/[storeId]/page.tsx`, add to the existing imports:

```typescript
import { getStoreSetupStatus } from '@/lib/store-setup-status';
import Link from 'next/link';
```

Also add `HelpCircle` to the lucide-react import list:

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
  Store as StoreIcon,
  AlertTriangle,
  MessageCircle,
  Info,
  HelpCircle
} from 'lucide-react';
```

- [ ] **Step 2: Add setup status badges to form cards**

Before the `forms.map()` call (around line 1635), compute the setup status once:

```tsx
const setupStatus = getStoreSetupStatus(store);
```

Then inside the form card's `forms.map()` callback, right before the ID line (around line 1659), insert the setup status badges.

Find this block (the ID line, around line 1659):

```tsx
                              <p className="text-xs text-muted-foreground font-mono truncate">
                                ID: {form.id}
                      </p>
```

Insert the following **before** that `<p>` tag:

```tsx
                              {/* 設定ステータスバッジ */}
                              {(() => {
                                const formType = form.config?.form_type ?? 'line';
                                const missing = setupStatus.getMissingFor(formType as 'line' | 'web');
                                if (missing.length > 0) {
                                  return (
                                    <div className="flex gap-1.5 flex-wrap mt-0.5">
                                      {missing.map((item) => (
                                        <Link
                                          key={item.key}
                                          href={`/admin/help?storeId=${storeId}#${item.helpAnchor}`}
                                          className="inline-flex items-center gap-1 bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 px-2 py-0.5 rounded-full text-[11px] hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
                                        >
                                          <AlertTriangle className="h-3 w-3" />
                                          {item.label}未設定
                                        </Link>
                                      ))}
                                    </div>
                                  );
                                }
                                return (
                                  <div className="flex gap-1.5 mt-0.5">
                                    <span className="inline-flex items-center gap-1 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 px-2 py-0.5 rounded-full text-[11px]">
                                      ✓ 設定完了
                                    </span>
                                  </div>
                                );
                              })()}
```

- [ ] **Step 3: Add help icon to header**

In the header's right side button group (around line 1106-1125), add a help button before the existing buttons:

Find:
```tsx
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push(`/admin/${storeId}/reservations`)}
```

Insert after the `<div className="flex items-center gap-1 shrink-0">` line:

```tsx
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push(`/admin/help?storeId=${storeId}`)}
              className="text-muted-foreground hover:text-foreground text-xs h-8"
              title="セットアップガイド"
            >
              <HelpCircle className="h-3.5 w-3.5" />
            </Button>
```

- [ ] **Step 4: Verify type-check passes**

Run: `pnpm type-check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/[storeId]/page.tsx
git commit -m "feat: add setup status badges to form cards and help link to header"
```

---

### Task 4: Help Icon on Main Admin Page

**Files:**
- Modify: `src/app/admin/page.tsx`

- [ ] **Step 1: Add HelpCircle import**

Add `HelpCircle` to the lucide-react import on line 15:

```typescript
import { Search, Plus, LogOut, Store as StoreIcon, ExternalLink, Lock, Settings, Calendar, HelpCircle } from 'lucide-react';
```

- [ ] **Step 2: Add help button to header**

In the header's right button group (around line 696), find:

```tsx
          <div className="flex items-center gap-1">
            <span className="hidden sm:block text-xs text-muted-foreground mr-2">{user?.email}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push('/admin/reservations')}
```

Insert after the `<span>` (user email) and before the "全予約一覧" button:

```tsx
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push('/admin/help')}
              className="text-muted-foreground hover:text-foreground text-xs h-8"
              title="セットアップガイド"
            >
              <HelpCircle className="h-3.5 w-3.5" />
            </Button>
```

- [ ] **Step 3: Verify type-check passes**

Run: `pnpm type-check`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/page.tsx
git commit -m "feat: add help icon to main admin page header"
```

---

### Task 5: Help Page

**Files:**
- Create: `src/app/admin/help/page.tsx`

This is a `'use client'` page that renders static help content. If `?storeId` is present, it fetches the store data and shows a setup status summary at the top.

- [ ] **Step 1: Create the help page**

Create `src/app/admin/help/page.tsx` with the following content:

```tsx
'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getStoreSetupStatus } from '@/lib/store-setup-status';
import type { Store } from '@/types/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  ArrowLeft,
  HelpCircle,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  MessageCircle,
  FileText,
  Rocket,
  Store as StoreIcon,
  Lightbulb,
} from 'lucide-react';

const SECTIONS = [
  { id: 'store-creation', label: '1. 店舗作成', icon: StoreIcon },
  { id: 'google-calendar', label: '2. Google Calendar連携', icon: Calendar },
  { id: 'line-setup', label: '3. LINE設定', icon: MessageCircle },
  { id: 'form-creation', label: '4. フォーム作成', icon: FileText },
  { id: 'deploy', label: '5. デプロイ・公開', icon: Rocket },
];

export default function HelpPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <HelpPageContent />
    </Suspense>
  );
}

function HelpPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const storeId = searchParams.get('storeId');
  const [store, setStore] = useState<Store | null>(null);
  const [activeSection, setActiveSection] = useState('store-creation');

  useEffect(() => {
    if (!storeId) return;
    const fetchStore = async () => {
      try {
        const res = await fetch(`/api/stores/${storeId}`, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          setStore(data);
        }
      } catch {
        // サマリー非表示
      }
    };
    fetchStore();
  }, [storeId]);

  useEffect(() => {
    const handleScroll = () => {
      for (const section of [...SECTIONS].reverse()) {
        const el = document.getElementById(section.id);
        if (el && el.getBoundingClientRect().top <= 120) {
          setActiveSection(section.id);
          break;
        }
      }
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const setupStatus = store ? getStoreSetupStatus(store) : null;

  return (
    <div className="min-h-screen bg-background">
      {/* ヘッダー */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 lg:px-8 h-14 flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(storeId ? `/admin/${storeId}` : '/admin')}
            className="text-muted-foreground hover:text-foreground h-8 px-2"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            <span className="text-xs">
              {storeId ? '店舗管理に戻る' : '管理画面に戻る'}
            </span>
          </Button>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-2">
            <HelpCircle className="h-4 w-4 text-primary" />
            <span className="font-semibold text-foreground text-sm">店舗セットアップガイド</span>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 lg:px-8 py-6">
        <div className="flex gap-8">
          {/* サイドバー目次（デスクトップのみ） */}
          <nav className="hidden lg:block w-56 shrink-0">
            <div className="sticky top-20 space-y-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                目次
              </p>
              {SECTIONS.map((section) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                    activeSection === section.id
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  }`}
                >
                  <section.icon className="h-3.5 w-3.5 shrink-0" />
                  {section.label}
                </a>
              ))}
            </div>
          </nav>

          {/* メインコンテンツ */}
          <main className="flex-1 min-w-0 space-y-8">
            {/* モバイル目次 */}
            <div className="lg:hidden flex gap-2 overflow-x-auto pb-2">
              {SECTIONS.map((section) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  className="shrink-0 text-xs px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                >
                  {section.label}
                </a>
              ))}
            </div>

            {/* 店舗設定サマリー */}
            {store && setupStatus && (
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <StoreIcon className="h-4 w-4 text-primary" />
                    <span className="font-medium text-sm">{store.name} の設定状態</span>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {setupStatus.items.map((item) => (
                      <a
                        key={item.key}
                        href={`#${item.helpAnchor}`}
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                          item.status === 'complete'
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-900/50'
                        }`}
                      >
                        {item.status === 'complete' ? (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        ) : (
                          <AlertTriangle className="h-3.5 w-3.5" />
                        )}
                        {item.label}
                        {item.status === 'complete' ? ' 設定済み' : ' 未設定'}
                      </a>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* セクション 1: 店舗作成 */}
            <section id="store-creation" className="scroll-mt-20">
              <SectionHeader number={1} title="店舗作成" required={false} />
              <div className="mt-4 bg-card border border-border rounded-lg p-5 space-y-4">
                <p className="text-sm text-muted-foreground">
                  管理画面から「新しい店舗を追加」をクリックし、以下の情報を入力します。
                </p>
                <div className="bg-muted/50 rounded-md p-4 text-sm space-y-2">
                  <p><strong>必須項目:</strong> 店舗名、オーナー名</p>
                  <p><strong>任意項目:</strong> メールアドレス、電話番号、住所、ウェブサイトURL、店舗説明</p>
                </div>
                <InfoBox>
                  LINEチャネルアクセストークンはこの段階でも設定可能ですが、後からでも設定できます。
                </InfoBox>
              </div>
            </section>

            {/* セクション 2: Google Calendar連携 */}
            <section id="google-calendar" className="scroll-mt-20">
              <SectionHeader number={2} title="Google Calendar連携" required={true} requiredLabel="必須" />
              <div className="mt-4 bg-card border border-border rounded-lg p-5 space-y-4">
                <p className="text-sm text-muted-foreground">
                  予約管理に必要です。全てのフォームタイプ（LINE・Web）で必須の設定です。
                </p>

                <SubSection title="方式A: サービスアカウント（推奨）">
                  <ol className="list-decimal list-inside text-sm text-muted-foreground space-y-2">
                    <li>管理画面のトップで対象店舗の「カレンダー」ボタンをクリック</li>
                    <li>「カレンダーを作成」ボタンで Google Calendar を自動作成</li>
                    <li>カレンダーIDが自動的に店舗に設定されます</li>
                  </ol>
                  <InfoBox>
                    この方式を使用するには、admin_settings テーブルに Google サービスアカウント JSON が設定されている必要があります。
                  </InfoBox>
                </SubSection>

                <SubSection title="方式B: 店舗OAuth連携">
                  <ol className="list-decimal list-inside text-sm text-muted-foreground space-y-2">
                    <li>店舗管理者がGoogleアカウントで認証（OAuth フロー）</li>
                    <li>既存カレンダーを選択または新規作成</li>
                    <li>リフレッシュトークンが暗号化されて保存されます</li>
                  </ol>
                  <InfoBox>
                    この方式では admin_settings に Google OAuth クライアント ID / シークレット、および GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY 環境変数が必要です。
                  </InfoBox>
                </SubSection>
              </div>
            </section>

            {/* セクション 3: LINE設定 */}
            <section id="line-setup" className="scroll-mt-20">
              <SectionHeader number={3} title="LINE設定" required={true} requiredLabel="LINEフォーム利用時必須" requiredColor="amber" />
              <div className="mt-4 bg-card border border-border rounded-lg p-5 space-y-4">
                <p className="text-sm text-muted-foreground">
                  LINEフォーム（form_type: &apos;line&apos;）を使用する場合に必要な設定です。Webフォームのみの場合はスキップできます。
                </p>

                <SubSection title="3-1. チャネルアクセストークン">
                  <ol className="list-decimal list-inside text-sm text-muted-foreground space-y-2">
                    <li>
                      <a href="https://developers.line.biz/console/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                        LINE Developers コンソール
                      </a>
                      にログイン
                    </li>
                    <li>Messaging API チャネルを作成（または既存のチャネルを選択）</li>
                    <li>「チャネルアクセストークン（長期）」を発行</li>
                    <li>管理画面で店舗を編集し、LINEチャネルアクセストークン欄に貼り付けて保存</li>
                  </ol>
                </SubSection>

                <SubSection title="3-2. Webhook URL設定">
                  <ol className="list-decimal list-inside text-sm text-muted-foreground space-y-2">
                    <li>LINE Developers コンソールで「Messaging API設定」→「Webhook設定」を開く</li>
                    <li>Webhook URL に以下を設定:</li>
                  </ol>
                  <div className="mt-2 bg-slate-900 text-slate-200 rounded-md px-4 py-3 font-mono text-xs overflow-x-auto">
                    https://your-domain.com/api/webhooks/line?storeId=&#123;店舗ID&#125;
                  </div>
                  <ol start={3} className="list-decimal list-inside text-sm text-muted-foreground space-y-2 mt-2">
                    <li>「Webhookの利用」をオンにする</li>
                    <li>「検証」ボタンで接続を確認</li>
                  </ol>
                  <InfoBox>
                    店舗IDは管理画面の店舗詳細ページで確認できます。staging環境の場合は form-management-staging.vercel.app がドメインになります。
                  </InfoBox>
                </SubSection>

                <SubSection title="3-3. LIFFアプリ作成">
                  <ol className="list-decimal list-inside text-sm text-muted-foreground space-y-2">
                    <li>LINE Developers コンソールで「LIFF」タブを開き、「追加」をクリック</li>
                    <li>サイズは「Full」を選択</li>
                    <li>エンドポイントURLにフォームの公開URLを設定</li>
                    <li>発行された LIFF ID をフォーム作成時に入力します</li>
                  </ol>
                </SubSection>
              </div>
            </section>

            {/* セクション 4: フォーム作成 */}
            <section id="form-creation" className="scroll-mt-20">
              <SectionHeader number={4} title="フォーム作成" required={false} />
              <div className="mt-4 bg-card border border-border rounded-lg p-5 space-y-4">
                <ol className="list-decimal list-inside text-sm text-muted-foreground space-y-2">
                  <li>管理画面で対象店舗の「管理」ボタンをクリック</li>
                  <li>「予約管理」タブ → 「新しい予約フォームを作成」をクリック</li>
                  <li>テンプレートを選択（基本 / スタンダード / プレミアム / コンプリート / アルティメット）</li>
                  <li>フォームタイプを選択:
                    <ul className="list-disc list-inside ml-4 mt-1 space-y-1">
                      <li><strong>LINE</strong>: LINE LIFFアプリ内で表示される予約フォーム。LIFF ID が必要</li>
                      <li><strong>Web</strong>: 独立したWebページとして公開される予約フォーム。セキュリティシークレットが必要</li>
                    </ul>
                  </li>
                  <li>フォーム名を入力して作成</li>
                  <li>「編集」ボタンでメニュー・カレンダー設定などを詳細にカスタマイズ</li>
                </ol>
              </div>
            </section>

            {/* セクション 5: デプロイ・公開 */}
            <section id="deploy" className="scroll-mt-20">
              <SectionHeader number={5} title="デプロイ・公開" required={false} />
              <div className="mt-4 bg-card border border-border rounded-lg p-5 space-y-4">
                <ol className="list-decimal list-inside text-sm text-muted-foreground space-y-2">
                  <li>フォーム編集画面で内容を確認</li>
                  <li>「保存＆デプロイ」ボタンをクリック</li>
                  <li>静的HTMLが生成され、Supabase Storageにアップロードされます</li>
                  <li>フォームカードに表示される公開URLをコピー</li>
                  <li>LINEフォームの場合: LIFF エンドポイントURLに公開URLを設定</li>
                  <li>Webフォームの場合: サイトやSNSに公開URLを掲載</li>
                </ol>
                <InfoBox>
                  デプロイ後、フォームカードの URL 欄に公開URLが表示されます。「開く」アイコンで実際のフォームを確認できます。
                </InfoBox>
              </div>
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}

/* ── ヘルパーコンポーネント ── */

function SectionHeader({
  number,
  title,
  required,
  requiredLabel = '必須',
  requiredColor = 'red',
}: {
  number: number;
  title: string;
  required: boolean;
  requiredLabel?: string;
  requiredColor?: 'red' | 'amber';
}) {
  const colorClasses = requiredColor === 'red'
    ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
    : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';

  return (
    <div className="flex items-center gap-3">
      <span className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-semibold shrink-0">
        {number}
      </span>
      <h2 className="text-lg font-semibold">{title}</h2>
      {required && (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colorClasses}`}>
          {requiredLabel}
        </span>
      )}
    </div>
  );
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded-md overflow-hidden">
      <div className="px-4 py-3 bg-muted/50 border-b border-border font-medium text-sm">
        {title}
      </div>
      <div className="p-4 space-y-3">{children}</div>
    </div>
  );
}

function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 p-3 bg-blue-50 dark:bg-blue-950/20 border-l-3 border-blue-500 rounded-r-md">
      <Lightbulb className="h-3.5 w-3.5 text-blue-500 shrink-0 mt-0.5" />
      <p className="text-xs text-blue-800 dark:text-blue-300">{children}</p>
    </div>
  );
}
```

- [ ] **Step 2: Verify type-check passes**

Run: `pnpm type-check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/help/page.tsx
git commit -m "feat: add store setup help page at /admin/help"
```

---

### Task 6: Final Verification

- [ ] **Step 1: Run type-check**

Run: `pnpm type-check`
Expected: PASS with no errors

- [ ] **Step 2: Run lint**

Run: `pnpm lint`
Expected: PASS (or only pre-existing warnings)

- [ ] **Step 3: Run build**

Run: `pnpm build`
Expected: Successful build with no errors

- [ ] **Step 4: Manual smoke test**

Start dev server with `pnpm dev` and verify:
1. `/admin` — HelpCircle icon appears in header, clicking navigates to `/admin/help`
2. `/admin/help` — Full help page renders with 5 sections, sidebar TOC, scroll tracking
3. `/admin/{storeId}` — HelpCircle icon in header, form cards show amber badges (if settings missing) or green badge (if complete)
4. Clicking an amber badge navigates to `/admin/help?storeId={storeId}#section-id`
5. Help page with `?storeId` shows store setup summary at top

- [ ] **Step 5: Commit any fixes if needed, then final commit**

Stage only the specific files that were modified, then commit:

```bash
git add <specific-changed-files>
git commit -m "fix: address any issues found during verification"
```
