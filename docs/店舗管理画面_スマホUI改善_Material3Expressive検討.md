# 店舗管理画面 スマホ UI 改善 / Material 3 Expressive 導入検討

- 作成日: 2026-09-02
- 対象: 店舗管理者ページ（`/{storeId}/admin`）のスマートフォン表示
- 前提: PC 表示は現状維持。スマホ表示のみ改善し、設定から切り替えできるようにする
- 目的: 「操作しづらい」「画面が勝手に拡大縮小してガタつく」を解消し、あわせて Material 3 Expressive（以下 M3E）風のモバイル UI を導入できるかを判断する

---

## 1. 結論（先に要点）

| 項目 | 結論 |
|---|---|
| ガタつき・勝手な拡大の原因 | コードに起因する具体的な原因が 3 つ特定できた（§2）。M3E とは無関係に、まず基礎修正で解消できる |
| M3E をスマホ表示に導入できるか | **できる。ただし「公式ライブラリを入れる」のではなく「M3E のデザイントークンを自前 CSS で再現する」方式になる**（§3、§4） |
| 推奨アプローチ | **フェーズ 1: 基礎修正（1〜2 日）→ フェーズ 2: M3E 風モバイルテーマを設定で切替（1〜2 週間）** の 2 段階（§5、§6） |
| 切替方法 | 設定タブに「表示スタイル」を追加。`自動（スマホのみ M3E）` / `標準` / `M3E` の 3 択。保存先は端末の localStorage（§5.2） |
| 避けるべき選択 | Google 公式 `@material/web` の導入（メンテナンスモード入り・React/Radix と二重構造・M3E 未対応）（§4 案 C） |

---

## 2. 現状の問題の原因分析

コードを確認した結果、「操作しづらい」「拡大縮小してガタつく」には次の 3 つの具体的原因があります。いずれも見た目の刷新（M3E）とは独立に修正可能です。

### 2.1 入力欄のフォントサイズが 14px（iOS Safari の自動ズームを誘発）

- `src/components/ui/input.tsx` / `select.tsx` は `text-sm`（14px）
- iOS Safari は **フォントサイズ 16px 未満の入力欄にフォーカスすると自動でページをズーム**する仕様
- 予約検索・店舗設定・フォーム編集など入力欄が多いため、「タップするたびに画面が拡大し、閉じると戻る」＝ガタつきの主因と考えられる
- なお `textarea.tsx` だけは `text-base md:text-sm`（スマホ 16px / PC 14px）になっており、この方針が正解。input / select も同じにそろえる

### 2.2 `h-screen`（100vh）ベースのレイアウト

- `StoreAdminLayout.tsx` の外枠が `flex h-screen`
- スマホブラウザはアドレスバーの伸縮で表示領域が変わるため、`100vh` は **スクロール中に高さが変わりレイアウトが跳ねる**、または下端が隠れる
- `100dvh`（dynamic viewport height）に置き換えるのが標準的な解決策

### 2.3 タップ領域・情報密度が PC 向け

- アイコンボタンが 32〜36px（Apple HIG 推奨 44pt / M3 推奨 48dp 未満）
- `text-xs`（12px）の補足テキスト、2 カラムの密なグリッドが多い
- 予約一覧は PC 用 `<Table>` を `hidden md:block` で隠し、スマホ用カードを別途出す実装になっており方向性は良いが、他タブ（設定・アンケート・顧客）は PC レイアウトの縮小表示に近い

### 2.4 補足: viewport 設定について

- `src/app/layout.tsx` の viewport は `width=device-width, initial-scale=1, viewport-fit=cover`。`maximum-scale=1` / `user-scalable=no` は指定していない
- **これは正しい状態**。`user-scalable=no` はアクセシビリティ上非推奨で、iOS は無視するため対策にならない。ピンチズームを禁止するのではなく、§2.1 の根本原因を直す

---

## 3. Material 3 Expressive とは（Web で使う場合の実情）

### 3.1 概要

- Google が 2025 年 5 月（Google I/O 2025）に発表した Material 3 の拡張
- 特徴: バネ物理ベースのモーション、シェイプモーフィング（35 種類の形状）、大きく太いタイポグラフィ、ダイナミックカラー、新コンポーネント（ボタングループ、スプリットボタン、FAB メニュー、ローディングインジケーター、フローティングツールバー）
- 「使いやすさの数値改善（ターゲット発見速度 4 倍等）」を Google が主張しており、**タッチ操作の管理画面との相性は良い**

### 3.2 Web 実装の実情（重要）

| 実装手段 | 状態 | 本プロジェクトでの評価 |
|---|---|---|
| `@material/web`（Google 公式 Web Components） | 2025 年に Google がメンテナンスモード（新機能開発停止）を表明。M3E 非対応 | ✕ 採用不可 |
| Android Jetpack Compose / Flutter | M3E の公式実装はここが中心 | 本プロジェクトは Web のため対象外 |
| MUI（Material UI for React） | M3 対応は限定的、M3E 未対応。shadcn/Radix と競合 | △ 二重構造になり非推奨 |
| **M3E のトークン（色・形状・タイポ・モーション）を Tailwind / CSS 変数で自前実装** | 公式仕様（m3.material.io）とトークン定義は公開されている | **○ 推奨。既存 shadcn/ui の上に「スキン」として被せられる** |
| `@material/material-color-utilities`（Google 公式・色生成のみ） | 小さなユーティリティ。継続メンテ中 | ○ 店舗テーマカラーからダイナミックカラーを生成する用途で使える |

つまり「M3E のライブラリを入れる」のではなく、**現在の shadcn/ui + Tailwind v4 の上に M3E のデザイン言語を CSS トークンとして実装する**のが現実的で、既存コードへの影響も最小です。

---

## 4. 選択肢の比較

| 案 | 内容 | 工数目安 | メリット | デメリット |
|---|---|---|---|---|
| **A. 基礎修正のみ** | 16px 入力欄、dvh、タップ領域 44px 以上、下部ナビ | 1〜2 日 | ガタつきの根本解消。リスク最小 | 見た目は現状のまま |
| **B. A + M3E 風モバイルテーマ（設定で切替）** | CSS トークン + shadcn コンポーネントの上書き。`<html data-ui="m3e">` 属性で切替 | 1〜2 週間 | PC に影響なし。段階導入可。既存の状態管理・API は無変更 | M3E「風」であり公式実装ではない。コンポーネントごとの上書き作業が必要 |
| C. `@material/web` 導入 | Lit ベースの Web Components を React に載せる | 2〜3 週間 | 公式コンポーネント | メンテモード・M3E 未対応・Radix と二重・React 19 との相性で不利 |
| D. モバイル専用画面を別途フルリライト | `/m/{storeId}/admin` などを新規作成 | 4 週間以上 | 最適化の自由度が最大 | 1,873 行の `admin/page.tsx` のロジックを二重管理することになる |

**推奨: 案 A を即実施し、その上で案 B を段階的に進める。** 案 A だけでも「困っている」の大半は解消し、案 B で「M3E で表示したい」を満たします。

---

## 5. 案 B の設計案

### 5.1 適用範囲と切替条件

- 対象は店舗管理者ページ（`StoreAdminLayout` 配下）のみ。マスター管理・テナント管理・公開フォームは対象外
- 切替は「表示スタイル設定 × 画面幅」で決定

| 設定値 | PC（lg 以上 / 1024px〜） | スマホ・タブレット（〜1023px） |
|---|---|---|
| 自動（初期値） | 標準 | **M3E** |
| 標準 | 標準 | 標準 |
| M3E | M3E | M3E |

- 「PC はそのまま」の要望は初期値「自動」で満たされる。PC でも試したい場合のみ「M3E」を選ぶ

### 5.2 設定の保存先

- **端末ごとの好み**（同じ店舗でも人によってスマホ/PC が違う）なので、`localStorage`（キー例: `store_admin_ui_style`）に保存するのが適切
- DB（`stores` / `store_admins`）には持たせない。将来「アカウントに紐づけて端末間で同期したい」となった時点で `user_preferences` テーブルを検討
- 初回表示のちらつき防止のため、`layout.tsx` にインラインスクリプトで `localStorage` を読んで `<html data-ui="m3e">` を先に付与する（テーマ切替ライブラリ next-themes と同じ手法）

### 5.3 切替 UI

- 設定タブ（`case 'settings'`）に「表示設定」カードを追加
- ラジオ 3 択: 自動（スマホのみ Material スタイル）/ 標準 / Material スタイル
- スマホ表示時はヘッダー右上にもトグルを置き、設定タブまで行かずに切り替えられるようにする（任意）

### 5.4 M3E トークンの実装（`globals.css`）

```css
/* 既存トークンはそのまま。M3E 有効時のみ上書き */
html[data-ui="m3e"] {
  /* Color roles（店舗テーマカラー rgb(244,144,49) をシードに生成） */
  --md-primary: #8a4f00;
  --md-on-primary: #ffffff;
  --md-primary-container: #ffdcbe;
  --md-secondary-container: #ffdcc1;
  --md-surface: #fff8f5;
  --md-surface-container: #fbeee6;
  --md-surface-container-high: #f5e8e0;
  --md-outline-variant: #d7c3b6;

  /* Shape scale（M3E は大きめの角丸が特徴） */
  --md-shape-xs: 4px;
  --md-shape-sm: 8px;
  --md-shape-md: 12px;
  --md-shape-lg: 16px;
  --md-shape-xl: 28px;
  --md-shape-full: 9999px;

  /* Typography（Expressive は見出しを太く大きく） */
  --md-headline-md: 700 28px/36px "Noto Sans JP", sans-serif;
  --md-title-md:    600 16px/24px "Noto Sans JP", sans-serif;
  --md-body-lg:     400 16px/24px "Noto Sans JP", sans-serif;
  --md-label-lg:    500 14px/20px "Noto Sans JP", sans-serif;

  /* Motion（バネ挙動は CSS linear() で近似） */
  --md-motion-spring: linear(0, 0.4 12%, 0.9 28%, 1.05 40%, 0.98 55%, 1);
  --md-motion-duration: 350ms;

  /* shadcn のトークンにマッピングして既存コンポーネントに反映 */
  --primary: var(--md-primary);
  --primary-foreground: var(--md-on-primary);
  --background: var(--md-surface);
  --card: var(--md-surface-container);
  --border: var(--md-outline-variant);
  --radius: var(--md-shape-lg);
}
```

- 色は `@material/material-color-utilities` で店舗テーマカラーから自動生成し、上記の値に流し込む（ダイナミックカラー）。ライブラリを入れずに固定パレットから始めても良い

### 5.5 コンポーネントの上書き対応表

shadcn の各コンポーネントは `className` を `cn()` で合成しているため、`html[data-ui="m3e"] .xxx` のセレクタか、コンポーネント内で `data-ui` を見た条件分岐で M3E 版のスタイルを当てられる。

| 現在（shadcn） | M3E での見せ方 | 備考 |
|---|---|---|
| `Button` default | Filled button（高さ 40〜56px、完全な丸み、押下時に形状が少し変わる） | 主要操作 |
| `Button` outline / secondary | Tonal button（`secondary-container` 背景） | |
| `Button` icon | 48×48 のタップ領域を確保 | §2.3 の対策を兼ねる |
| `Card` | 角丸 28px、影なし、`surface-container` の階調で奥行き表現 | |
| `Input` / `Select` | Outlined text field（高さ 56px、フローティングラベル、16px 文字） | §2.1 の対策を兼ねる |
| `Tabs` | M3 Primary tabs（下線インジケーターがバネで移動） | |
| `Sheet`（左メニュー） | **Navigation bar（下部固定・5 項目）に置換** | 片手操作で最重要 |
| 「新規作成」系ボタン | FAB（右下）／ FAB メニュー | 予約手動登録・フォーム作成 |
| `Table`（予約一覧など） | List item（2〜3 行の項目 + 末尾アイコン） | 既存のスマホ用カード表示を M3 リストに寄せる |
| `Dialog` | Full-screen dialog（スマホ） | 予約詳細・編集 |
| `Badge`（ステータス） | Assist / Filter chip | |
| ローディング | M3E Loading indicator（形状が変化する） | CSS アニメーションで再現 |

### 5.6 レイアウト構造（スマホ・M3E 時）

```
┌──────────────────────────────┐
│ Top app bar（店舗名・切替）    │  ← 高さ 64px、スクロールで色が変わる
├──────────────────────────────┤
│                              │
│  コンテンツ（100dvh 基準）     │
│  Card / List / Text field    │
│                              │
│                          ┌──┐│
│                          │＋││  ← FAB（タブごとの主要操作）
│                          └──┘│
├──────────────────────────────┤
│ 🏠   📅   👥   📋   ⚙️        │  ← Navigation bar 80px（既存 5 タブと同一）
└──────────────────────────────┘
```

- ナビゲーション項目は既存 `menuItems`（ダッシュボード / 予約管理 / 顧客管理 / アンケート管理 / 設定）をそのまま使う
- `activeTab` の状態管理・URL クエリは変更しない。**見た目の層だけを差し替える**のが案 B の肝

---

## 6. フェーズ計画

### フェーズ 1: 基礎修正（案 A）— 1〜2 日

1. `input.tsx` / `select.tsx` を `text-base md:text-sm` に変更（iOS 自動ズーム解消）
2. `StoreAdminLayout.tsx` の `h-screen` を `h-dvh`（Tailwind v4 は標準対応）に変更
3. アイコンボタンのタップ領域をスマホ時 44px 以上に（`size="icon"` のスマホ幅を拡大）
4. 左メニュー Sheet に加えて、スマホ時は下部固定ナビを表示（M3E 化の前段として標準デザインで実装）
5. 実機（iPhone Safari / Android Chrome）で確認

→ この時点で「ガタつき」「勝手に拡大」は解消見込み。**M3E を見送る判断になっても、ここまでは実施推奨**

### フェーズ 2: 切替基盤 + M3E トークン — 3〜4 日

1. `localStorage` + `<html data-ui>` の切替基盤、初回ちらつき防止スクリプト
2. 設定タブに「表示設定」カード
3. `globals.css` に M3E トークン（色・形状・タイポ・モーション）を追加し、shadcn トークンにマッピング
4. Button / Card / Input / Select / Dialog を M3E スタイルに上書き

### フェーズ 3: ナビゲーションと主要画面 — 4〜5 日

1. Navigation bar（下部）+ FAB
2. 予約一覧・顧客一覧・アンケート一覧を M3 List item 化
3. 予約詳細ダイアログをフルスクリーン化
4. Tabs / Chip / Loading indicator

### フェーズ 4: 仕上げ — 2〜3 日

1. ダイナミックカラー（店舗テーマカラー連動）
2. モーション調整（バネ挙動、シェイプモーフィング）
3. 実機テスト、アクセシビリティ確認（コントラスト・フォーカス）
4. ドキュメント更新（CLAUDE.md / ARCHITECTURE.md）

合計目安: **フェーズ 1 のみ 1〜2 日、全フェーズで 2〜3 週間**

---

## 7. リスクと対策

| リスク | 対策 |
|---|---|
| `admin/page.tsx`（1,873 行）が単一ファイルで、スタイル分岐を足すとさらに肥大化する | 見た目はトークン + CSS セレクタ側で切り替え、TSX 側の分岐を最小化。並行してタブごとのコンポーネント分割を少しずつ進める |
| M3E「風」であり公式実装との差異が出る | 公式仕様（m3.material.io）のトークン値を参照し、主要コンポーネントに絞って再現する。完全再現は目標にしない |
| 切替 2 系統でテスト範囲が倍になる | 標準 = PC、M3E = スマホ の役割分担を基本とし、「PC で M3E」「スマホで標準」は動作保証をベストエフォートに |
| 店舗テーマカラーによってはコントラスト不足になる | `material-color-utilities` のトーンパレット生成を使い、テキストは常に `on-*` ロールで組み合わせる |
| フォーム編集画面（`FormEditor/`）は PC 前提の複雑 UI で、M3E 化のコストが高い | フェーズ 2〜3 の対象外とし、店舗管理トップ（ダッシュボード・予約・顧客・アンケート一覧・設定）から着手 |

---

## 8. 決めていただきたいこと

1. **フェーズ 1（基礎修正）を先行実施してよいか** — M3E の判断と切り離して、すぐ着手できます
2. **M3E 化の対象範囲** — 店舗管理トップ 5 タブのみで良いか、フォーム編集画面まで含めるか
3. **色の方針** — 店舗テーマカラー連動（ダイナミックカラー）にするか、全店舗共通の固定パレットにするか
4. **切替の初期値** — 「自動（スマホのみ M3E）」で良いか

---

## 9. 参考

- Material 3 Expressive 発表（Google Design Blog）: https://design.google/library/expressive-material-design-google-research
- Material 3 デザインガイドライン・トークン: https://m3.material.io/
- Material Web（メンテナンスモードの告知）: https://github.com/material-components/material-web
- material-color-utilities: https://github.com/material-foundation/material-color-utilities
- iOS Safari の入力欄自動ズーム（16px ルール）: WebKit の仕様上、`font-size < 16px` の `input` にフォーカスすると自動ズームが発生する
- CSS `100dvh`: https://developer.mozilla.org/ja/docs/Web/CSS/length#dvh
