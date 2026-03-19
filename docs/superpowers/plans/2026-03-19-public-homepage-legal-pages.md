# 公開HP・プライバシーポリシー・利用規約 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Google OAuth審査に必要な公開ページ（ホームページ、プライバシーポリシー、利用規約）を Next.js App Router に追加する

**Architecture:** `(public)` ルートグループで3ページ（`/home`, `/privacy`, `/terms`）を追加。共通レイアウトにヘッダー・フッターを配置。全ページ認証不要の静的ページ。

**Tech Stack:** Next.js 16 App Router, Tailwind CSS v4, shadcn/ui (Card), lucide-react

**Spec:** `docs/superpowers/specs/2026-03-19-public-homepage-legal-pages-design.md`

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `src/app/layout.tsx` | ルートレイアウトの `lang="en"` → `lang="ja"` 変更 |
| Create | `src/app/(public)/layout.tsx` | 公開ページ共通レイアウト（ヘッダー・フッター） |
| Create | `src/app/(public)/home/page.tsx` | ホームページ（ヒーロー + 機能カード） |
| Create | `src/app/(public)/privacy/page.tsx` | プライバシーポリシー全文 |
| Create | `src/app/(public)/terms/page.tsx` | 利用規約全文 |

Middleware変更は不要（現在の `middleware.ts` は `/admin` と店舗管理パスのみ保護しており、`/home`, `/privacy`, `/terms` は既に通過する）。

---

### Task 1: 共通レイアウト

**Files:**
- Modify: `src/app/layout.tsx`
- Create: `src/app/(public)/layout.tsx`

- [ ] **Step 1: Change root layout lang to "ja"**

`src/app/layout.tsx` line 34: change `lang="en"` to `lang="ja"` (アプリ全体が日本語のため)

- [ ] **Step 2: Create the public layout**

`src/app/(public)/layout.tsx`:
```tsx
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: {
    template: "%s | NAS",
    default: "NAS - Need Appointment System",
  },
};

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/home" className="text-xl font-bold tracking-tight">
            NAS
          </Link>
          <nav className="flex gap-4 text-sm">
            <Link href="/privacy" className="text-muted-foreground hover:text-foreground transition-colors">
              プライバシーポリシー
            </Link>
            <Link href="/terms" className="text-muted-foreground hover:text-foreground transition-colors">
              利用規約
            </Link>
          </nav>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-muted/50">
        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="flex flex-col sm:flex-row justify-between gap-4">
            <div>
              <p className="font-semibold">NAS - Need Appointment System</p>
              <p className="text-sm text-muted-foreground mt-1">[運営者名]</p>
              <p className="text-sm text-muted-foreground">[所在地]</p>
              <p className="text-sm text-muted-foreground">[連絡先メールアドレス]</p>
            </div>
            <nav className="flex flex-col gap-1 text-sm">
              <Link href="/home" className="text-muted-foreground hover:text-foreground transition-colors">
                ホーム
              </Link>
              <Link href="/privacy" className="text-muted-foreground hover:text-foreground transition-colors">
                プライバシーポリシー
              </Link>
              <Link href="/terms" className="text-muted-foreground hover:text-foreground transition-colors">
                利用規約
              </Link>
            </nav>
          </div>
          <p className="text-xs text-muted-foreground mt-6">
            © 2026 [運営者名]. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
```

- [ ] **Step 3: Verify dev server renders /home without errors**

Run: `pnpm dev` → access `http://localhost:3000/home`
Expected: 404 page with header/footer visible (no page.tsx yet)

- [ ] **Step 4: Commit**

```bash
git add src/app/layout.tsx src/app/\(public\)/layout.tsx
git commit -m "feat: add public layout with header and footer for /home, /privacy, /terms"
```

---

### Task 2: ホームページ

**Files:**
- Create: `src/app/(public)/home/page.tsx`

- [ ] **Step 1: Create the homepage**

`src/app/(public)/home/page.tsx`:
```tsx
import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarDays, MessageSquare, Calendar, Users } from "lucide-react";

export const metadata: Metadata = {
  title: "ホーム",
  description: "NAS (Need Appointment System) - LINE連携の予約フォーム管理システム",
};

const features = [
  {
    icon: CalendarDays,
    title: "予約フォーム作成・管理",
    description: "テンプレートから簡単にフォームを作成。メニュー、料金、時間帯を自由にカスタマイズできます。",
  },
  {
    icon: MessageSquare,
    title: "LINE LIFF連携",
    description: "LINEアプリ内で予約フォームを表示。顧客はLINEから直接予約が可能です。",
  },
  {
    icon: Calendar,
    title: "Google Calendar連携",
    description: "予約をGoogleカレンダーに自動同期。ダブルブッキングの防止と空き状況の確認ができます。",
  },
  {
    icon: Users,
    title: "顧客管理（CRM）",
    description: "顧客情報と来店履歴を一元管理。セグメント分析でリピーター育成を支援します。",
  },
];

export default function HomePage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-16">
      {/* Hero */}
      <section className="text-center mb-16">
        <h1 className="text-4xl font-bold tracking-tight mb-4">
          NAS
        </h1>
        <p className="text-lg text-muted-foreground mb-2">
          Need Appointment System
        </p>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          LINE連携の予約フォーム管理システム。
          テンプレートからフォームを作成し、LINEアプリ内で顧客に予約を提供。
          Google Calendar連携と顧客管理で、店舗運営を効率化します。
        </p>
      </section>

      {/* Features */}
      <section>
        <h2 className="text-2xl font-semibold text-center mb-8">主な機能</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {features.map((feature) => (
            <Card key={feature.title}>
              <CardHeader className="flex flex-row items-center gap-3 pb-2">
                <feature.icon className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">{feature.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{feature.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Verify in browser**

Run: `http://localhost:3000/home`
Expected: ヒーローセクション + 4枚の機能カードが表示される

- [ ] **Step 3: Commit**

```bash
git add src/app/\(public\)/home/page.tsx
git commit -m "feat: add public homepage with hero and feature cards"
```

---

### Task 3: プライバシーポリシー

**Files:**
- Create: `src/app/(public)/privacy/page.tsx`

- [ ] **Step 1: Create the privacy policy page**

`src/app/(public)/privacy/page.tsx`:
```tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "プライバシーポリシー",
  description: "NAS (Need Appointment System) のプライバシーポリシー",
};

export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold mb-8">プライバシーポリシー</h1>

      <div className="max-w-none space-y-8 text-foreground">

        <section>
          <h2 className="text-xl font-semibold mb-3">1. 個人情報取扱事業者</h2>
          <div className="text-sm text-muted-foreground space-y-1">
            <p>事業者名: [運営者名]</p>
            <p>所在地: [所在地]</p>
            <p>連絡先: [連絡先メールアドレス]</p>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">2. 取得する個人情報の種類と取得方法</h2>
          <p className="text-sm text-muted-foreground mb-2">
            当サービス「NAS（Need Appointment System）」（以下「本サービス」）は、以下の個人情報を取得します。
          </p>
          <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
            <li>氏名、電話番号、メールアドレス — 予約フォーム送信時にご本人から直接取得</li>
            <li>LINE ユーザーID — LINE LIFF SDK を通じて自動的に取得</li>
            <li>予約情報（メニュー、日時等） — 予約フォーム送信時にご本人から直接取得</li>
            <li>Google Calendar データ — OAuth同意に基づき Google Calendar API を通じて取得</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">3. 利用目的</h2>
          <p className="text-sm text-muted-foreground mb-2">取得した個人情報は、以下の目的で利用します。</p>
          <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
            <li>予約の受付・管理およびサービスの提供</li>
            <li>予約確認・変更等に関するご連絡</li>
            <li>サービスの改善および利用状況の分析</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">4. 第三者提供</h2>
          <p className="text-sm text-muted-foreground">
            当社は、以下の場合を除き、ご本人の同意なく個人情報を第三者に提供しません。
          </p>
          <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1 mt-2">
            <li>法令に基づく場合</li>
            <li>人の生命、身体または財産の保護のために必要がある場合</li>
            <li>ご本人の同意がある場合（Google Calendar 連携等）</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">5. 業務委託・外国にある第三者への提供</h2>
          <p className="text-sm text-muted-foreground mb-2">
            本サービスの運営にあたり、以下の事業者にデータの取扱いを委託しています。
          </p>
          <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
            <li>Supabase, Inc.（米国） — データベースホスティング</li>
            <li>Vercel, Inc.（米国） — Webアプリケーションホスティング</li>
            <li>LINEヤフー株式会社（日本） — メッセージング基盤</li>
          </ul>
          <p className="text-sm text-muted-foreground mt-2">
            米国は、個人情報保護法（APPI）上「個人の権利利益を保護する上で我が国と同等の水準にあると認められる
            個人情報の保護に関する制度を有している国」として認定されていません。
            各委託先は、契約上の義務として適切なデータ保護措置を講じています。
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">6. 保有個人データに関する権利</h2>
          <p className="text-sm text-muted-foreground mb-2">
            ご本人は、保有個人データについて以下の請求を行うことができます。
          </p>
          <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
            <li>開示の請求</li>
            <li>内容の訂正の請求</li>
            <li>内容の追加の請求</li>
            <li>削除の請求</li>
            <li>利用停止または消去の請求</li>
          </ul>
          <p className="text-sm text-muted-foreground mt-2">
            請求は、上記連絡先メールアドレスまでご連絡ください。ご本人確認の上、合理的な期間内に対応いたします。
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">7. 個人データの保存期間</h2>
          <p className="text-sm text-muted-foreground">
            アカウント削除後、個人データは1年間保持した後に削除します。
            Google Calendar データは、連携解除時に即時削除します。
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">8. 安全管理措置</h2>
          <p className="text-sm text-muted-foreground mb-2">
            当社は、個人データの漏洩等を防止するため、以下の安全管理措置を講じています。
          </p>
          <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
            <li>組織的措置: 個人情報管理責任者の設置、アクセス権限の管理</li>
            <li>技術的措置: SSL/TLS による通信の暗号化、Row Level Security によるデータベースアクセス制御</li>
            <li>物理的措置: クラウドサービス事業者（Supabase / Vercel）のデータセンターにおけるセキュリティ対策に依拠</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">9. Cookie・アクセスログ</h2>
          <p className="text-sm text-muted-foreground">
            本サービスでは、サービス改善のため Vercel Speed Insights を使用してアクセスログを収集しています。
            これらは個人を特定するものではありません。
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">10. Google API サービスの利用</h2>
          <p className="text-sm text-muted-foreground mb-2">
            本サービスは、Google Calendar API を使用して、店舗の予約情報をカレンダーと同期します。
          </p>
          <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
            <li>取得する情報: Google Calendar のイベント情報（読み取り・書き込み）</li>
            <li>利用目的: 予約のカレンダー同期のみ</li>
          </ul>
          <p className="text-sm text-muted-foreground mt-2">
            本サービスの Google API から受信した情報の使用および他のアプリへの転送は、
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              Google API サービスのユーザーデータに関するポリシー
            </a>
            （制限付き使用の要件を含む）に準拠します。
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            当社は、Google ユーザーデータを広告目的に使用せず、
            サービス提供に必要な場合を除き第三者に転送しません。
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">11. プライバシーポリシーの改定</h2>
          <p className="text-sm text-muted-foreground">
            本ポリシーの内容は、法令の変更やサービスの変更に伴い改定することがあります。
            重要な変更がある場合は、本サービス上でお知らせします。
          </p>
        </section>

        <section>
          <p className="text-sm text-muted-foreground">
            制定日: 2026年3月19日
          </p>
        </section>

      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify in browser**

Run: `http://localhost:3000/privacy`
Expected: プライバシーポリシー全文が読みやすく表示される

- [ ] **Step 3: Commit**

```bash
git add src/app/\(public\)/privacy/page.tsx
git commit -m "feat: add privacy policy page (APPI 2022 compliant, Google Limited Use)"
```

---

### Task 4: 利用規約

**Files:**
- Create: `src/app/(public)/terms/page.tsx`

- [ ] **Step 1: Create the terms of service page**

`src/app/(public)/terms/page.tsx`:
```tsx
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "利用規約",
  description: "NAS (Need Appointment System) の利用規約",
};

export default function TermsPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold mb-8">利用規約</h1>

      <div className="max-w-none space-y-8 text-foreground">

        <section>
          <h2 className="text-xl font-semibold mb-3">第1条（総則）</h2>
          <p className="text-sm text-muted-foreground">
            本利用規約（以下「本規約」）は、[運営者名]（以下「当社」）が提供する
            予約フォーム管理サービス「NAS（Need Appointment System）」（以下「本サービス」）の
            利用に関する条件を定めるものです。本サービスを利用するすべてのユーザー（以下「ユーザー」）は、
            本規約に同意したものとみなします。
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">第2条（利用登録）</h2>
          <ol className="list-decimal pl-5 text-sm text-muted-foreground space-y-1">
            <li>本サービスの店舗管理機能を利用するには、当社が定める方法により利用登録を行う必要があります。</li>
            <li>当社は、以下の場合に利用登録を拒否することがあります。
              <ul className="list-disc pl-5 mt-1 space-y-1">
                <li>登録情報に虚偽の内容が含まれている場合</li>
                <li>過去に本規約に違反したことがある場合</li>
                <li>その他、当社が不適切と判断した場合</li>
              </ul>
            </li>
          </ol>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">第3条（アカウント管理）</h2>
          <ol className="list-decimal pl-5 text-sm text-muted-foreground space-y-1">
            <li>ユーザーは、自己の責任においてアカウント情報を管理するものとします。</li>
            <li>アカウント情報の管理不十分、第三者の使用等による損害について、当社は一切の責任を負いません。</li>
          </ol>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">第4条（禁止事項）</h2>
          <p className="text-sm text-muted-foreground mb-2">ユーザーは、以下の行為を行ってはなりません。</p>
          <ol className="list-decimal pl-5 text-sm text-muted-foreground space-y-1">
            <li>法令または公序良俗に反する行為</li>
            <li>犯罪行為に関連する行為</li>
            <li>本サービスのサーバーまたはネットワークに過度の負荷をかける行為</li>
            <li>本サービスの運営を妨害する行為</li>
            <li>他のユーザーの個人情報を不正に収集・利用する行為</li>
            <li>本サービスのリバースエンジニアリング、逆コンパイル、逆アセンブル</li>
            <li>その他、当社が不適切と判断する行為</li>
          </ol>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">第5条（サービスの変更・停止・終了）</h2>
          <ol className="list-decimal pl-5 text-sm text-muted-foreground space-y-1">
            <li>当社は、事前の通知なく本サービスの内容を変更し、または提供を停止・終了することができます。</li>
            <li>当社は、本サービスの変更・停止・終了によりユーザーに生じた損害について、一切の責任を負いません。</li>
          </ol>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">第6条（知的財産権）</h2>
          <p className="text-sm text-muted-foreground">
            本サービスに関する著作権、商標権その他の知的財産権は、当社または正当な権利者に帰属します。
            利用登録は、これらの知的財産権の譲渡または使用許諾を意味するものではありません。
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">第7条（免責事項）</h2>
          <ol className="list-decimal pl-5 text-sm text-muted-foreground space-y-1">
            <li>当社は、本サービスに事実上または法律上の瑕疵がないことを保証しません。</li>
            <li>当社は、本サービスを通じて行われる予約に関するトラブル（予約内容の齟齬、キャンセル等）について、一切の責任を負いません。</li>
            <li>当社がユーザーに対して損害賠償責任を負う場合、その額は当該ユーザーが当社に支払った利用料金の直近1ヶ月分を上限とします。</li>
          </ol>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">第8条（個人情報の取扱い）</h2>
          <p className="text-sm text-muted-foreground">
            本サービスにおける個人情報の取扱いについては、
            <Link href="/privacy" className="underline hover:text-foreground">
              プライバシーポリシー
            </Link>
            に定めるとおりとします。
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">第9条（準拠法・管轄裁判所）</h2>
          <ol className="list-decimal pl-5 text-sm text-muted-foreground space-y-1">
            <li>本規約の解釈は、日本法に準拠します。</li>
            <li>本サービスに関する紛争については、東京地方裁判所を第一審の専属的合意管轄裁判所とします。</li>
          </ol>
        </section>

        <section>
          <p className="text-sm text-muted-foreground">
            制定日: 2026年3月19日
          </p>
        </section>

      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify in browser**

Run: `http://localhost:3000/terms`
Expected: 利用規約全文が表示。第8条のプライバシーポリシーリンクが `/privacy` に遷移する

- [ ] **Step 3: Commit**

```bash
git add src/app/\(public\)/terms/page.tsx
git commit -m "feat: add terms of service page (Japanese law compliant)"
```

---

### Task 5: 型チェック・最終確認

**Files:**
- None (validation only)

- [ ] **Step 1: Run type-check**

Run: `pnpm type-check`
Expected: PASS (no errors)

- [ ] **Step 2: Run lint**

Run: `pnpm lint`
Expected: PASS

- [ ] **Step 3: Verify all 3 pages in browser**

- `http://localhost:3000/home` — ヒーロー + カード4枚 + ヘッダー/フッター
- `http://localhost:3000/privacy` — プライバシーポリシー全文 + ヘッダー/フッター
- `http://localhost:3000/terms` — 利用規約全文 + ヘッダー/フッター
- ヘッダーのナビリンクで3ページ間を遷移できる
- フッターのリンクも動作する
- モバイル幅でもレイアウトが崩れない

- [ ] **Step 4: Verify existing routes are unaffected**

- `http://localhost:3000/` → `/admin` にリダイレクトされる
- `http://localhost:3000/admin` → 管理画面が表示される

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address lint/type-check issues in public pages"
```
