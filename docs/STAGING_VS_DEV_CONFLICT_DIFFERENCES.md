# コンフリクト解消時の差分（staging aa15692 vs 現在 HEAD）

マージで dev を採用した 5 ファイルについて、staging（aa15692 = マージ直前の staging）と現在 HEAD の差分をまとめる。戻したい内容: LINE 不要の予約フォーム、LIFF/カレンダー必須外し、店舗メール必須外し、カスタマイズ項目、メニュー複数選択、slotEnd = menuDuration + visitDuration の終了時間計算。

---

## 1. src/lib/static-generator-reservation.ts

| 項目 | staging (aa15692) | 現在 (dev 採用後) |
|------|-------------------|-------------------|
| **LINE/Web 出し分け** | `formType` / `isLineForm` で判定。LINE 時のみ LIFF SDK 読み込み。Web 時は LIFF なし。 | 常に LIFF SDK を読み込む（LINE 前提）。 |
| **config 正規化** | `this.normalizeConfig(safeConfig)` で一括。 | 各セクションを個別に `if (!safeConfig.xxx)` で初期化（冗長）。 |
| **カスタム項目** | `custom_fields` あり。`renderCustomFields(safeConfig)` で描画。state に `customFields: {}`。 | **なし**。`custom_fields` の描画・state を削除。 |
| **メニュー複数選択** | `selectedMenus`（カテゴリ別メニュー ID 配列）、`selectedSubMenus`（メニュー ID → サブメニュー ID）。`getAllSelectedMenuIds()`、`buildSelectedMenuPayload()` で複数メニュー＋サブメニュー対応。 | **単一選択のみ**。`selectedMenu` / `selectedSubmenu`。複数メニュー・複数サブメニューの扱いなし。 |
| **終了時間の計算** | **`slotEnd.setMinutes(slotStart.getMinutes() + menuDuration + optionsDuration + visitDuration)`**。訪問回数オプションの `duration` を加算。 | **`menuDuration + optionsDuration` のみ**。`visitDuration` を加算していない。→ サブメニュー＋訪問回数を使うと終了時間が短く出る不具合の原因。 |
| **サマリー・ペイロード** | `getAllSelectedMenuIds()`、`getSubMenu()`、`buildSelectedMenuPayload()`、`buildSelectedOptionsPayload()`、`formatCustomFieldValue()` 等で複数メニュー・カスタム項目対応。 | 単一メニュー前提。カスタム項目・複数メニュー用のビルド処理なし。 |
| **state** | `selectedMenus`, `selectedSubMenus`, `customFields`, `message`。 | `lineUserId`, `lineDisplayName` 等の LINE 用フィールドを追加。`customFields` / 複数選択用 state は削除。 |

**結論**: staging 版には「予約フォームのみ（LINE 任意）」「カスタム項目」「メニュー複数選択」「終了時間 = メニュー + オプション + 訪問回数」が含まれており、現在版ではこれらが欠けている。特に **slotEnd に visitDuration が入っていない** ため、サブメニュー＋訪問回数選択時の終了時間が誤る。

---

## 2. src/components/FormEditor/Reservation/BasicInfoEditor.tsx

| 項目 | staging (aa15692) | 現在 (dev 採用後) |
|------|-------------------|-------------------|
| **見た目** | FormEditorTheme（`themeClasses`）、`ThemeType`。label/input に `themeClasses.input` 等。 | shadcn の `Label` / `Input` / `Select`。`text-destructive`、`text-muted-foreground`。 |
| **フォーム種別** | `formType`（`form_type` または liff_id の有無で `'line'` / `'web'`）。`isLineForm` で出し分け。 | 種別による出し分けなし。 |
| **LIFF ID** | **LINE のときのみ** LIFF ID 入力欄を表示。必須は LINE 時のみ。 | 常に LIFF ID 欄を表示し **必須**。 |
| **GAS エンドポイント** | 削除（Google Calendar API へ一本化）。 | 削除（Google Calendar API へ一本化）。 |
| **Web 専用項目** | **`!isLineForm` のとき**「カレンダー取得URL」（`calendar_url`）と「SECURITY_SECRET」（`security_secret`）を別入力。いずれも必須。 | **なし**。calendar_url / security_secret の入力欄を削除。 |
| **必須の緩和** | Web の場合は LIFF ID 不要。カレンダー URL と SECURITY_SECRET は Web 時のみ必須。 | LIFF ID を常に必須にしており、**LIFF/カレンダーを必須から外す**という要件と逆。 |

**結論**: staging 版は「LINE 時は LIFF 必須、Web 時はカレンダー URL と SECURITY_SECRET 必須」で、**LIFF ID とカレンダー取得エンドポイントを「常に必須」にしない**構成。現在版は LIFF 常時表示・必須になっており、予約フォームのみの構築（LINE 不要）に合わない。

---

## 3. src/lib/form-normalizer.ts

| 項目 | staging (aa15692) | 現在 (dev 採用後) |
|------|-------------------|-------------------|
| **型** | `rawForm as any`。 | `Record<string, unknown>` と `typedRawForm` で型を明示。 |
| **custom_fields** | **`custom_fields: existingConfig?.custom_fields \|\| rawForm.config?.custom_fields \|\| []`** で正規化に含める。 | **`custom_fields` を削除**。config に custom_fields を出さない。→ カスタマイズ項目がフォームで使えなくなる。 |
| **menu_structure** | `allow_cross_category_selection` を参照。 | `allow_cross_category_selection` の行を削除。 |
| **その他** | 同じ defaultConfig の枠組み（visit_options, gender_selection, visit_count_selection, coupon_selection, calendar_settings, ui_settings, validation_rules）。 | 同上だが型アサーション多め。custom_fields のみ欠落。 |

**結論**: staging 版は **カスタマイズ項目（custom_fields）** を正規化に含めており、現在版ではこれが抜けている。メニュー複数選択まわりは `menu_structure` の `allow_cross_category_selection` が staging にはある。

---

## 4. src/app/admin/page.tsx

| 項目 | staging (aa15692) | 現在 (dev 採用後) |
|------|-------------------|-------------------|
| **認証** | `getAppEnvironment()` + `getSupabaseClient()`。Supabase が取れない場合は local なら認証スキップ。 | `shouldSkipAuth()`、`/api/auth/verify` と Cookie、パスワードリセット（hash の token）対応。 |
| **新規 Store** | `newStore` に `subdomain` なし。 | `subdomain` あり。 |
| **店舗メール** | バリデーションは `!newStore.name \|\| !newStore.owner_name \|\| !newStore.owner_email` の可能性（要確認）。 | **`!newStore.owner_email` で必須**。 |
| **UI** | シンプルな form。 | Card / Label / Input / Badge / useToast。 |

**結論**: **店舗の基本情報のメールアドレスを必須から外す**なら、staging 側のバリデーション（または必須チェックから owner_email を外す修正）に合わせる必要がある。staging 版は subdomain なしで「予約フォームのみ」の運用に近い。

---

## 5. src/app/admin/[storeId]/page.tsx

| 項目 | staging (aa15692) | 現在 (dev 採用後) |
|------|-------------------|-------------------|
| **FORM_TEMPLATES** | basic / standard / **premium** / **complete** / **ultimate** / debug。プレミアム〜アルティメットはサブメニュー・オプション・来店回数・クーポン等の組み合わせ。 | basic / standard / debug のみ。プレミアム等を削除。 |
| **デバッグテンプレート** | カテゴリ・メニュー・サブメニュー・オプションが詳細に定義された大きな config。 | 簡略化された config。 |
| **その他** | StoreAdminManager・タブ・サブドメイン・Card UI 等はなし。 | StoreAdminManager、Tabs、getSubdomainBaseDomain、Card 等を追加。 |

**結論**: 見た目は現状のままでもよいので、**テンプレートの種類と中身（プレミアム等・メニュー複数選択やサブメニューを前提にした定義）** は staging 版を残すと、予約フォームのみ・カスタマイズ・複数選択と整合する。

---

## ユーザー指摘の「挙動していない」部分

- **「サブメニューで作成したメニューを選択しても、メニュー時間と訪問回数の時間を合計して終了時間を設定（slotEnd.setMinutes(... + menuDuration + visitDuration + irradiationsDuration)）の挙動がしていない」**
- **原因**: 現在の `src/lib/static-generator-reservation.ts` では `slotEnd` を **`menuDuration + optionsDuration` のみ** で計算しており、**`visitDuration` を加算していない**。
- staging (aa15692) では **`menuDuration + optionsDuration + visitDuration`** で計算している（該当行: `slotEnd.setMinutes(slotStart.getMinutes() + menuDuration + optionsDuration + visitDuration)`）。
- `irradiationsDuration` はコードベース内に出現しないため、別名・別機能の可能性あり。staging 版に同様の加算があれば、復元後に確認する。
