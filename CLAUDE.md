# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

Next.js 16 (App Router) で構築された LINE LIFF ベースの予約フォーム管理システム。マスター管理者がテナント（組織）を管理し、テナント内のシステム管理者が店舗を作成・管理し、店舗管理者がフォーム設定を行い、顧客が LINE 経由で予約を行います。フォームは静的 HTML として生成され、Supabase Storage にデプロイされます。。

## 必須コマンド

### パッケージ管理（pnpm 必須）
```bash
pnpm install              # 依存関係インストール（npm/yarn 使用禁止）
pnpm dev                  # 開発サーバー起動（localhost:3000）
pnpm build                # プロダクションビルド
pnpm lint                 # ESLint チェック
pnpm type-check           # TypeScript 検証（コミット前必須）
pnpm test                 # Vitest（純粋ロジックのユニットテスト。抽選エンジン等）
```

### データベースシーディング
```bash
pnpm seed:local           # ローカル JSON ファイルにシード
pnpm seed:staging         # Supabase staging にシード
pnpm seed:staging-demo    # staging にデモデータをシード
```

### 環境設定
```bash
cp .env.local.example .env.local
# ローカル開発: NEXT_PUBLIC_APP_ENV=local のまま（JSON ファイルを使用）
```

### 主な環境変数
```bash
# 環境切り替え（local / staging / development / production）
NEXT_PUBLIC_APP_ENV=local

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# LINE Platform（オプション）
NEXT_PUBLIC_LINE_CHANNEL_ID=
LINE_CHANNEL_SECRET=

# Google Calendar OAuth（店舗連携用、オプション）
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY=  # リフレッシュトークン暗号化用

# 寄せ書きウォール（staging / production 必須。32 文字以上。変更しない）
WALL_AUTHOR_HASH_SECRET=

# Resend（Web 予約フォームの自動メール通知用、オプション）
RESEND_API_KEY=                         # 未設定時はスキップ（local 開発で安全）
EMAIL_FROM_ADDRESS=                     # 例: 予約通知 <noreply@send.your-domain.com>
```

## アーキテクチャ概要

### 多層設計

**データ層戦略:**
- **Local（開発）**: `data/` ディレクトリ内の JSON ファイル（`stores.json`、`forms_st{storeId}.json`、`reservations.json`）
- **Staging/Production**: Row Level Security (RLS) を使用した Supabase PostgreSQL
- API は `NEXT_PUBLIC_APP_ENV` に基づいて JSON と Supabase を自動切り替え

**環境分離:**
- **Local**: JSON ストレージ、認証スキップ、Supabase Storage モック
- **Staging**: 既存の Supabase プロジェクト（staging 専用）
- **Development**: Supabase staging プロジェクトの dev ブランチ（ブランチ機能使用時）。Vercel プレビューデプロイメントで使用（`NEXT_PUBLIC_APP_ENV=development`）
- **Production**: 新規の独立した Supabase プロジェクト（Pro プラン推奨）
- 各環境は別々の Supabase Storage パスを使用: `reservations/{storeId}/{formId}/index.html` および `surveys/{storeId}/{formId}/index.html`

### 重要なアーキテクチャパターン

**フォーム正規化（`normalizeForm()`）:**
- レガシーのフラット構造 vs 新しい `config.*` 構造を処理
- **フォーム名の正本は `config.basic_info.form_name`**。旧フラット形式の最上位 `form_name` は config に名前が無いときだけ使う。画面・API での表示は `getReservationFormName()`（`src/lib/form-display-name.ts`）に統一し、`(form as any).form_name || config...` の直書きはしない（複製したフォームの名前を変えても古い名前が残る原因になった）
- API 層で全フォームを正規化し、UI の一貫性を確保
- Supabase からの JSONB 文字列を必要に応じてパース
- 常に欠落フィールドをデフォルト値で補完

**静的 HTML 生成:**
- 予約フォーム: `src/lib/static-generator-reservation.ts` の `StaticReservationGenerator.generateHTML()`
- アンケートフォーム: `src/lib/static-generator-survey.ts` の `StaticSurveyGenerator.generateHTML()`
- 抽選フォーム: `src/lib/static-generator-lottery.ts` の `StaticLotteryGenerator.generateHTML()`
- LINE LIFF 互換性のため vanilla JS のみ使用（React なし）
- 動的テーマカラーを使用したインライン CSS
- すべての設定を `FORM_CONFIG` 定数として JSON 埋め込み

**Supabase Storage デプロイ:**
- `src/lib/supabase-storage-deployer.ts` の `SupabaseStorageDeployer`
- 環境ベースのプロジェクト選択（パスプレフィックスではない）
- Content-Type: `text/html; charset=utf-8` でブラウザレンダリングを正しく実行
- `/api/public-form/*` 経由のプロキシ配信で正しいヘッダーを付与
- パス構造:
  - 予約フォーム: `reservations/{storeId}/{formId}/index.html`
  - アンケートフォーム: `surveys/{storeId}/{formId}/index.html`
  - 抽選フォーム: `lotteries/{storeId}/{formId}/index.html`

**認証アーキテクチャ（3階層マルチテナント）:**
- Middleware（`src/middleware.ts`）: UI ページアクセス制御。ロール別ルート保護
- API ルート: Supabase クライアントから `getUser()` を使用した独立認証チェック
- **マスター管理者**: `master_admins` テーブルで判定。全データにフルアクセス。URL: `/master-admin`
- **システム管理者**: `system_admins` テーブルで判定（`org_id` でテナントに所属）。同テナント内の店舗のみアクセス。URL: `/tenant/{slug}/admin`
- **店舗管理者**: `store_admins` テーブルで判定。RLS で自店舗のみアクセス制御。URL: `/{storeId}/admin`
- テナント分離: `organizations` テーブル + `stores.org_id` + RLS ポリシーで完全分離
- `src/lib/supabase.ts`: `isMasterAdmin()`, `isSystemAdminById()`, `getUserRole()`, `checkStoreAccess()`
- Local 環境: すべての認証をスキップ

**Google Calendar 統合:**
- サービスアカウント方式と店舗 OAuth 方式の2パターンをサポート
- `src/lib/google-calendar.ts` - カレンダー作成、イベント CRUD、`getCalendarClientForStore()` で OAuth 自動切替
- `src/lib/google-calendar-token.ts` - OAuth リフレッシュトークンの暗号化/復号化
- `/api/integrations/google-calendar/connect` - OAuth 認証開始
- `/api/integrations/google-calendar/callback` - OAuth コールバック処理（primary カレンダーを初期紐付け）
- `/api/stores/{storeId}/calendar` - POST: カレンダー作成 / PUT: カレンダー ID 切替（書き込み権限を再検証）
- `/api/stores/{storeId}/calendar/list` - 連携中アカウントの書き込み可能カレンダー一覧（store_oauth 専用）
- `/api/stores/{storeId}/calendar/disconnect` - カレンダー連携解除
- `/api/stores/{storeId}/calendar/availability` - カレンダー空き状況取得
- 店舗の `google_calendar_source` カラム: `'system'`（SA 作成）| `'store_oauth'`（店舗連携）で方式を区別
- 店舗管理画面で「カレンダーを変更」ボタン → ダイアログでサブカレンダーへ切替可能
- `admin_settings` テーブル: `google_oauth_client_id`、`google_oauth_client_secret`、`google_service_account_json` を保存

**CRM（顧客管理）機能:**
- `src/lib/customer-utils.ts` - 顧客検索、作成、更新、削除、来店履歴、セグメント分類、統計再計算
- LINE ユーザー ID または電話番号で顧客を自動紐付け
- 来店履歴（`customer_visits`）を予約成立時に作成、キャンセル時に削除
- **統計値は `customer_visits` を真実の源として導出**: `recalculateCustomerStats(customerId)` が `total_visits` / `total_spent` / `first_visit_date` / `last_visit_date` / `average_visit_interval_days` を visits から再計算する
- 予約ステータスが `cancelled` ↔ 非キャンセル に遷移するたびに `customer_visit` を増減 → `recalculateCustomerStats` を実行（API/Webhook/LIFF どの経路からのキャンセルでも同期）
- セグメント分類（`CustomerSegment` 型）: `new`（新規）、`repeat`（リピーター）、`vip`（VIP）、`dormant`（休眠）
  - 判定ロジック: 最終来店 90 日以上 → `dormant`、総利用 5 万円以上または 10 回以上 → `vip`、初回来店 30 日以内 → `new`、2 回以上 → `repeat`
  - `CustomerType`（DB カラム値）は `'new' | 'regular' | 'vip' | 'inactive'` で `CustomerSegment` とは別物（手動タグとして編集可能。一覧バッジには影響しない）
- `/api/stores/{storeId}/customers` - 顧客一覧・作成（重複電話番号は 409 + `existing_customer_id` を返す）
- `/api/stores/{storeId}/customers/{customerId}` - 顧客詳細・更新（PATCH）・削除（DELETE）
- `/api/stores/{storeId}/customers/analytics` - 顧客分析データ
- **すべての顧客 API に `getCurrentUser` + `checkStoreAccess` 認証必須**（local 環境はスキップ）。`{customerId}` 操作時は `verifyCustomerBelongsToStore` で店舗境界も確認
- `CustomerList.tsx`、`CustomerDetail.tsx`、`CustomerAnalytics.tsx`、`CustomerForm.tsx` - UI コンポーネント
- **顧客詳細のアンケートタブ**（予約タブの右隣）: その店舗のアンケート回答のうち、顧客の `line_user_id` と一致する回答を新しい順に表示（`GET /api/stores/{storeId}/surveys/responses?line_user_id=`。local はフォーム名を `survey_forms` として付ける）。LINE 未連携の顧客は紐付け不可の旨を表示。表示可否は `admin_visible_options.customer_survey_history`（未設定は「アンケート管理」タブに連動）。顧客詳細の「メモ」は履歴タブ（予約 / アンケート / 来店 / 抽選 / LINE）の上に表示
- **カルテ機能（第 1 弾）**: 設計は `docs/顧客管理_カルテ機能_実装設計.md`。純粋ロジックは `src/lib/customer-chart.ts`（`normalizeTags` / `CONTACT_METHODS` / `pickPendingNextVisitNote` / `buildVisitNotePatch`）
  - 安全のための情報: `customers.allergies` / `medical_history` を編集フォームの「安全のための情報」で入力し、登録があるときだけ顧客詳細の上部に赤い帯（`data-slot="caution"`）で表示。要配慮個人情報のため本人同意の注記を固定表示
  - タグ: `customers.tags`（TEXT[]。1 タグ 30 文字・20 個まで。API で `normalizeTags`）。`TagInput.tsx` が `GET /customers/tags`（使用回数順の候補）を表示。一覧カード / 行に最大 2 個 + 「+N」、`search` はタグ完全一致もヒット、`?tag=` で絞り込み（顧客詳細のタグをタップ → 一覧へ）
  - 希望連絡手段: `customers.preferred_contact_method`（`line` / `phone` / `email` / `none`。API で検証）
  - 次回への申し送り: `customer_visits.next_visit_note` / `next_visit_note_by` / `next_visit_note_acknowledged_at`（`20260904100000_add_visit_next_note.sql`）。来店カードの「申し送りを書く / 編集」で `PATCH /customers/{id}/visits/{visitId}`。未確認の最新 1 件を顧客詳細の上部に黄色の帯（`data-slot="handoff"`）で表示し、「確認済みにする」（`acknowledge: true`）で消える（来店カードには残る）。本文を変更すると未確認に戻る。`customer_reservation_history` が OFF の店舗では申し送りを出さない

**LINE 友だち追加状態の取り扱い:**
- LIFF `getFriendship()` 失敗時は `null`（不明）を送信。サーバ側で `typeof === 'boolean'` のときだけ既存値を上書きし、不明時は保持
- Webhook の `follow` / `unfollow` イベントで `customers.line_friend_flag` と `line_friend_added_at` を更新（複数イベント一括対応）
- 友だち追加率の分母は **`line_user_id` を持つ顧客に限定**（電話番号のみで登録された顧客は分母外）。analytics レスポンスに `line_friend_connected` / `line_linked_customers` を含む

**LINE Webhook:**
- `POST /api/webhooks/line` - LINE Messaging API からのイベントを受信
- **署名チェック（店舗ごと。設計: `docs/店舗管理者ページ_追加4機能_実装設計.md` の 4 章）**: チャネルシークレットを登録した店舗だけ、ヘッダー `x-line-signature` を確認する（合わなければ 401）。**未登録の店舗は確認せずに通す = 今までどおり**（以前は全店舗で確認していなかった。環境変数 `LINE_CHANNEL_SECRET` は Webhook では使っていない）。シークレットは `store_line_secrets`（RLS ポリシー無し = service_role のみ。`20261121000000_add_store_line_secrets.sql`。**staging / production へは Dashboard の SQL Editor で手動適用**。未適用でも Webhook は今までどおり動く）に保存し、画面・API・ログには出さない。Webhook は届いた内容を `req.text()` で**文字列のまま**読んでから確認する（JSON にしてから戻すと署名が合わない）。シークレットの読み取りに失敗したときは、既存の応答を止めないよう確認せずに通す（ログに残す）
  - 純粋ロジック `src/lib/line-signature.ts`（`computeLineSignature` / `verifyLineSignature` = `timingSafeEqual` / `decideWebhookSignature` → `unverified` / `verified` / `rejected` / `normalizeChannelSecret` / `buildLineWebhookUrl` / `classifyWebhookEndpoint`）、保存 `src/lib/line-secret-repository.ts`（local は `data/store_line_secrets.json`）
  - 登録はテナント側 店舗ページ → 設定タブ → 「LINE 通知の署名チェック」（`LineWebhookSecretSettings.tsx`）。API `GET/PUT/DELETE /api/stores/{storeId}/line-webhook`、`POST .../line-webhook/test`。**運営（マスター管理者・システム管理者）だけが呼べる**（`src/lib/store-access.ts` の `authorizeUpperAdminStoreAccess`。店舗管理者は 403）
  - 「接続を確認」（`src/lib/line-webhook-check.ts` の `checkLineWebhook`）: LINE に登録されている Webhook URL がこの店舗のものか（`same` / `other_store` = 別の店舗 / `other` / `none`）を見て、LINE にテストの通知を送ってもらう。**シークレットが間違っているとその店舗の LINE の自動応答が止まる**ので、登録の直後に自動で確認する。運用は「使うと決まった店舗に運営が手動で登録 → 接続を確認」。全店舗の必須にはしない
  - Vitest: `line-signature.test.ts` / `line-secret-repository.local.test.ts` / `line-webhook-signature-route.test.ts`
- 受信イベントに基づき予約確認メッセージ等を送信
- 同一ユーザー同時予約数上限（`max_concurrent_reservations_per_user`）を防御的に再チェック

**LIFF 2 通目メッセージ機能:**
- フォーム送信時に LINE トークへ任意の **2 通目固定テキスト**を送信できる（公式 LINE の「完全一致応答メッセージ」と組み合わせて自動応答に活用）
- 設定: `FormConfig.basic_info.second_message: { enabled: boolean; text: string }` / `SurveyConfig.basic_info.second_message`
- BasicInfoEditor / SurveyFormEditor の基本情報タブで ON/OFF + 文言編集
- 静的ジェネレータが `liff.sendMessages([msg1, msg2])` で配列送信

**選択肢ごとの「送信時の追加メッセージ」と予約カスタム項目のタグ（設計: `docs/選択肢ごとの追加メッセージ_実装設計.md`）:**
- 選択肢の「設定」ボタン → 「送信時に追加のメッセージを送る」（ON/OFF + 文言。型 `OptionExtraMessage { enabled, text }`、フィールド名 `extra_message`）。その選択肢が選ばれた状態で送信されると、本文（+ 2 通目）に続けて LINE トークへ送る。対象: アンケートの質問 / 追加質問（入れ子含む）の選択肢（`SurveyQuestionOption.extra_message`）、予約フォームのカスタム項目の選択肢・追加質問の選択肢・メニュー / サブメニュー / オプション（`MenuItem` / `SubMenuItem` / `MenuOption.extra_message`）。抽選の事前質問では出さない（`allowExtraMessage={false}`）。Web 予約フォーム（LIFF なし）では送らない
- **LIFF `liff.sendMessages` は 1 回の送信で最大 5 通**（`LIFF_MAX_MESSAGES`）。保存時に「同時に選ばれうる最大の組み合わせ」を数え、超える設定は保存できない（`countSurveyMaxLineMessages` / `countReservationMaxLineMessages` → `validateLiffMessageLimit`。`FormEditModal` のトーストと `PUT /api/forms/{id}` / `PUT /api/surveys/{id}` の 400 の両方）。単一選択 / ドロップダウンは最も多い選択肢 1 つ、複数選択は全部、カテゴリーまたぎ複数選択は上限数ぶんのメニュー、非表示の項目も表示されうるものとして数える（保守的）。送信時は保険として `capLiffMessages`（同じ文言は 1 回、あふれた分は最後の 1 通に空行区切りで連結）
- 純粋ロジック `src/lib/extra-messages.ts`（`resolveExtraMessage` / `capLiffMessages` / 件数計算 / `EXTRA_MESSAGE_RUNTIME_JS` = 埋め込み JS の `xmResolve` / `xmCapMessages`）。生成 HTML の収集はアンケート `svCollectExtraMessages(hiddenIds)`（非表示の質問・隠れた追加質問は数えない。`svSelectedValues` で入れ子をたどる）/ 予約 `BookingForm.collectExtraMessages()`（`getSelectedOwnerIds` + 選択中サブメニュー + `state.customFields`。非表示のカスタム項目・隠れた追加質問は数えない）。編集 UI は共通部品 `src/components/FormEditor/OptionExtraMessageEditor.tsx`（`optionSettingsButtonLabel` で「設定(N)」）。Vitest: `extra-messages.test.ts` / `extra-messages-static-forms.test.ts`
- **予約カスタム項目の選択肢タグ**（`custom_fields[].options[].tags`。アンケートの選択肢タグと同じ）: カスタム項目の選択肢の「設定」モーダルに「タグ」（`TagInput`）。`POST /api/reservations` が予約保存後に `applyReservationCustomFieldTags()`（`src/lib/reservation-tags-apply.ts`。顧客は予約と同じ `findCustomerByLineOrPhone` で特定 = 予約に紐付いた顧客。失敗しても予約は成功扱い）でタグをマージ。集計は `src/lib/reservation-tags.ts` の `collectReservationCustomFieldTags(config, customer_info.custom_fields)`（追加質問の選択肢は対象外）
- 「更新して他のフォームにも反映」ではメニュー構成 / カスタム項目セクションに含まれてそのままコピーされる

**外部予約メール連携（ホットペッパー / エキテンの予約通知メール → Google カレンダー。設計: `docs/メールに届いた予約通知を自動的にGoogleカレンダーに予定を作成する資料/外部予約メール連携_実装設計.md`）:**
- テナント側 店舗ページ → 「メール連携」（`/tenant/{slug}/admin/{storeId}/mail-integration`）。設定画面は `ExternalMailIntegrationSettings.tsx`（ON/OFF・受信用アドレス `rsv-{token}@…`・デフォルト所要時間・メニュー別所要時間ルール・受信ログ）。受信は Resend Inbound → `POST /api/webhooks/inbound-email`（svix 署名検証 → 宛先で店舗特定 → 媒体判定 `src/lib/external-mail/` → 予約番号で重複防止 → `external_reservations` に記録 → `createGenericCalendarEvent`）。local では利用不可
- **設定画面の先頭に「連携の進め方」ガイド** `ExternalMailIntegrationGuide.tsx`（文言・進み具合は純粋ロジック `src/lib/external-mail-guide.ts` の `buildMailGuideSteps` / `buildStoreGuideText`）。手順は ① 店舗の Google カレンダー設定（弊社）② 連携 ON + 保存で受信用アドレス発行（弊社）③ 予約通知メールを受信用アドレスへ転送（店舗。方法 A = Gmail の自動転送 → Google の確認メールは受信ログの「Gmail転送の確認メール」で確認 / 方法 B = 媒体の通知先に直接設定）④ 所要時間（任意）⑤ 受信ログで「登録済み」を確認。画面の状態（カレンダー有無・保存済み ON・ログ）から「完了 / いまここ / 未着手」を出し、受信用アドレス入りの「店舗への案内文」をコピーできる。Vitest: `external-mail-guide.test.ts`

**Web 予約フォーム自動メール通知:**
- `form_type === 'web'` のフォーム送信時、お客様 / 店舗の両方に予約確認メールを自動送信
- 送信エンジン: Resend（`src/lib/email-sender.ts`）。`RESEND_API_KEY` 未設定時はログ出力のみでスキップ
- お客様メール: `customer_email` 宛、From 表示名は店舗名、Reply-To は店舗オーナーのメアド
- 店舗メール: `form.config.calendar_settings.notification_email` > `store.owner_email` の優先順位で決定
- テンプレート: `src/lib/email-templates.ts`（`buildCustomerConfirmationEmail` / `buildStoreNotificationEmail`）
- **メール本文の予約内容は「送信時の項目編集」（`config.line_message_items`）に従う**: `src/lib/reservation-detail-items.ts` の `buildReservationDetailItems(config, reservation)` が LINE メッセージと同じ項目・並び順（お名前 → 電話番号 → 担当スタッフ → 性別 → ご来店回数 → クーポン → カスタム項目 → メニュー → 合計金額 → 合計時間 → 希望日時 → メッセージ）で `{ label, value }` を返し、両テンプレートがそれを描画する。メニューはカテゴリー見出し / オプション行 / オプション所要時間の設定も反映。店舗向けメールの [お客様情報]（お名前 / 電話 / メール）は連絡用に常に載せる。`sendReservationEmails` に `form.config` と `customer_info` / `staff_name` / `booking_mode` を渡すこと
- **店舗管理画面の予約詳細（基本情報カード）**: 同じモジュールの `buildAdminReservationRows(config, reservation)` を `src/components/ReservationInfoRows.tsx` が描画（店舗管理者ページ / テナント側 店舗ページ共通）。担当スタッフ・性別・ご来店回数・クーポン・カスタム項目（メニュー / オプション / 選択肢の追加質問も ID → 表示名に変換）・合計金額・合計時間・第二 / 第三希望日・メッセージを LINE と同じ順で表示。**送信時の項目編集の ON/OFF は見ない**（店舗は入力内容をすべて確認できる）
- オーケストレーション: `src/lib/reservation-email.ts` の `sendReservationEmails`
- 予約フォームに `show_customer_email` フィールド ON で確認用 2 欄入力 + 一致検証 + localStorage 保存
- メール本文に `〒{postal_code} {address}` を差し込むため `stores.postal_code` カラム追加

**LINE リマインダー機能:**
- 予約日の N 日前（`stores.reminder_days_before`、既定 1）に LINE Flex メッセージで自動リマインド
- **当日リマインダー**（`stores.reminder_same_day_enabled`、既定 false / `reminder_same_day_time`、既定 09:00）: 予約当日の指定時刻に「本日の予約」を送る。前日などのリマインダーとは**独立に ON/OFF**（両方 ON なら前日と当日の 2 回届く）。送信時刻の時点で予約時刻を過ぎている予約には送らない（`isSameDayReminderTarget`。時刻の無い予約は対象）。送信時刻より後に入った当日予約は次の毎時 0 分で送る。文面は `reminder_template` を共通で使い、既定文言だけ `daysBefore = 0` → 「【予約当日メッセージ】/ 本日の予約をお知らせします」（`defaultHeaderTitle(0)` / `defaultBodyLabel(0)`）。送信記録は `reminder_logs.kind`（`before` / `same_day`。一意キーは reservation × target_date × kind）。フォローメッセージの `reminder_same_day` 見送り判定（`isReminderSameDay`）も当日リマインダーを見る。顧客詳細のバッジは「当日リマインダー 9/19（土）09:00 送信予定 / 当日リマインダー送信済み」（`reminder_plan.kind` / `reminder_log.kind`）。マイグレーション: `20261013000000_add_same_day_reminder.sql`
- **直前リマインダー**（`stores.reminder_before_time_enabled`、既定 false / `reminder_before_time_minutes`、`REMINDER_BEFORE_TIME_OPTIONS` = 30 分刻み 30〜720、既定 60）: 予約日時 − N 分に送る。前日・当日とは独立（重なっても全部送る）。送るのは「予定 <= 今 < 予約時刻」かつ予約の `created_at` が予定より前のもの（駆け込み予約には送らない）。時刻の無い予約は対象外。Edge Function は今日と明日の予約を見る（日付をまたぐ直前のため）。`reminder_logs.kind = 'before_time'`。文面は共通で `ReminderContext.beforeMinutes` があれば既定文言が「【ご予約1時間前のお知らせ】/ 1時間後にご予約のお時間です」（`formatMinutesJa`）。純粋ロジック `isBeforeTimeReminderDue` / `computeBeforeTimeReminderScheduledAt`。**pg_cron `send_reservation_reminders` は 10 分おき（`*/10 * * * *`）に変更**（前日・当日の判定は「以降」+ 送信記録なので回数が増えても二重送信しない）。マイグレーション: `20261014000000_add_before_time_reminder.sql`
- Supabase Edge Function `send-reminders` が pg_cron（10 分おき。直前リマインダー導入前は毎時 0 分）でトリガー
- 店舗ごとに ON/OFF + 送信時刻指定が可能（`stores.reminder_enabled` / `stores.reminder_time`、デフォルト 19:00）。`PUT /api/stores/{storeId}` で `HH:00` / 1〜30 日 / 文面の型を検証（DB にも CHECK）
- **送信記録 `reminder_logs`**（1 予約 × 対象日 = 1 行。`sending / sent / failed / skipped`）: 送信前に行を確保（sending）してから push するので二重送信しない。`X-Line-Retry-Key` に行 ID（UUID）。失敗は 3 回まで再試行、10 分以上 sending のままの行は再確保
- 判定は「現在時刻(JST) >= reminder_time」（完全一致ではない）。cron が 1 回止まっても同じ日のうちなら次の回で回収する。対象日は「今日 + N 日」なので前日分を翌日に送ることはない。純粋ロジックは `src/lib/follow-message-scheduler.ts`（`isReminderTimeReached` / `reminderTargetDate`）
- トークンが空文字の店舗は抽出時に除外。店舗編集画面でトークン未設定なら赤い警告を表示。顧客詳細の予約履歴に「リマインダー 9/19（土）19:00 送信予定」「リマインダー送信済み 9/19（土）19:00」バッジ（`reservations[].reminder_log` = 送信記録、`reservations[].reminder_plan` = 記録が無い予約について店舗設定から計算した予定。`getReminderPlansForReservations` / `computeReminderScheduledAt` / `formatJstShort`）。フォローも「フォロー 9/25（金）12:00 送信予定」の形で日時を表示
- 1 件ごとに try/catch + 10 秒タイムアウト。店舗・予約の取得は 1000 件ずつページング
- マイグレーション: `20260411100000_add_reminder_settings.sql` / `20260411100001_update_cron_hourly.sql` / `20260911000000_message_delivery_reliability.sql`
- **cron の登録はマイグレーションに含めない**（テンプレの URL・仮キーがそのまま登録される事故が起きたため）。各プロジェクトの Dashboard から手動登録（`docs/フォローメッセージ_リリース手順.md`）

**LINE フォローメッセージ機能（設計: `docs/フォローメッセージ機能_実装設計.md`）:**
- 予約の「基準日（予約日 or 予約受付日）+ N 日後」に、お礼・次回予約案内の Flex メッセージを自動送信。リマインダーとは**独立**（`reminder_*` には触れない。カラム・Edge Function・cron ジョブすべて `follow_*` / `send-follow-messages` / `send_follow_messages` の別名）
- 店舗設定: `stores.follow_enabled`（既定 false）/ `follow_base`（`'reservation_date' | 'created_at'`）/ `follow_days_after`（1〜60。選択肢は `FOLLOW_DAYS_AFTER_OPTIONS`）/ `follow_time`（HH:00）/ `follow_template`（`reminder_template` と同じ JSON）。テナント側 店舗編集ダイアログのリマインダー直下で設定。`PUT /api/stores/{storeId}` で値検証
- **配信予定キュー方式**: `follow_messages` テーブル（1 予約 1 行。`status`: scheduled / sent / skipped / cancelled / superseded / failed、`skip_reason`）。予約成立時（`POST /api/reservations`）に `scheduleFollowMessageForReservation()` が同じ店舗・同じ LINE ユーザーの未送信行を `superseded` にして新予約基準で作り直す。キャンセル ↔ 復元・日時変更は `PATCH /api/reservations/{id}` と LINE Webhook で `cancel / schedule / reschedule` を同期
- 送信: Edge Function `send-follow-messages`（pg_cron 毎時 5 分）。`scheduled_at <= now` の行を取り、店舗 OFF / トークン無し / 予約キャンセル / **基準日より後の再予約あり（rebooked）** / **同じ日に予約リマインダーが送られる（reminder_same_day）** を見送り。行は `scheduled → sending`（`claimed_at`）で確保してから push（送信中の再起動でも二重送信しない。10 分以上 sending のままなら再確保）。`X-Line-Retry-Key` = 行 ID。通信例外も試行回数に数え 3 回で `failed`。200 件ずつ約 50 秒まで繰り返し処理。直近 3 日の LINE 予約で予定行が無いものを補完作成
- 予約成立時の差し替え + 作成は DB 関数 `follow_message_schedule`（1 トランザクション）。再予約をキャンセルすると `follow_message_restore_for_user` が差し替えられていた予定を 1 件復活（元予約が有効・予定が未来のときだけ）
- 店舗設定の変更: OFF → ON で今日以降の LINE 予約に予定を後付け（`backfillFollowMessagesForStore`）。基準日 / 何日後 / 時刻の変更は未送信行を再計算（`applyFollowSettingsToScheduledRows`。過去になった予定は次回実行で送る）。予約のメニュー等だけの編集では予定を触らず、予約日の変更時だけ再計算
- 純粋ロジック（Vitest）: `src/lib/follow-message-scheduler.ts`。文面は `src/lib/reminder-template.ts` の `resolveMessageContent()` を共通化し `src/lib/follow-template.ts` がフォロー用デフォルトを与える。編集 UI は `MessageTemplateEditor.tsx`（`ReminderTemplateEditor` / `FollowTemplateEditor` はその薄いラッパー）。サーバー専用は `src/lib/follow-message-repository.ts`（local は `data/follow_messages.json`。送信はしない）
- 顧客詳細 API の `reservations[].follow_message` に配信状態を同梱し、`CustomerDetail.tsx` の予約履歴にバッジ表示
- マイグレーション: `20260908000000_add_follow_message.sql`。リリース手順: `docs/フォローメッセージ_リリース手順.md`

**予約フォーム「更新して他のフォームにも反映」（設計: `docs/予約フォーム_他フォームへの設定反映_実装設計.md`）:**
- フォーム編集モーダルの「更新」の右のボタン（予約フォームのみ）。編集中のフォームを保存＆デプロイしてから `FormSyncDialog.tsx` を開き、**同じ店舗の予約フォーム**にセクション単位（`FORM_SYNC_SECTIONS`）で設定をコピーして自動で再デプロイする
- 純粋ロジックは `src/lib/form-sync.ts` の `buildSyncedConfig(source, target, sections)`。`form_type` / `line_message_items`（送信時の項目編集）/ `basic_info` のフォーム名・LIFF ID・`line_only`・`second_message` / `calendar_settings` の `show_customer_email`・`notification_email` は**常に反映先のまま**
- サーバー側の新 API は無し（反映先ごとに `GET /api/forms/{id}` → `PUT /api/forms/{id}` → `POST /api/forms/{id}/deploy` を順に呼ぶ）。反映先の選択は localStorage `form_sync_targets_{sourceId}` に記憶
- **元に戻す（スナップショット）**: `form_config_snapshots`（`20261008000000_add_form_config_snapshots.sql`。フォームごとに直近 20 件）。「更新」「反映先」「復元」の直前に `POST /api/forms/{id}/snapshots`（reason: update / sync / restore）で config 全体を保存。`GET .../snapshots` 一覧、`GET .../snapshots/{snapshotId}` で config 取得。復元は `restoreFormFromSnapshot()`（`FormSnapshotDialog.tsx`）が 復元前を保存 → PUT → deploy。反映結果の「元に戻す」、編集モーダルの「更新履歴」（差分セクション表示 + 確認）から実行。サーバー側は `src/lib/form-snapshots.ts`（local は `data/form_config_snapshots.json`）。戻すのは config のみ（種別・URL・公開状態は不変）

**宿泊モード（旅館・1 棟貸し向け。`calendar_settings.booking_mode = 'stay'`。設計: `docs/旅館用予約フォーム検討資料/旅館用予約フォーム_実装設計.md`）:**
- 既存の予約フォームの 3 つ目の日時選択モード。お客様はカレンダーでチェックイン日 → チェックアウト日の順にタップし、人数（区分ごと）を選ぶ。**空きは「泊（夜）」単位**で判定（予約 `[checkin, checkout)` は checkout − 1 の夜まで使う。チェックアウト日の夜が埋まっていてもチェックアウト日には選べる）。空きの正本は **予約 DB + 店舗 Google カレンダー（+ `stay_settings.block_calendar_ids`）**
- 設定 `calendar_settings.stay_settings`（型 `StaySettings`。`sanitizeStaySettings` が補完）: チェックイン / アウト時刻（`check_in_time_options` で選択式も可）、泊数の範囲、`room_count`、休業（曜日 / 特定日 / 期間）、人数の区分 `guest_categories`（`charge`: adult = 有料人数に数える / free / fixed_per_night）、料金表 `pricing.rate_tables`（`by_count` = 有料人数 → 1 泊料金 / `per_person`）と割り当て（優先順位: 特定日 > 季節 > 祝日 > 祝前日 > 曜日 > 基本）、連泊割引 `long_stay_discounts`。宿泊では `business_hours` / 時間間隔 / ✕時間帯 / `max_concurrent_events` / `min_advance_hours` / スタッフカレンダーは使わない。`advance_booking_days` / `min_advance_days` / `conditional_advance_rules`（日数部分）/ 祝日不可 / キャンセルルールは使う
- 純粋ロジック（Vitest）: `src/lib/stay-pricing.ts`（料金・正規化・人数検証）/ `src/lib/stay-availability.ts`（夜ごとの使用数・状態・範囲の可否）/ `src/lib/stay-reservation.ts`（受付時の検証と保存項目 `prepareStayReservation`、キャンセル料 `resolveStayCancelFee`）/ `src/lib/stay-display.ts`（一覧・詳細の表示文）/ `src/lib/japanese-holidays.ts`（祝日判定の TS 版。埋め込み JS と一致をテスト）。サーバー専用は `src/lib/stay-service.ts`
- 静的 HTML: `src/lib/stay-runtime-js.ts`（`STAY_RUNTIME_JS` / `STAY_CSS` / `renderStayFieldHtml`。**料金・空きの判定を直すときは TS 版と両方**）。空きと料金は公開 API `GET /api/stores/{storeId}/stay/availability?form_id&from&to&guests=` から取る（料金変更を再デプロイなしで反映。最大 93 日）。プレビュー（`PREVIEW_MODE`）は API を呼ばず埋め込み設定で料金のみ計算。LINE メッセージは `《チェックイン》《チェックアウト》《泊数》《宿泊人数》《宿泊料金》`
- 予約 API: `POST /api/reservations` は宿泊なら検証 → **料金をサーバーで再計算** → カレンダー重なり確認 → DB 関数 `stay_insert_reservation_checked`（店舗ごとのアドバイザリロックで同じ夜の二重予約を防ぐ。local は JSON 内で同じ判定）。埋まっていれば `409 { code: 'slot_taken' }`。`PATCH` は `checkout_date` / `guest_counts` の編集で再計算 + 重なり確認、`cancelled` で `cancel_fee_percent` / `cancel_fee_amount` / `cancelled_at` を記録（復元でクリア）。列: `reservations.checkout_date` / `stay_nights` / `guest_counts` / `guest_count` / `stay_price_total`（`reservation_date` = チェックイン日、`reservation_time` = チェックイン時刻なのでリマインダー・フォロー・来店履歴は無変更）
- **段階式キャンセル料** `cancel_rules.fee_tiers`（`{ days_before, until_time?, percent }` を日数の大きい順に判定）/ `fee_base`（stay / total）/ `self_cancel_with_fee`（confirm / deny）。宿泊以外のフォームでも使える。規定文が空なら `buildCancelPolicyText` が自動生成してフォームに表示。LINE Webhook は「キャンセル: N」でキャンセル料がかかるとき金額を提示し「キャンセル確定: N」で取り消す（deny なら店舗へ誘導）。**請求はしない**（記録・通知・管理画面表示まで）
- 表示: `reservation-detail-items.ts` がメール用（チェックイン〜宿泊料金の行）/ 管理画面用（チェックアウト以降 + キャンセル料）を出す。予約一覧・顧客詳細は「11/1(日) 〜 11/4(水) 3泊」（`formatStayRangeShort`）。`ReservationEditForm` は宿泊ならチェックイン日 / チェックアウト日 / 人数の編集。分析の売上に `stay_price_total` を加算
- 編集 UI: 営業時間・ルール → 日時選択モード「宿泊」→ `StaySettingsEditor.tsx`（① 基本 ② 人数の区分 ③ 休業日 ④ 料金表 ⑤ 割り当て ⑥ 連泊割引 ⑦ 空き判定に含めるカレンダー（`/calendar/list`）⑧ 料金プレビュー。担当者用の設定シート PDF と同じ並び）。キャンセルルール設定の `CancelFeeTiersEditor.tsx`。テンプレート「🏨 宿泊（1 部屋）」（`FORM_TEMPLATES.stay`。フォーム作成 API はテンプレートの `calendar_settings` / `cancel_rules` も反映）
- マイグレーション: `20261101000000_add_stay_reservation.sql`（列 8 つ + CHECK + 部分インデックス + DB 関数）。**staging / production へは Dashboard の SQL Editor で手動適用**

**プレビュー機能:**
- `POST /api/preview/generate` - 保存前のフォーム編集状態からプレビュー HTML を生成
- `formType`: `'reservation'` または `'survey'` を指定
- デプロイは行わず、HTML を直接レスポンスとして返す

**予約ステータス更新:**
- `PATCH /api/reservations/{reservationId}` - 予約ステータスの変更（管理者用）
- 有効なステータス: `pending`, `confirmed`, `cancelled`, `completed`
- キャンセル時は Google Calendar イベントも自動削除
- キャンセル済み予約はデフォルトでクエリ結果から除外

**予約分析機能（予約管理 → 分析）:**
- `GET /api/stores/{storeId}/reservations/analytics?date_from&date_to&form_id` - 予約分析 API（`authorizeStoreAccess` で保護。予約・フォームは `fetchAllRows` で 1000 件ずつ全件取得）
- 集計は純粋ロジック `src/lib/reservation-analytics.ts` の `computeReservationAnalytics(reservations, forms, formId)`（Vitest 対象）
  - **キャンセル済み（`status = 'cancelled'`）は予約数・日別 / 月別・メニュー・時間帯・顧客属性・売上から除外**し、ステータス別集計と `summary.cancelled` にだけ数える
  - 売上 = メニュー料金 + オプション料金（`reservationAmount`。顧客管理の `calculateTotalAmount` と同じ考え方）。メニュー別売上はメニュー料金のみ、オプションは `option_popularity` で別集計
  - メニューは **名前（カテゴリー > メニュー > サブメニュー）でまとめる**（`menu_id` はテンプレート由来でフォームをまたいで重複するため使わない）
  - 顧客属性（性別 / ご来店回数 / クーポン）は送信時のラベル `customer_info.*_label` → 既定値の日本語 → 生の値（`demographicLabel`）
  - `by_form`: フォーム別の予約数・キャンセル数・売上（`form_id` で絞り込んでも全フォーム分を返す。削除済みフォームは「削除されたフォーム」）。フォーム名はローカル `data/forms_{storeId}.json` / Supabase `reservation_forms.config.basic_info.form_name`
  - 期間プリセット `ANALYTICS_PERIOD_OPTIONS` / `resolveAnalyticsPeriod(preset)`（今月 / 先月 / 過去3か月 / 過去12か月 / 全期間 / 期間指定。JST 基準）
- `ReservationAnalytics.tsx` - 上部に期間チップ + フォームのプルダウン（既定は過去12か月 / すべてのフォーム）、予約数・キャンセル・売上・1件あたりのタイル、概要（フォーム別 / ステータス別 / 日別 / 月別）・メニュー分析（メニュー・オプションの人気と売上）・時間帯分析・顧客属性・売上分析（月別 / フォーム別 / メニュー別）。`fetchWithAuth` を使う。店舗管理者ページとテナント側 店舗ページで共用
- 顧客分析 API（`/customers/analytics`）も `fetchAllRows` で全件取得。月別新規顧客数は JST の月で数える

**予約カレンダー（「カレンダー」タブ。設計: `docs/店舗管理者ページ_追加4機能_実装設計.md` の 6 章。②-1 = 表示、②-2 = ドラッグで移動・空いている所から手動予約、②-3 = スタッフごとの列。すべて実装済み）:**
- 予約を 月 / 週 / 日 で見る画面。店舗管理者ページ `/{storeId}/admin?tab=calendar`（予約管理タブの「カレンダーで見る」からも開く）とテナント側 店舗ページの「カレンダー」タブで、同じ部品 `src/components/ReservationCalendar.tsx` を使う（既製のカレンダー部品は使わず自作）。予約を押すと、それぞれのページの予約詳細のダイアログが開く（`onSelectReservation`。店舗管理者ページでは「予約内容を編集」・キャンセルもそのまま使え、変更後は `reloadSignal` で読み込み直す）
- **新しい保存先は無い**。API `GET /api/stores/{storeId}/reservations/calendar?from&to`（`authorizeStoreAccess`。期間は最大 `CALENDAR_MAX_RANGE_DAYS` = 62 日。その期間に掛かる予約 = キャンセルを含む・宿泊はチェックアウト日まで（期間の 31 日前から読んで絞り込む）を `fetchAllRows` で全件）+ `busy`（予約以外の予定 = 店舗の Google カレンダーの予定のうち、このシステムの予約から作った予定（`google_calendar_event_id`）と「営業日」を除いたもの。**時間だけを返し、タイトルなどの中身は返さない** = 画面は灰色で「予定あり」）+ `google`（`ok` / `none` = カレンダー未設定・local / `error` = 読み込み失敗。失敗しても予約は返し、画面に「Google カレンダーの予定を読み込めませんでした」と出す）。スタッフごとのカレンダーの予定は `staff=1` のときだけ読む（下の「スタッフごとの列」）
- 純粋ロジック `src/lib/reservation-calendar.ts`: **日付は文字列（YYYY-MM-DD）のまま、年・月・日の数字で計算する**（`addDays` / `addMonths` / `weekdayOf` / `diffDays`。`new Date('2026-11-20')` や +24 時間は使わない。「今日」は `jstToday`）。`buildMonthGrid(year, month)`（日曜始まり。4〜6 週）/ `calendarRange` / `shiftAnchor` / `calendarTitle` / `toCalendarEvents(reservations, { includeCancelled })` → 帯（`timed` / `untimed` = 時刻の無い予約 / `stay` = 宿泊。所要時間は `customer_info.total_duration` → メニュー + オプションの所要時間 → 60 分。日をまたぐ予約は 24:00 まで）/ `layoutDayEvents`（重なる予約を横に並べる。重なりでつながったかたまりごとに列を割り当てる。短い予約は 20 分ぶんの高さ）/ `monthCellEvents`（月表示は 1 日 3 件まで + 「ほか N 件」）/ `busyBlocksFromGoogle`（日本時間に直し、日をまたぐ予定は日ごとに分ける）/ `visibleHourRange`（既定 9〜20 時。はみ出すぶんだけ広げる）
- 画面: 月 / 週 / 日 の切り替え（端末ごとに localStorage `reservation_calendar_view`。スマホの初期は日表示）、「今日」・前後の移動、「キャンセルも表示」（既定は非表示）、宿泊・時間未定は上の「終日」の欄、今日の列に「いま」の赤い線。色は予約の状態（確認済み = 緑 / 保留中 = 黄 / 完了 = 灰）。**予約の帯は `<button>` なので `flex flex-col justify-start` を付けている**（ボタンは中身を上下の中央に置くため、付けないと長い予約の文字が帯の真ん中に出る）
- **表示設定**: `admin_visible_options.calendar`（「店舗管理者に表示するメニュー」の「予約管理」の下の「カレンダーを表示」。未設定は「予約管理」に連動 = 予約管理を非表示にしている店舗ではカレンダーも出ない。`independent: true` なので、予約管理が非表示でもカレンダーだけ表示にできる）。**`calendar` は `STORE_ADMIN_TAB_IDS`（`admin_visible_tabs`）には入れていない**（入れると、タブを絞り込んで保存している既存の店舗でカレンダーだけ出なくなるため）。メニューに出す項目は `buildStoreAdminNav(visibleTabs, showCalendar)`（型 `StoreAdminNavId`）で作り、`StoreAdminLayout` に `showCalendar` を渡す
- **ドラッグで移動（②-2。パソコンのマウスだけ）**: 予約の帯をつかんで別の日時に落とす → 確認（変更前 / 変更後、その時間のほかの予約の件数、予約以外の予定との重なり、「Google カレンダーの予定も一緒に変わります。お客様への通知は送られません」）→ `PATCH /api/reservations/{id}` に `{ reservation_date, reservation_time, expected_updated_at }`（Google カレンダーの予定・来店履歴・フォローの予定・空き待ちの見回りは、既存の PATCH の中で行う）。**止めはしない**（ほかの予約と重なっていても、店舗の判断で動かせる）。動かせるのは時間の決まっている・キャンセルしていない予約だけ（`isDraggableEvent`。宿泊・時間未定は「予約内容を編集」から）。スマホ・タブレット（タッチ）ではドラッグしない
  - ブラウザ標準の Pointer Events で自作（`onEventPointerDown`。`pointerType === 'mouse'` だけ）。`DRAG_THRESHOLD_PX` = 5px 動かしてからドラッグを始める（押しただけなら予約詳細）。落とし先は `document.elementsFromPoint` で日の列（`data-cal-col` + `data-date` + `data-grid-start`）か月表示のマス（`data-cal-cell`。日だけ変えて時刻はそのまま）を探す。位置 → 時刻は純粋ロジック `moveTarget({ pointerMin, grabOffsetMin, snapMinutes })`（つかんだ位置を引いてから刻みに丸める）。刻みは `dragSnapMinutes(フォームの時間間隔)` = 10 分・20 分間隔のフォームは 10 分、それ以外は 15 分。Esc で取りやめ。落とした直後のクリックは `suppressClickRef` で止める
  - 保存中は帯を動かした先に置いて見せ（`saving`）、失敗したら元の位置に戻してトーストを出す。保存中はほかの帯を動かせない
  - **ほかの人が先に変更していたら保存しない**: `PATCH /api/reservations/{id}` の `expected_updated_at`（画面が持っている `updated_at`）が、いまの `updated_at` と違えば `409 { code: 'stale' }`（`isReservationStale`。時刻として比べる。指定が無い・読めないときは通す = 既存の呼び出しは今までどおり）。画面は読み込み直す
- **空いている所から手動予約（②-2）**: 週・日表示で空いている所を押す → ダイアログ（日付・時刻（30 分刻みの枠。変更できる）・フォーム）→ 店舗側手動予約フォームを新しいタブで開く（`/api/stores/{storeId}/forms/{formId}/manual-form?date=YYYY-MM-DD&time=HH:MM`）。部品には `forms`（`CalendarFormInfo { id, name, timeInterval, manual }`。`manual` = LINE タイプのフォーム）を渡す。手動予約できるフォームが無い店舗では押しても何も起きない。別のタブから戻ってきたとき（`focus` / `visibilitychange`。5 秒以内は読み込まない）に読み込み直す
  - 手動予約フォーム側: `BookingForm.applyManualPrefill()`（`MANUAL_MODE` のときだけ呼ぶ。カレンダー表示モードのフォームだけ）が `?date=` `?time=` を読み、その週の空き状況を取り直して日時を選んだ状態にし、お客様選択の欄の上に案内（`#manual-prefill-note`）を出す。そのフォームで選べない時間（営業時間外・時間間隔に合わない・埋まっている）なら選ばずに「選べない時間でした」と案内する。**手動予約フォームは開くたびにサーバーで作るので、保存＆デプロイは不要**
- **スタッフごとの列（②-3。日表示だけ）**: スタッフ選択を使っているフォーム（`staff_selection.enabled` でスタッフが 1 人以上）がある店舗では、日表示に「スタッフごとに表示」のチェックが出る（既定 ON。端末ごとに localStorage `reservation_calendar_staff_view`）。ON のとき、日の 1 列の代わりにスタッフごとの列で描く。**スタッフ選択を使っていない店舗ではチェックも列も出ない**（今までどおり）
  - 列は純粋ロジック `buildStaffColumns(forms)` → `StaffColumn { key, name, ids }`。**同じ名前のスタッフは 1 つの列にまとめる**（フォームごとにスタッフ ID が違うことがあるため。「更新して他のフォームにも反映」でコピーしたフォームは ID も同じ）。予約を置く列は `staffColumnKeyOf(ev, columns)` = スタッフ ID → 名前 → 「担当なし」（`STAFF_NONE_KEY`）。「担当なし」の列は、担当の決まっていない予約がその日にあるときだけ出す（`hasUnassignedEvents`）。帯（`CalendarEvent`）は `staffId` / `formId` を持つ
  - **列をまたいで落とすと担当も変わる**: `PATCH /api/reservations/{id}` に `staff_id` も付ける（日時と一緒に 1 回で保存。Google カレンダーの予定の付け替えは既存の PATCH の中）。変更先の ID は `resolveStaffIdForForm(column, その予約のフォームのスタッフ)` で引き、**その予約のフォームに居ないスタッフには変えられない**（トーストで知らせる。サーバーも 400）。「担当なし」の列には動かせない（担当を外すのは「予約内容を編集」から）。**指名料は変えない**（確認の画面にも出す）。確認の重なりの件数は、落とした先のスタッフの予約だけを数える
  - スタッフの Google カレンダーの予定: API に `staff=1` を付けたときだけ読む（`collectStaffCalendars(フォームの設定)` = スタッフ選択が ON のフォームのカレンダーを、同じものは 1 回・店舗のカレンダーと同じものは除く・`STAFF_CALENDAR_MAX` = 30 個まで → `Promise.allSettled` で並べて取得）。`staff_busy`（**スタッフ名 → 帯**。カレンダー ID = メールアドレスは返さない）と `staff_google`（`ok` / `none` / `error` = 1 つでも読めなかった）。店舗のカレンダーの予定は全員に関わるので、どのスタッフの列にも出す
  - スタッフの列の空いている所を押すと、手動予約フォームに `&staff={スタッフID}` も渡し、`applyManualPrefill()` が担当スタッフも選んだ状態にする（そのフォームに居るスタッフのときだけ。手動予約のダイアログは、そのスタッフが登録されているフォームを先に選ぶ）
  - **local でも担当スタッフの変更を保存するようにした**（以前は local の PATCH だけ `staff_id` を無視していた。Supabase と同じく、フォームのスタッフから名前を引く）
  - 部品への渡し方: `forms[].staff`（`CalendarStaffMember { id, name }[]`。スタッフ選択が OFF のフォームは空）
- Vitest: `reservation-calendar.test.ts` / `reservation-calendar-api.local.test.ts` / `reservation-manual-prefill.test.ts` / `reservation-patch-stale.local.test.ts` / `reservation-patch-staff.local.test.ts` / `store-admin-tabs.test.ts` / `admin-api-auth.test.ts`

**リッチメニュー作成（「リッチメニュー」タブ。設計: `docs/店舗管理者ページ_追加4機能_実装設計.md` の 7 章。リリース手順: `docs/リッチメニュー_リリース手順.md`。③-1 = 作成と反映、③-2 = 分割の型・スマホ枠のプレビュー・タブ切り替え、③-3 = お客様ごとの切り替え。すべて実装済み）:**
- 公式 LINE のトーク画面の下に出るメニュー（画像 + ボタン）を管理画面で作り、**全員向けのメニュー**として公式 LINE に反映する。店舗管理者ページ `/{storeId}/admin?tab=richmenu` とテナント側 店舗ページの「リッチメニュー」タブで、同じ部品 `src/components/rich-menu/RichMenuPanel.tsx`（一覧・反映・反映をやめる・削除）+ `RichMenuEditorDialog.tsx`（名前・大きさ・バーの文言・画像・ボタン）を使う
- **LINE の決まり（2026-11 に公式ドキュメントで確認）**: 画像 = JPEG / PNG・1MB まで・幅 800〜2500px・高さ 250px 以上・横 ÷ 縦 1.45 以上 / ボタン（areas）20 個まで / バーの文言 14 文字まで / メニューは 1 アカウント 1000 個まで / **作ったメニューは書き換えられず、画像の差し替えもできない** → 変えるときは作り直して差し替える。表示の優先順位は お客様ごと（API）> 全員向け（API）> 公式 LINE の管理画面で設定したもの
- 大きさは 大（2500×1686）/ 小（2500×843）の 2 つ（`RICH_MENU_SIZES`）。**画像の加工はブラウザで行う**（`RichMenuImagePicker.tsx`: `react-easy-crop` でメニューの形に切り抜く → canvas でその大きさの JPEG にし、1MB 以下になるまで画質を下げる → `/api/upload/menu-image`（`menuId = richmenu_{stamp}`）。サーバーに `sharp` は足していない）。反映のときサーバーは画像の先頭を読んで 形式・大きさ・1MB 以下 を確かめる（`readImageInfo` / `checkRichMenuImage`）
- **ボタンの範囲は「画像全体に対する割合」（0〜1）で持つ**（`RichMenuArea { id, x, y, w, h, action }`）。LINE に送るとき `areaToBounds` で実寸（px）にする（右端・下端は「開始 + 大きさ」を先に丸めてから引くので、隣り合うボタンのあいだにすき間も重なりもできない）。画面の編集は `RichMenuAreaCanvas.tsx`（何も無い所をなぞる = 作る / つかむ = 動かす / 右下の角 = 大きさ。Pointer Events。1% 刻み = `AREA_SNAP`。計算は `rectFromDrag` / `moveRect` / `resizeRect`。**離した瞬間の位置は ref でも持つ**（状態だけだと、すばやく離したとき 1 つ前の位置で確定する）。重なっている範囲は赤く見せ、保存はできない）
- ボタンの動き `RichMenuAction`（`switch` = 別のメニューに切り替える は下の「タブ切り替え」）: `form`（予約フォームを開く。**フォーム ID で持ち、反映のときに URL にする** = `resolveFormBaseUrl`。消えたフォーム・開く URL の無いフォームは反映できない）/ `uri`（https / http / tel:）/ `message`（文字を送る。予約語は一覧 `RICH_MENU_KEYWORDS` = 予約確認・予約を変更・キャンセル・空き待ち確認 から選べる）/ `none`（何もしない。LINE には送らない）
- **反映の順番**（`src/lib/line-rich-menu-service.ts` の `publishRichMenu`）: ① LINE に新しいメニューを作る（失敗したら何も変えない）→ ② 画像を送る（失敗したら ① を消す）→ ③ 全員向けにする（失敗したら ① を消す）→ ④ 記録を「反映中」にする → ⑤ 古いメニューを LINE から消す（失敗しても成功扱い）。**新しいメニューが出てから古いものを消す**（先に消すと、途中で失敗したときメニューが出ない時間ができる）。①〜③ は `publishToLine`、⑤ は `cleanupLineRichMenus`（LINE 側の名前の先頭に印 `LINE_MENU_NAME_PREFIX` = `[nas-rsv] ` を付けておき、**その印の付いた消し残りだけ**を次の反映のときに掃除する。ほかのツールで作ったメニューは消さない。**③-3 でお客様ごとのメニューを作るときは、この掃除で消さないようにすること**）
- 2 回押し対策: LINE と通信する前に、記録を `publishing` に条件付きで書き換えて確保する（`updateRichMenu(..., { onlyIfStatus, onlyIfUpdatedAt })`）。`publishing` のまま 2 分（`PUBLISHING_STALE_MS`）たてば、もう一度反映できる。失敗したら 元が反映中なら `published`（古いメニューが出たまま）/ それ以外は `failed` に戻し、理由を `last_error` に入れて画面に出す
- 状態 `status`: draft / publishing / published / failed。全員向けは 1 店舗に 1 つ（`is_default`。部分一意インデックス）。別のメニューを反映すると前のメニューは下書きに戻る。反映中のメニューを保存すると `dirty = true`（「未反映の変更あり」。保存しただけでは公式 LINE に出ない → 「もう一度反映する」）。「反映をやめる」= 全員向けの設定を外す（公式 LINE の管理画面のメニューに戻る。ほかの場所で別のメニューに変えられていたら外さない）。反映中のメニューは削除できない
- **ほかの場所で変更されたとき**: 一覧を開くと LINE のいまの全員向けメニュー（`GET /v2/bot/user/all/richmenu`。無ければ 404、ほかの場所で設定されていれば 403）を読み、記録と違えば知らせる（`detectExternalChange`）
- LINE の呼び出し `src/lib/line-rich-menu-api.ts`（例外を投げず `{ ok, status, body }` を返す。**画像の送信だけホストが `api-data.line.me`**。`RichMenuLineApi` にまとめてあり、テストでは差し替える）。エラーの文言は `describeLineRichMenuError`（401 / 403 = 「チャネルアクセストークンを確認してください」）
- 純粋ロジック `src/lib/line-rich-menu.ts`、保存 `src/lib/line-rich-menu-repository.ts`（local は `data/line_rich_menus.json`）。**local は LINE と通信せず、記録だけ更新する**
- API（`authorizeStoreAccess`）: `GET/POST /api/stores/{storeId}/rich-menus`、`PUT/DELETE .../{id}`、`POST .../{id}/publish`、`POST .../{id}/unpublish`
- **表示設定**: `admin_visible_options.rich_menu`（「店舗管理者に表示するメニュー」の「配信」の下の「リッチメニューを表示」）。**未設定は非表示**（`defaultHidden: true`。公式 LINE の全員向けメニューを差し替える機能なので、運営がチェックを入れた店舗だけに出す。タブには連動しない）。運営が開いたときは常に表示。メニューの項目 ID は `richmenu`（`buildStoreAdminNav(visibleTabs, { calendar, richMenu })`）
- マイグレーション `20261125000000_add_line_rich_menus.sql`（`line_rich_menus`。RLS ポリシー無し = service_role のみ。`rule` 列 = お客様ごとの切り替えの条件）と `20261126000000_add_line_rich_menu_links.sql`（お客様ごとの切り替えの記録）。**staging / production へは Dashboard の SQL Editor で手動適用**。未適用でも既存の機能は動く（一覧が空になり、作成すると「マイグレーションがまだ適用されていません」と出る）。**staging は LINE のチャネルが本番と別なら反映まで確認できる**（LINE への通信はこのシステムから出るだけなので、ログイン保護は関係ない）
- **分割の型（③-2）**: 編集画面の「型から作る」。`RICH_MENU_LAYOUTS`（大 = 6 分割・4 分割・上 1 + 下 3・上 1 + 下 2・左大 + 右 2・上下 2 / 小 = 3 分割・左 1/3 + 右 2/3・左 2/3 + 右 1/3 / 共通 = 2 分割・全体。公式 LINE の管理画面と同じ並び。`layoutsForSize`）。`applyRichMenuLayout(layoutId, size, いまの範囲)` が範囲を作り直し、**いまのボタンの動きは上から順に引き継ぐ**（数が減ってあふれるぶんは捨てる。動きの入ったボタンが消えるときは確認を出す = `layoutDropsActions`）。型を選んだあとも、範囲は自由に動かせる
- **スマホ枠のプレビュー（③-2）**: 編集画面の右側の「ボタンを編集 / スマホでの見え方」。`RichMenuPhonePreview.tsx`（iPhone の LINE = 幅 390px を模した枠。欄の幅に合わせて縮小。メニューバーを押すと開閉、ボタンを押すと動きを吹き出しで知らせる = 実際には何も送らない。切り替えのボタンを押すと、切り替え先の**保存済みの**メニューを見せる。近似の表示）
- **タブ切り替え（③-2。ボタンの動き `{ type: 'switch', menu_id }` = 別のメニューに切り替える）**: LINE の `richmenuswitch`。**LINE の決まり**: 切り替え先のメニューに名札（エイリアス。32 文字まで・英小文字 / 数字 / _ / -。1 アカウント 1000 個まで）を付け、ボタンにはその名札を書く。名札は**画像を入れたメニューにしか付けられない**。名札を外す API は 1 時間に 100 回まで
  - **反映は「切り替えでつながっているメニュー」をまとめて出す**: `collectSwitchGroup(反映するメニュー, 全メニュー)`（最初が反映するメニュー。`SWITCH_GROUP_MAX` = 5 個まで。切り替え先が消えていれば失敗）。つながっているときは全部のメニューに名札を付ける（戻るボタンのため）。順番は ① 全部のメニューを作って画像を入れる → ② 名札を付ける → ③ 最初のメニューを全員向けにする → ④ 記録 → ⑤ 古いメニューと名札を消す。**どこで失敗しても、作ったメニューと名札を消して終わる**（`publishToLine({ api, items })` の `rollback`）
  - **名札は反映のたびに新しく付ける**（`buildRichMenuAliasId(menuId, stamp)` = `nasrsv-{メニュー ID の先頭 12 文字}-{時刻}`）。古い名札を書き換えないので、途中で失敗しても、いま出ているメニューの切り替えは壊れない。古い名札は ⑤ で、印 `RICH_MENU_ALIAS_PREFIX` = `nasrsv-` の付いたものだけを消す（`cleanupLineRichMenus(api, { menuIds, aliasIds }, oldIds)`）
  - 記録: 全員向けのメニュー = `status: published` + `is_default: true`。切り替え先として一緒に出ているメニュー = `status: published` + `is_default: false`（一覧では「切り替え先として反映中」）。切り替え先だけの「反映をやめる」はできない（元のメニューの反映をやめる → 一緒に下書きに戻る）。切り替え先を「このメニューを最初に出す」で反映すると、そのメニューが全員向けになる
  - 削除: 反映中は不可。ほかのメニューの切り替え先になっている下書きも不可（`menusSwitchingTo`。先にそのボタンの動きを変える）
  - 検証（反映のとき）: 切り替え先が 未選択 / 自分自身 / 消えたメニュー は不可。複数のメニューを出すとき、エラーの先頭に「「メニュー名」— 」を付けて、どのメニューが原因かを知らせる
  - **実機で確かめていないこと**: お客様が切り替え先のメニューを見ている最中に反映し直すと、そのお客様は古いメニュー（消されたもの）に個別にひも付いている。LINE の文書には「消したメニューは、次にトークを開いたとき表示されなくなる」とだけあり、全員向けのメニューに戻るかは書かれていない（戻る想定で作ってある）
- **お客様ごとの切り替え（③-3）**: メニューに「だれに出すか」の条件を付けると、条件に合うお客様にだけ、全員向けのメニューの代わりにそのメニューを出す。条件は配信の「配信先の条件」と同じ形（`BroadcastAudience`）で、編集画面の「だれに出すか」→「条件に合うお客様だけ」に `AudienceEditor` を出す。保存先は `line_rich_menus.rule` = `RichMenuRule { audience, order }`（null = 全員向け / 切り替え先）
  - **LINE には「この人にはこのメニュー」と 1 人ずつ設定する**（`POST /v2/bot/richmenu/bulk/link` / `bulk/unlink`。500 人ずつ。202 = 受け付けだけで、LINE があとから反映する）。メニューは条件ごとに 1 個（人数ぶんは作らない。`RICH_MENU_RULES_MAX` = 5 個まで）。表示の優先順位は お客様ごと > 全員向け なので、全員向けのメニューと両方出しておける
  - 純粋ロジック `src/lib/line-rich-menu-rules.ts`: `planRichMenuAssignments({ menus, customers, facts, now })`（優先順位の順に `matchAudience` で見て、**最初に合ったメニュー**。LINE 未連携・ブロックされている人は対象外。**配信停止の人には出す**（メニューは配信ではない）。どの条件にも合わない人は入らない = 全員向けを見る）/ `diffRichMenuAssignments(いまの記録, あるべき設定)` → 設定する人（メニューごと）・外す人・変わらない人 / `sortRuleMenus` / `reorderRuleMenus` / `isRuleEmpty`（条件が 1 つも無いと出せない = 全員に出すなら全員向けにする）
  - **見直し** `syncRichMenuAssignments(storeId, { deadlineMs })`（`line-rich-menu-service.ts`）: 公式 LINE に出ているお客様ごとのメニュー → 顧客・予約・来店・アンケートを全件読む（`loadAudienceSource`。配信と同じ）→ あるべき設定を作る → いまの記録との差だけを LINE に送る → **送れたぶんだけ記録を更新**（途中で止まっても、次の見直しで続きから合う）。呼ばれるのは ① メニューを出す・出すのをやめる・優先順位を変える とき ② 予約が入ったとき（`POST /api/reservations`）・顧客情報を変えたとき（`PATCH /customers/{id}`）= `scheduleRichMenuSync(storeId)`（`after()` でレスポンス後。お客様ごとのメニューを出していない店舗では何もしない。10 秒待ってから）③ 1 日 1 回 = pg_cron `run_rich_menu_sync`（**本番のみ登録。マイグレーションに含めない**）→ `POST /api/cron/rich-menu-sync`（Service Role Key の Bearer。22 秒で切り上げ）④ 画面の「いま見直す」= `POST /api/stores/{storeId}/rich-menus/sync`（staging の確認用）。**アンケートの選択肢タグ・LINE の分岐で付いたタグは ③ で拾う**（その場では見直さない）
  - **記録** `line_rich_menu_links`（店舗 × LINE ユーザー ID = 1 行。`20261126000000_add_line_rich_menu_links.sql`。RLS ポリシー無し）: **このシステムが設定した人だけ**を持つ。条件に合わなくなった人の設定を外すため。タブ切り替えで LINE が自動で付けた設定は入らない = このシステムは外さない。local は `data/line_rich_menu_links.json`
  - 出す `publishRuleMenu`（`publishRichMenu` が `menu.rule` を見て振り分ける）: LINE にメニューを作って画像を入れる（`publishToLine({ ..., setDefault: false })` = 全員向けにはしない）→ 記録（`status: published` + `is_default: false` + `rule` あり）→ 見直し（作り直したときは LINE 側の ID が変わるので、いまの人を全員付け替える）→ 古いメニューを消す（付け替えが全部終わったときだけ）。出すのをやめる `stopRuleMenu`: 先に記録を下書きにする → 見直し（その人たちは次に条件が合うメニューか、全員向けに戻る）→ メニューを消す
  - **使える条件**: チャネルシークレットを登録した店舗だけ（`ruleUnavailableReason`。未登録・マイグレーション未適用のときは理由を返し、画面に出す。保存はできる）。local は制限なし
  - **全員向けの反映・反映をやめるは、お客様ごとのメニューに触らない**（下書きに戻さない・LINE から消さない = `cleanupLineRichMenus` の keep に入れる）。お客様ごとのメニューでは「別のメニューに切り替える」は使えず、切り替え先にもできない（切り替えも 1 人ずつの設定なので両立しない）。公式 LINE に出しているあいだは「全員」と「条件に合うお客様だけ」を入れ替えられない
  - 優先順位: 一覧の ↑↓（`POST /api/stores/{storeId}/rich-menus/rule-order` に `{ ids }`）。保存では変えない（新しいお客様ごとのメニューは、いちばん下）。一覧には「出す相手」と「いま N 人に設定中」（`link_counts`）を出す
- Vitest: `line-rich-menu.test.ts` / `line-rich-menu-layouts.test.ts` / `line-rich-menu-rules.test.ts` / `line-rich-menu-service.local.test.ts` / `line-rich-menu-rules-service.local.test.ts` / `store-admin-tabs.test.ts` / `admin-api-auth.test.ts`

**1 対 1 トーク（設計: `docs/店舗管理者ページ_追加4機能_実装設計.md` の 8 章。リリース手順: `docs/1対1トーク_リリース手順.md`。規約に追記する文の下書き: `docs/1対1トーク_規約追記の下書き.md`。④-1 = 受信と保存、④-2 = 画面と返信・未読バッジ、④-3 = 通知と自動削除、④-4 = 画像・定型文・対応済み、④-5 = 自動送信の表示と利用量。すべて実装済み）:**
- お客様が公式 LINE に送ったメッセージを保存し、管理画面で読んで返信する機能。**既定は OFF。運営（マスター管理者・システム管理者）が店舗ごとに ON にした店舗だけ保存する**（行が無い店舗 = OFF）。会話には体の悩みなど慎重に扱う内容が入るので、**プライバシーポリシーの公開とお客様への説明が済んだ店舗だけ ON にする**（それまでは本番のテスト用店舗だけ）
- 設定: テナント側 店舗ページ → 設定タブ → 「1 対 1 トーク」（`ChatSettingsCard.tsx`。ON / OFF・会話の保存期間 1 / 2 / 3 年 = `CHAT_RETENTION_OPTIONS`・保存している会話の件数）。API `GET/PUT /api/stores/{storeId}/chat-settings`（**`authorizeUpperAdminStoreAccess` = 運営だけ**。店舗管理者は自分の店舗でも 403。会話の中身・LINE ユーザー ID は返さない）
- **ON にできるのは、チャネルシークレットを登録した店舗だけ**（`chatEnableBlocker`。偽の通知を会話として保存しないため。local は制限なし）。確かめるのは OFF → ON のときだけ（保存期間の変更・OFF はいつでもできる）
- **受信**: Webhook が署名を確かめたあと `scheduleChatInbound(storeId, events, { verified })`（`src/lib/chat-service.ts`。`after()` で **LINE への応答を返したあと**に保存 = 予約確認などの返信を遅くしない。保存するメッセージの無い通知では何も読まない）→ `recordChatInboundEvents`（ON の店舗・**署名を確認できた通知だけ**。例外を投げない = 保存に失敗しても既存の応答は変わらない）
  - 保存する形 `toChatInbound(ev)`: 文字（5000 文字まで）/ 画像・動画・音声・ファイル・位置情報は**種類だけ**（中身は保存しない。画像の中身は ④-4 から）/ スタンプは番号だけ（`meta`）。グループ・複数人トーク・メッセージ以外の通知（友だち追加・ボタン操作）は保存しない。日時は LINE の通知の日時（届いた順ではなく送られた順に並べる）
  - **「自動」の印**（`classifyAutoMessage(text, { keywords, optKeywords })` → `form` = 1 行目が【…】で始まるフォームの送信文 / `command` = 予約確認・予約をキャンセル・予約を変更・空き待ち確認・「キャンセル: 3」・スタッフ登録・店舗の配信停止 / 再開の合言葉 / `keyword` = LINE メッセージのキーワード自動応答の合言葉）。印の付いた文は**未読に数えない**（付けないと、予約が入るたびに未読が増える）。フォームの送信文の 3 秒以内に同じ人から届いた文（2 通目の固定テキスト・選択肢ごとの追加メッセージ）は `follow_up`（`isFormFollowUp`。`CHAT_FOLLOW_UP_WINDOW_MS`）。**新しいコマンド・フォームの送信文の形を足したら、ここにも足す**
  - 保存は DB 関数 `chat_record_inbound` が 1 回で行う（会話が無ければ作る → 同じ `line_message_id` は 1 件だけ（LINE は応答が遅いと送り直す）→ 未読の加算・一覧の 1 行の更新）。local は `data/chat.json` で同じ手順（**直すときは両方**）
- データ: `chat_settings`（店舗ごとの設定）/ `chat_threads`（店舗 × LINE ユーザー ID で 1 本。顧客 ID ではまとめない = 同じ人が顧客に 2 人いても会話は分かれない。`unread_count` / `status` = open / done / `last_message_preview`）/ `chat_messages`（`direction` = in / out / system、`kind`、`auto` / `auto_kind`、`line_message_id`、返信用の `client_key` / `send_status` は ④-2 で使う）。どれも RLS ポリシー無し = service_role のみ
- 純粋ロジック `src/lib/chat.ts`、保存 `src/lib/chat-repository.ts`、業務ロジック `src/lib/chat-service.ts`
- マイグレーション `20261127000000_add_chat.sql`（④-1。表と保存の DB 関数）と `20261128000000_add_chat_notifications.sql`（④-3。`chat_settings` の `notify_*` 列、DB 関数 `chat_claim_notification` / `chat_purge_expired`。未適用でも受信・画面・返信は動き、通知の設定を保存しようとすると「マイグレーションがまだ適用されていません」と出る。自動削除は何もしない）と `20261129000000_add_chat_media.sql`（④-4。`chat_settings.reply_templates` 列と、公開しないバケツ `chat-media`。未適用でも、バケツは最初の画像を保存するときに自動で作る。定型文は保存できない）と `20261130000000_add_chat_events_usage.sql`（④-5。`chat_usage_monthly`、DB 関数 `chat_add_usage` / `chat_record_system_events`、`chat_record_inbound` の差し替え。未適用でも送信・受信は今までどおり動き、自動の記録が会話に出ない・利用量が数えられないだけ）。**staging / production へは Dashboard の SQL Editor で手動適用**。未適用でも既存の機能は動く（OFF として動き、設定カードに理由を出して ON にできない）。**staging には LINE からの通知が届かないので、受信は本番のテスト用店舗で確かめる**
- **トーク画面（④-2）**: 店舗管理者ページ `/{storeId}/admin?tab=chat` とテナント側 店舗ページの「トーク」タブで、同じ部品 `src/components/chat/ChatPanel.tsx` を使う。左 = 会話の一覧（未読が上・新しい順 = `sortChatThreads`。名前で検索・「未読」だけ）/ 中 = 会話（お客様は左・店舗は右。`auto` の文は小さく薄く「自動」）/ 右 = 顧客の情報（パソコンの広い幅だけ。既存の `GET /customers/{id}` を読む）。スマホは 一覧 → 会話 の 2 画面
  - **表示**: `admin_visible_options.chat`（「店舗管理者に表示するメニュー」の「顧客管理」の下の「トークを表示」。**未設定は非表示** = `defaultHidden`）が ON、**かつ**運営がトーク機能を ON にした店舗だけ、店舗管理者のメニューに出す（`buildStoreAdminNav(visibleTabs, { calendar, richMenu, chat })`。項目 ID は `chat`、並びは顧客管理のすぐ後ろ）。ON かどうかは店舗管理者ページが `GET .../chat/unread` で確かめる（設定の API は運営だけなので使えない）。運営が開いたときは、トーク機能が ON なら出る。テナント側 店舗ページのタブは常に出し、OFF の店舗では理由を出す
  - **未読バッジ**: メニュー（サイドバー・スマホの下部ナビ）の「トーク」に未読の合計（`StoreAdminLayout` の `chatUnread` → `data-slot="nav-badge"`）。店舗管理者ページが 30 秒おき・画面が見えているときだけ `GET .../chat/unread` を呼ぶ。トークを開いているあいだは `ChatPanel` が 15 秒おき（新着が無い間は 30 秒まで延ばす = `nextChatPollDelay`）に一覧と開いている会話の新着（`?after={最後のメッセージ ID}`）を取り、`onUnreadChange` でバッジを合わせる
  - **既読**: 会話を開いたとき（`getChatThreadDetail`。`read: false` = `?read=0` のときはしない）と、返信したとき。お客様の LINE に「既読」は付かない（LINE の仕様）
  - **返信** `sendChatReply(storeId, threadId, { text, client_key }, user)`: ① 検証（空でない・5000 文字まで・`client_key` = 画面が送信のたびに作る UUID）→ ② 「送信中」で保存（`insertChatOutbound`。`client_key` は一意 = 同じ ID は 1 回だけ）→ ③ LINE に push（`pushChatText`。10 秒で打ち切り。`X-Line-Retry-Key` = `client_key`。409 = LINE がすでに受け付けている = 成功扱い）→ ④ 送信済み / 失敗（理由 = `describeChatSendError`）を記録し、一覧の 1 行を更新して未読を 0 にする。同じ ID がもう一度届いたときは `decideResend`（送信済み = 何もしない / 送信中で 30 秒以内 = 待つ / 失敗・止まったもの = 同じ ID で送り直す）。**返信は push = 公式 LINE の通数を 1 通使う**（入力欄の下に今月の通数 = `fetchLineQuota`）。トーク機能が OFF の店舗では返信できない（保存済みの会話は読める）。local は LINE と通信せず記録だけ更新する
  - **画面側の連打対策**: `ChatPanel` の `sendLock`（ref）。画面の状態（入力欄を空にする・ボタンを無効にする）が変わる前の連打は、状態では止められない（3 回押すと別々の `client_key` で 3 通送られる不具合があった）
  - 返信したスタッフの名前（メールアドレス）は `chat_messages.meta.sent_by_name` に入れる（列は足していない）。**画面に返す形（`ChatThreadView` / `ChatMessageView`）に、LINE ユーザー ID・`client_key`・スタッフの ID を入れない**
  - **会話は必ず店舗 ID と一緒に読む**（`getChatThread(storeId, threadId)`。他の店舗の会話 ID・形のおかしい ID は null → API は 404）
  - 顧客詳細の LINE タブに「トークを開く」（`CustomerDetail` の `chatHref`。トークのタブが出ている店舗だけ）→ `?tab=chat&chatCustomer={顧客ID}` → `ChatPanel` の `initialCustomerId` がその顧客の会話を開く（会話が無ければ「まだありません」。こちらから先には送れない）
  - 文字は HTML として解釈せず、`http` / `https` で始まる所だけリンクにする（`LinkedText`）。動画・音声・ファイルは「動画が送られました」とだけ出す（中身は保存しない。画像は下の「画像（④-4）」）。スタンプは番号から LINE の公開の画像 URL を組み立てる（`stickerImageUrl`）
  - DB の変更なし（④-1 の表のまま）
- **新着の通知（④-3。任意・既定は OFF）**: 設定は「トークの新着の通知」（`src/components/chat/ChatNotificationSettings.tsx`。店舗管理者ページの設定タブ = トークのタブが出ている店舗だけ / テナント側 店舗ページの設定タブ）。`ChatNotifySettings { line, email, emails（5 件まで）, quiet: { enabled, start, end } }`（`chat_settings` の `notify_*` 列。**ON / OFF・保存期間と違い、店舗管理者も変えられる** = API は `authorizeStoreAccess`）。純粋ロジック `src/lib/chat-notify.ts`
  - 送るのは `recordChatInboundEvents` の最後（保存のあと）の `notifyChatInbound(storeId, 新しく保存できたメッセージの ID, { origin })`。**例外を投げない**（通知に失敗しても保存の結果は変えない）。同じ通知が LINE から送り直されても、もう一度は知らせない（新しく保存できたぶんだけが対象）
  - **通知しないもの**: `auto` の印が付いた文（フォームの送信文・コマンド・フォームに続く文）。印は保存のときに DB が付けることがあるので、保存したあとに `listChatThreadsToNotify` で読み直す
  - **同じ会話については 10 分に 1 回まで**（`CHAT_NOTIFY_INTERVAL_MS`）: 送る前に `claimChatNotification`（DB 関数 `chat_claim_notification` = 前の通知から 10 分たっていて未読があるときだけ `chat_threads.notified_at` を書き換えて true）で確保する = 同時に届いても二重に送らない。会話を開いて既読にしても、間隔は同じ
  - **夜間は送らない**（`isChatQuietTime`。既定 ON・22 時〜8 時。日本時間）: その時間帯は確保もしない（`notified_at` を変えない）ので、明けたあとの最初の新着のときに、たまった未読の数と一緒に知らせる。**明けた時刻に自動で送ることはしない**
  - **通知にメッセージの本文を載せない**（`buildChatNotifyLineText` / `buildChatNotifyEmail` = 「〇〇 様から新しいメッセージが届きました（未読 N 件）」+ 管理画面のリンク `/{storeId}/admin?tab=chat`）。Vitest で本文が含まれないことを検査している
  - スタッフの LINE: 「今日の予約まとめ」と同じ登録（`store_digest_staff`。合言葉で登録）の全員に、その店舗の公式 LINE から push（**通数を使う = 1 回 × スタッフの人数**）。メッセージを送ってきた本人がスタッフのときは、その人には送らない。メール: `sendEmail`（Resend。From 表示名 = 店舗名）
  - 「テストの通知を送る」= `sendChatNotifyTest`（保存済みの送り先へ。夜間・10 分に 1 回の制限は見ない。staging・本番の確認用）
- **保存期間を過ぎた会話の自動削除（④-3）**: pg_cron `run_chat_retention`（1 日 1 回。**本番のみ登録。マイグレーションに含めない**）→ `POST /api/cron/chat-retention`（Service Role Key の Bearer）→ `runChatRetention` → DB 関数 `chat_purge_expired(now, 5000)`: 店舗ごとの保存期間（`chat_settings.retention_years`。暦の年で引く = `chatRetentionCutoff`）より前のメッセージを古い順に 1 回 `CHAT_RETENTION_BATCH` = 5000 通まで消し、メッセージが無くなった古い会話は会話ごと消す。**トーク機能を OFF にした店舗の会話も、保存期間を過ぎたら消える**。local は同じ手順を JSON の中で行う（`purgeExpiredChat`。**直すときは両方**）
  - **画像を持つメッセージは、先に画像のファイルを消す**（④-4）: `runChatRetention` が `purgeExpiredChatMedia`（保存期間を過ぎた・`media_path` のあるメッセージを古い順に 200 通まで → 画像のファイルを消す → 消せたものだけ `media_path` を空にする）を先に行い、そのあと `chat_purge_expired`（`media_path` が空の行だけを消す）を呼ぶ。行を先に消すと、画像の場所が分からなくなって画像だけ残るため。画像を消せなかったメッセージは行を残し、次の日にもう一度試す
  - 保存期間を短くするとき（3 年 → 1 年など）は、設定カードが「◯ 年より前の会話は、次の自動削除で削除され、元に戻せません」と確認を出す。長くするときは確認なし
- **画像（④-4）**: サーバーに画像を加工する部品（`sharp`）は入れていない。**お客様から届いた画像は縮めずにそのまま保存する**（10MB まで = `CHAT_INBOUND_IMAGE_MAX_BYTES`。超えるものは保存しない）。置き場は `src/lib/chat-media.ts`
  - **届いた画像は公開しない**: 公開しないバケツ `chat-media`（`{storeId}/{会話ID}/{メッセージID}.{拡張子}`。ポリシー無し = service_role だけ）に置き、画面からは `GET /api/stores/{storeId}/chat/media/{messageId}`（`authorizeStoreAccess`。他の店舗のメッセージ・その店舗の置き場の外を指す記録は 404。`Cache-Control: private`）を通して読む。**公開の URL を作らない**。local は `data/chat_media/`
  - 受信: `recordChatInboundEvents` が保存・通知のあとに `storeChatInboundImage`（LINE の `api-data.line.me/v2/bot/message/{id}/content` から取得 = `fetchLineImageContent`。10 秒で打ち切り。202 / 429 / 5xx・通信エラーは 3 回まで試す、4xx は試さない）→ 保存 → `chat_messages.media_path` を入れる。取れなかったら `meta.media_error = '1'`（画面は「画像（読み込めませんでした）」）。**例外を投げない**。同じ通知の送り直しでは取りにいかない。local は LINE と通信しない
  - **店舗が送る画像**: LINE が取りに来るので公開の URL が要る。画面（`src/lib/chat-image-client.ts` の `compressChatImage` = canvas で長いほうの辺 1600px まで・1MB 以下の JPEG に縮める。LINE のプレビュー画像の上限が 1MB で、プレビューにも同じ画像を使うため）→ `POST /api/stores/{storeId}/chat/images`（`uploadChatReplyImage` = **ファイルの中身の先頭を見て** JPEG / PNG か確かめる（`readImageInfo`）・1MB まで。公開のバケツ `forms` の `chat_images/{storeId}/{推測できない 32 桁}.jpg`）→ 返信の API に `{ image_url, client_key }`
  - **返信の API は、その店舗の置き場の画像だけを送る**（`isChatOutboundImageUrl` = `chat_images/{storeId}/{32 桁}.jpg|png` の https。画面から渡された URL をそのまま LINE に送ると、どんな URL でも送れてしまうため）。送るのは `pushChatImage`（`originalContentUrl` = `previewImageUrl`）。記録は `kind: 'image'` + `media_path`（置き場の中のパス）+ `meta.image_url`。送り直しは、保存してある画像を送る
  - アップロードしただけで送らなかった画像は、置き場に残る（消す処理は無い。名前が推測できないので、外からは見つけられない）
- **自動で送ったメッセージを会話に出す（④-5）**: リマインダー・フォロー・配信・Webhook の自動の返信・空き待ちのお知らせを、**「何を送ったか」の 1 行**（`direction: 'system'`・`auto_kind: 'system'`・`meta.event` = 種類）で会話に並べる。**送った本文そのものは保存しない**。純粋ロジック `src/lib/chat-events.ts`（文の組み立て `reminderEventText` / `followEventText` / `broadcastEventText` / `waitlistEventText` / `autoReplyEventText`、`normalizeChatSystemEvent`）
  - 記録は DB 関数 `chat_record_system_events(p_store_id, p_events)`（`p_events` = `[{ line_user_id, kind, text, source_key, at }]`。配信は 500 人ぶんを 1 回で渡す）が判断する: **トーク機能が ON の店舗**で、**すでに会話のあるお客様だけ**（会話の無いお客様の会話は作らない = 配信のたびに数千人ぶんの空の会話ができないように）。**未読・一覧の 1 行・並び順・対応の状態・利用量は変えない**。同じ送信は 1 回だけ（`source_key` を `chat_messages.client_key` に入れ、返信の二重送信防止と同じ一意制約で捨てる）。local は `recordChatSystemEvents` が同じ手順を JSON の中で行う（**直すときは両方**）
  - **呼ぶ場所**（どれも送信が終わったあと。**記録に失敗しても送信の結果は変えない**）: Edge Function `send-reminders`（`reminder:{reminder_logs.id}`）/ `send-follow-messages`（`follow:{follow_messages.id}`）/ `send-broadcasts`（`broadcast:{broadcast_recipients.id}`）= 各ファイルの `recordChatEvents` が DB 関数を直接呼ぶ（**文は `chat-events.ts` と同じ形を Deno 側でも組み立てている。直すときは両方。変更したら Edge Function 3 本の再デプロイが必要**）/ 空き待ち = `waitlist-service.ts` の `sendAndLog` → `recordChatSystemEventsSafe` / Webhook の自動の返信 = 下
  - **Webhook の自動の返信**（予約確認・キャンセル・予約変更・キーワード自動応答・あいさつメッセージ・分岐の返信など）: 返信する共通の関数（`replyLineMessage` / `replyRawMessages`）が、送れた返信を `src/lib/chat-reply-log.ts`（`AsyncLocalStorage`。同時に届いた別の通知と混ざらない）に書き留め、`POST`（中身は `handleLineWebhook`）が処理の終わりに `scheduleChatAutoReplyEvents`（`after()`）で 1 回の返信 = 1 行を記録する。1 行は 1 通目の見出し（カード = `altText` / 文字 = 1 行目）+ 「を自動で返信しました」。鍵は `reply:{replyToken}:{番号}`。**Webhook に新しい返信の場所を足すときは、この 2 つの関数を通す**（直接 `fetch` すると会話に残らない）
  - 新着の通知・未読には関係しない（`direction: 'in'` だけが対象）。保存期間を過ぎれば、ほかのメッセージと一緒に消える
- **利用量の記録（④-5。有料オプションの料金を決める・請求するときの材料）**: `chat_usage_monthly`（店舗 × 月 = 日本時間の YYYY-MM で 1 行。`inbound_count` / `outbound_count` / `image_bytes`。RLS ポリシー無し）。足すのは DB 関数 `chat_add_usage`（同時に届いても数がずれない）
  - **受信** = お客様が手で書いた文・画像など（`auto` の文は数えない）。保存の DB 関数 `chat_record_inbound`（④-5 のマイグレーションで、利用量の加算を足したものに差し替え）の中で数えるので、同じ通知の送り直しでは増えない / **返信** = LINE に送れたものだけ（`sendChatReply` の成功のあと。失敗・送り直しの途中は数えない）/ **画像** = その月に保存した容量（届いた画像を保存したとき + 送る画像をアップロードしたとき）。自動で送ったメッセージの記録は数えない。**いま保存している合計の容量ではない**（自動削除で消しても減らさない）
  - 一覧: マスター管理者のページ（`/master-admin`）→「トーク利用状況」タブ（`src/components/chat/ChatUsagePanel.tsx`。月の切り替え・合計・店舗ごとの今月と前の月・CSV）。API `GET /api/master-admin/chat-usage?month=YYYY-MM&format=csv`（**マスター管理者だけ**。システム管理者・店舗管理者は 403。件数だけを返す）。出すのは、トークを一度でも ON にした店舗と、利用のある店舗（`getChatUsageReport`）。**料金の計算・請求は作っていない**
- **定型文（④-4）**: `chat_settings.reply_templates`（`[{ id, title, text }]`。30 個・名前 30 文字・文 1000 文字まで = `validateChatTemplates`）。API `GET/PUT /api/stores/{storeId}/chat/templates`（一覧をまるごと差し替える。店舗管理者も変えられる）。画面は入力欄の上の「定型文」→ 選ぶと入力欄に入る（書きかけの文があれば、その後ろに足す）。編集は `ChatTemplatesDialog.tsx`
- **会話を消す（お客様から削除を求められたとき）**: `DELETE /api/stores/{storeId}/chat/threads/{threadId}`（**`authorizeUpperAdminStoreAccess` = 運営だけ**。店舗管理者は自分の店舗でも 403）→ `deleteChatThread`: ① その会話の画像のファイルを消す（届いた画像 = 公開しないバケツ / 送った画像 = 公開のバケツ。**その店舗の置き場にあるものだけ**）→ ② 会話とメッセージの行を消す（メッセージは外部キーの CASCADE で消える）。画像を消せなかったときは、行を消さずに失敗で返す。**消すのはこのシステムに保存した分だけ**（LINE のアプリに残っているトーク・顧客の情報・利用量の数は消えない）。消したあとに同じお客様から届いたメッセージは、新しい会話として保存される。だれが・どの会話を消したかはサーバーのログに残す（中身は残さない）。画面は会話の右上のごみ箱のボタン（`ChatPanel` の `canDelete`。テナント側 店舗ページは常に出す / 店舗管理者ページは運営が開いていて「店舗管理者の見え方で確認」でないときだけ）→ 確認のダイアログ。**店舗ごとの「会話をすべて削除」は作っていない**。Vitest: `chat-delete-service.local.test.ts`
- **対応済みの切り替え（④-4）**: `PATCH /api/stores/{storeId}/chat/threads/{threadId}` に `{ status: 'open' | 'done' }`。一覧に「対応済み」のバッジ、絞り込みに「対応中」（`ChatThreadFilter` の `open`）。**お客様から自動でない新しいメッセージが届くと、保存の DB 関数が対応中に戻す**（返信しただけでは変わらない）
- Vitest: `chat.test.ts` / `chat-notify.test.ts` / `chat-service.local.test.ts` / `chat-notify-service.local.test.ts` / `chat-media-service.local.test.ts` / `chat-events.test.ts` / `chat-events-service.local.test.ts` / `chat-usage-api.test.ts` / `chat-service.test.ts` / `line-webhook-signature-route.test.ts` / `admin-api-auth.test.ts` / `store-admin-tabs.test.ts` / `store-admin-guide.test.ts`

**全予約一覧の「集計ダウンロード」（`/tenant/{slug}/admin/reservations` → 予約一覧タブ。Excel = 予約数 / キャンセル数 / アンケート回答数 / 出力条件 の 4 シート。店舗 × 月）:**
- 予約は `GET /api/reservations`、アンケート回答数は `GET /api/surveys/stats`。どちらも **ログイン必須 + 見てよい店舗だけ**（`src/lib/admin-store-scope.ts` の `getAccessibleStoreIds` = マスター: 全店舗 / システム管理者: 同じテナント / 店舗管理者: 自分の店舗。`resolveStoreScope` で `store_id` の指定を確認し、範囲外は 403。local は認証スキップ）、**`fetchAllRows` で 1000 件ずつ全件取得**（以前は 1 回の取得 = 1000 件までで、件数が欠けていた）
- 月の基準: 予約数・キャンセル数 = 予約日の月、アンケート回答数 = 回答日時の**日本時間**の月（`src/lib/survey-month-stats.ts` の `countSurveysByStoreMonth`）。ステータス・テスト用顧客の絞り込みは予約だけに効く。アンケート件数を取得できないときはダウンロードを止める（0 件のシートを出さない）
- 画面の一覧は 300 件ずつ表示（「さらに表示」）。集計は全件が対象。Vitest: `survey-month-stats.test.ts`

**流入経路の計測（予約管理 → 分析 → 「流入経路」。設計: `docs/店舗管理者ページ_追加4機能_実装設計.md` の 5 章。第 1 弾 = 発行と記録、第 2 弾 = 経路ごとの集計。どちらも実装済み）:**
- 店頭ポップ・チラシ・Instagram など、置き場所ごとに別々の URL / QR コードを発行し、どこから予約が入ったかを予約に記録する。流れ: 発行する URL `/s/{code}`（`src/app/s/[code]/route.ts`。認証なし）→ 「読まれた数」を 1 増やして予約フォームを `?src={code}` 付きで開く（LINE フォーム = `https://liff.line.me/{liffId}?src=`、Web フォーム = 公開 URL + `?src=`）→ フォームが `source_code` を付けて予約を送る → `POST /api/reservations` が**その店舗の有効な経路の合言葉か**を確かめてから予約に記録
- 既存の `reservations.source_medium`（Web フォームで開いた元サイトから自動推測する 8 種類の固定値）は別物で、そのまま残す
- **予約の保存そのものには列を足さない**: Supabase では予約を保存した**あと**に別の更新（`attachReservationSource`）で `reservations.source_code` を入れる。列・テーブルが未適用の環境でも予約の受付を止めないため（local は JSON に直接入れる）。`resolveActiveSourceCode` / `attachReservationSource` は例外を投げない。手動予約（`manual_entry`）・停止中の経路・他の店舗の経路・形のおかしい値は記録しない（予約は成功する）。「予約を変更」「メニューを変更」では経路を触らない
- **対応済みの HTML をデプロイしたフォームだけが経路を送れる**: `static_deploy.features` の `source_code`（`RESERVATION_FORM_FEATURES`）。古い HTML は `?src=` を知らず、予約は入るが経路が記録されないので、一覧に「フォームの編集画面で『更新』を押してください」と出す（`sourceFormStatus` → `ok` / `needs_deploy` / `no_url` / `missing`）
- フォーム側: `BookingForm.getSourceCode()`（`?src=` と LIFF の `liff.state` 経由の両方を読む。`getChangeReservationId` と同じ読み方）。**LIFF の初期化で URL が書き換わる前に**コンストラクタで `this.sourceCode` に取っておく。プレビュー・店舗側手動予約フォームでは読まない。合言葉の形（英小文字と数字 8 文字 = `SOURCE_CODE_PATTERN`）は TS 側と埋め込み JS で同じ規則（**直すときは両方**）
- **経路は削除しない**（過去の記録を残すため）。使わなくなったら「停止」（`active = false`）: URL は `?src=` を付けずに通常のフォームを開き、読まれた数も数えない。検索ロボット・リンクの下見・User-Agent なしのアクセスは数えない（`isBotUserAgent`）。読まれた数は DB 関数 `reservation_source_increment_click` で足す（同時に開かれても数がずれない）
- 純粋ロジック `src/lib/reservation-sources.ts`（`generateSourceCode` = 紛らわしい文字 0 o 1 l i を使わない / `pickSourceCode` / `normalizeSourceName`（40 文字まで）/ `buildSourceEntryUrl` / `appendSourceParam` / `resolveFormBaseUrl` / `resolveSourceRedirect` / `sourceFormStatus` / `validateSourceInput`。1 店舗 `SOURCE_MAX_PER_STORE` = 100 件まで）、保存 `src/lib/reservation-source-repository.ts`（local は `data/reservation_sources.json`）、業務ロジック `src/lib/reservation-source-service.ts`（作成・変更のとき、選んだフォームがその店舗のものかを確かめる）
- API（`authorizeStoreAccess`）: `GET/POST /api/stores/{storeId}/reservation-sources`、`PUT .../{id}`（名前 / 開くフォーム / 有効・停止。DELETE は無い）、`GET .../{id}/qr`（QR コードの PNG。`?download=1` で保存用）。画面 `src/components/ReservationSourcesPanel.tsx`（`ReservationAnalytics` の「流入経路」タブ。店舗管理者ページとテナント側 店舗ページで共用）
- **経路ごとの集計（第 2 弾）**: 「流入経路」タブの先頭の「経路ごとの予約」（経路が 1 つも無い店舗では出さない）。純粋ロジック `src/lib/reservation-source-stats.ts` の `computeSourceStats(reservations, sources, { dateFrom, dateTo, formId })` → `rows`（経路ごとの 予約数 = キャンセル除く / キャンセル数 / 売上 = `reservationAmount` / 読まれた数 / `total_bookings` / `booking_rate`。予約数の多い順。**停止した経路・予約 0 件の経路も残す**）+ `none`（経路なし = 合言葉が無い・一覧に無い予約）+ `summary`（`with_source` = 経路の分かる予約数）。**期間は予約日**（分析のほかのタブと同じ。上の期間チップとフォームのプルダウンを `ReservationAnalytics` から props で受け取る）、フォームは予約の `form_id` で絞り込む（絞り込んだときは、そのフォームを開く経路と、そのフォームで予約が入った経路だけを出す）。**読まれた数は累計しか持っていないので、予約率 = これまでの予約（キャンセルを含む・期間とフォームに依らない）÷ 読まれた数**（読まれた数 0 は null、100% まで。目安）。保存 `listReservationsForSourceStats`（経路のある予約 = 全期間、経路の無い予約 = 指定した期間・フォームだけを 1000 件ずつ全件。列が未適用なら空）、サーバー `getSourceStats`、API `GET /api/stores/{storeId}/reservation-sources/stats?date_from&date_to&form_id`（`authorizeStoreAccess`。件数・金額だけを返し、お客様の情報は返さない）。DB の変更なし。Vitest: `reservation-source-stats.test.ts`
- マイグレーション `20261122000000_add_reservation_sources.sql`（`reservation_sources` テーブル = RLS ポリシー無し・service_role のみ、`reservations.source_code` 列、DB 関数）。**staging / production へは Dashboard の SQL Editor で手動適用**。未適用でも予約の受付は今までどおり動く（経路の一覧が空になり、作成すると「マイグレーションがまだ適用されていません」と出る）
- Vitest: `reservation-sources.test.ts` / `reservation-sources.local.test.ts`（経路の API・`/s/{code}`・予約への記録）/ `reservation-source-static-form.test.ts`

**全店舗ランキング（全予約一覧 `/tenant/{slug}/admin/reservations` → ランキングタブ）:**
- `GET /api/stores/ranking?date_from&date_to`（マスター = 全店舗 / システム管理者 = 同テナント。店舗管理者は 403。local は認証スキップで `data/*.json`）。件数・金額だけを返す
- 純粋ロジック `src/lib/store-ranking.ts`: `computeStoreRankings(stores, reservations, surveys, customers, period)` → 店舗ごとの 予約数（キャンセル除く）/ キャンセル率 / 売上（`reservationAmount`）/ アンケート回答数（回答日時を JST 日付に）/ LINE 友だち追加率（分母 = `line_user_id` あり。期間に依らない現在値）。`rankRows(rows, metric)` が同値同順位で順位付け（null は除外、キャンセル率は低い順）。指標の定義は `RANKING_METRICS`
- UI `src/components/StoreRankingPanel.tsx`: 期間チップ（`ANALYTICS_PERIOD_OPTIONS` から期間指定を除く。既定 今月）、合計タイル、指標ごとのカード（上位 10 件 + 「すべて表示」）。予約一覧タブの「テスト店舗の非表示」の店舗はランキングから除外（`hiddenStoreIds`）。Vitest: `store-ranking.test.ts` / `store-ranking-api.local.test.ts`

**公開ページ:**
- `/home` - 公開ホームページ（Web 予約フォーム機能紹介）
- `/privacy` - プライバシーポリシー
- `/terms` - 利用規約
- `src/app/(public)/layout.tsx` - 公開ページ共通レイアウト（ヘッダー・フッター）

**店舗管理画面の表示スタイル（標準 / Material 3 Expressive 風）:**
- `src/lib/ui-style.ts` - 設定値 `'auto' | 'standard' | 'm3e'` を localStorage（`store_admin_ui_style`）に保存し、`<html data-ui="m3e">` 属性で適用。`auto` はスマホ・タブレット幅（1023px 以下）のみ M3E
- `src/app/layout.tsx` のインラインスクリプト（`UI_STYLE_INIT_SCRIPT`）が初回描画前に属性を付与（`/{storeId}/admin` のみ）。`StoreAdminLayout` がリサイズ・設定変更に追従し、離脱時に解除
- `UiStyleSettings.tsx` - 設定タブの「表示設定」カード（端末ごとの設定。DB には保存しない）
- 見た目は `src/app/globals.css` 末尾の `html[data-ui="m3e"]` ブロックのみで実現。shadcn コンポーネントに付けた `data-slot` 属性（button / card / input / select-trigger / textarea / badge / dialog-content / tabs-list / tabs-trigger / list-item / status-chip / loading / mobile-nav 等）をセレクタに使う。DOM・ロジックは変更しない
- ダイナミックカラー: `applyM3Palette(store.theme_color)` が店舗テーマカラーから M3 カラーロール（`--md-*`）を HSL 近似で生成し `<html>` のインラインスタイルに設定（無彩色・未設定時は既定のオレンジパレット）
- ローディング表示（`data-slot="loading"`）は M3E では回転させず、円がゆっくり脈打つだけ（回転は意味が分かりにくいという店舗からの要望）。`data-slot="loading"` はスピナー要素自体に付ける（文言を含む親には付けない）
- スマホ共通の基礎対策: `Input` / `Select` はスマホ 16px（iOS 自動ズーム防止）、レイアウトは `h-dvh`、アイコンボタンはスマホ 44px、`touch-action: manipulation`、下部ナビゲーション（`lg:hidden`）

**顧客管理タブのスマホ最適化（`docs/顧客管理_スマホUI最適化設計.md`）:**
- スマホ（< 768px）では外側・内側の Card を描画せず画面幅いっぱい（左右 16px）。一覧 / 分析の切替と件数を 1 行、検索は `SearchBar` + `useDebounce`、セグメント絞り込みは横スクロールのチップ列、「追加」は右下の固定ボタン、50 件超は「さらに読み込む」
- 顧客詳細・追加フォームは `src/components/customers/MobileSheet.tsx`（スマホ全画面 / PC は従来ダイアログ。固定ヘッダー + 下部固定バー。標準 / M3E 共通）。編集 / 削除はヘッダー右の「⋯」メニュー
- 共通部品: `ChipTabs.tsx`（`ChipTabsList` / `ChipFilter`）、`StatTile.tsx`（`StatTile` / `StatGrid`）、`ListSkeleton.tsx`。他タブでも流用可
- `?tab=customers&customerId=...` で顧客詳細を直接開ける
- PC 表示は従来どおり（`md:` 以上で Card・テーブル・ヘッダー右上のボタン）

**店舗管理者ページの「このページの使い方」（説明表示）:**
- 各タブ（ダッシュボード / 予約管理 / 顧客管理 / アンケート管理 / 抽選管理 / 設定）の冒頭に折りたたみの説明カード `StoreAdminGuide`（`src/components/StoreAdminGuide.tsx`、`data-slot="guide"`）を表示。初回は開いた状態、閉じると端末ごとに記憶（localStorage `store_admin_guide_open_{tab}`）
- 見出しの下の 1 行ヒントは `GuideHint`（`data-slot="guide-hint"`）。文言はすべて `src/lib/store-admin-guide.ts`（`STORE_ADMIN_GUIDES` = タブごとの intro / items / tips、`STORE_ADMIN_HINTS` = 見出し下の 1 行）で管理し、画面の見出し・ボタン名と同じ言葉を使う（Vitest で主要項目名の一致を検証）
- 店舗に URL だけを渡しても解説なしで使えるようにするのが目的。項目を追加・改名したときはここも更新する

**店舗管理者に表示するメニュー（タブ）の制御:**
- `stores.admin_visible_tabs` JSONB（`null` = すべて表示）。値は `['dashboard','reservations','customers','surveys','lotteries','walls','broadcasts','settings']` の部分集合
- テナント側 店舗ページ → 設定タブ → `StoreAdminMenuSettings.tsx` で ON/OFF（最低 1 つ必須。全選択時は `null` で保存）
- 店舗管理者ページ: `StoreAdminLayout` の `visibleTabs` でサイドバー・下部ナビをフィルタし、非表示タブへの直接アクセスは先頭の表示タブへ `router.replace`。`admin/page.tsx` も非表示タブは描画しない
- マスター管理者・システム管理者が開いた場合は常に全表示（`/api/auth/role` の判定を `isUpperAdminUser` に保持）。**同じブラウザにテナント管理者のセッションが残っていると店舗管理者ページは自動的にそのセッションで開く**ため、全表示になる。ページ上部に「〜として閲覧中」のバナーを出し、「店舗管理者の見え方で確認」（`previewAsStoreAdmin`、sessionStorage `store_admin_preview_{storeId}`）で店舗設定を適用した表示に切り替えられる
- 定義・正規化は `src/lib/store-admin-tabs.ts`（`STORE_ADMIN_TABS` / `resolveVisibleTabs()`）
- マイグレーション: `20260902000000_add_admin_visible_tabs.sql`
- **項目単位の表示**: `stores.admin_visible_options` JSONB（`reservation_forms` / `survey_forms` / `lottery_forms` = 各タブの「フォーム管理」、`customer_reservation_history` = 顧客詳細の予約履歴・来店履歴・統計情報、`customer_lottery_history` = 顧客詳細の抽選履歴、`customer_survey_history` = 顧客詳細のアンケートの回答、`calendar` = 「カレンダー」タブ（「予約管理」に連動。予約管理が非表示でも個別に表示できる）、`rich_menu` = 「リッチメニュー」タブ（**未設定は非表示**。チェックを入れた店舗だけ）、`chat` = 「トーク」タブ（**未設定は非表示**。チェックを入れ、かつ運営がトーク機能を ON にした店舗だけ）、`store_digest` = 設定タブの「今日の予約まとめ・月次レポート」の欄（「設定」に連動。隠すのは設定の欄だけで、すでに ON の送信は止めない。ダッシュボードの「月次レポートを見る」はそのまま））。**未設定キーは親タブに連動**（予約管理 OFF → 顧客詳細の予約・来店・統計も非表示、抽選管理 OFF → 抽選履歴も非表示）。明示的に true/false を保存すると連動より優先。判定は `resolveAdminVisibleOptions(tabs, options, upperAdmin)`。設定 UI は `StoreAdminMenuSettings.tsx` の各タブ配下のチェック（「連動に戻す」で未設定へ）。マイグレーション: `20260904000000_add_admin_visible_options.sql`

**公式 LINE 向け Flex Message（テナント側 店舗ページ → 「LINE メッセージ」タブ。設計: `docs/LINE Flexメッセージ_実装設計.md`）:**
- 公式 LINE 管理画面では作れない Flex Message をテンプレート（予約導線カード / メニュー・料金カルーセル / 料金表（リスト）/ 店舗紹介カード / クーポン・キャンペーン / お知らせ・営業案内 / スタッフ紹介カルーセル / ご利用の流れ。上級者は JSON 直接編集・`custom` = プルダウンの一番上）から作り、**キーワード自動応答**（Webhook。完全一致。「予約確認」「キャンセル」は予約不可、同店舗で重複不可）/ **【ご予約確認】・リマインダー・フォローへの差し込み** / **テスト送信**（LINE 連携済み顧客へ push）に使う。ボタンの URL は計測リンク `/go/{id}/{key}` に置き換えてタップ数を数える（`track_taps`）
- テーブル `line_flex_messages`（`20261110000000_add_line_flex_messages.sql`。3 階層 RLS、カウントは DB 関数 `line_flex_increment_tap` / `line_flex_increment_reply`）。**`payload` = 保存時にサーバーで組み立てた送信用メッセージ**（`{ type: 'flex', altText, contents }`）で、Webhook / Edge Function はこれをそのまま送る（Deno 側にテンプレート処理を持たない）。local は `data/line_flex_messages.json`
- 純粋ロジック `src/lib/line-flex-templates.ts`（`buildTemplateFlex` / `instrumentFlexLinks` / `validateFlexContents` / `normalizeKeywords` / `matchesKeyword` / `menuCarouselFromForm` / `storeCardFromStore`）、サーバー `src/lib/line-flex-service.ts`（`prepareLineFlexMessage` / `findLineFlexReplyForText` / `listLineFlexAttachments`）+ `line-flex-repository.ts`。UI `src/components/line-flex/`（`LineFlexPanel` / `LineFlexEditorDialog` / `FlexPreview` = iPhone の LINE トーク画面（幅 390px）を模した枠に LINE の仕様値（バブル幅・文字サイズ xxs 11〜5xl 74px・余白・ブロック既定 padding 20px・horizontal の子は flex 1・カルーセルは body が伸びて高さが揃う）で描く HTML 近似プレビュー。欄の幅に合わせて CSS zoom で縮小。**プレビューを入れるスクロール領域には `[scrollbar-gutter:stable]` を付ける**（スクロールバーが出る → 幅が狭まり縮小 → 高さが減って消える → 広がる、を繰り返してガタガタ揺れる不具合があった。画面の高さと内容の高さがちょうど境目のときに起きる）。**実機計測に合わせた値**: 画面より広いバブル（giga 386）は「画面幅 − 左右 8px」= 374px に収める / 角丸は mega 17・giga 5・それ以下 10 / 行の高さは文字サイズ × 約 1.193（`flexLineHeightPx`。1.4 ではない）/ **日本語は英数字の 92% の大きさ**（実機では日本語だけ小さく描かれる。同じ大きさで描くと太く・横に広く見える）。フォントは `src/lib/flex-preview-fonts.ts`: 日本語の範囲だけを受け持つ `FlexPreviewJP`（`size-adjust: 92%`）を先頭に置き、英数字は `-apple-system` → Inter。Apple 環境は端末のヒラギノ W3 / W6（`APPLE_JP_FONT_CSS`）、それ以外は Google Fonts の Noto Sans JP 350 / 600 の CSS を取得して `buildScaledJpFontCss` で書き換え（フォント名・太さ 400 / 700・92%・**unicode-range から ASCII を除く** = Noto の日本語の分割にも ASCII が混ざっているため）`<style>` で入れる。絵文字は閲覧している端末のものになる（実機と絵柄が違う）。実機との比較資料は `docs/フレックスメッセージプレビュー/`（mega カルーセル）と `docs/フレックスメッセージプレビュー修正2回目/`（giga）。比較は「静的に描画 → ヘッドレス Chrome で `--force-device-scale-factor=2.2308`（390px → 実機スクショの 870px）→ 画素で計測」で行った。Vitest: `flex-preview-fonts.test.ts`）。テンプレートを増やすときは 型 → `buildTemplateFlex` / `defaultTemplateData` / `LINE_FLEX_TEMPLATES` → 編集 UI の `renderTemplateFields` → **`line_flex_messages.template` の CHECK 制約（マイグレーション）** の 4 点。API `GET/POST /api/stores/{storeId}/line-messages`、`GET/PUT/DELETE .../{id}`、`POST .../{id}/test`、計測 `GET /go/{id}/{key}`。Vitest: `line-flex-templates.test.ts` / `line-flex-templates-more.test.ts` / `line-flex-service.test.ts`
- **追加のメッセージ（まとめて送る）**: 編集画面の「送る内容の並び」で、Flex 本体（`main`）に テキスト / 画像（アップロード）/ 動画（mp4 の URL + サムネイル画像必須）/ Flex（JSON 貼り付け）/ 保存済みの別の LINE メッセージ（`ref`）を足し、↑↓ で自由に並べ替える（LINE の 1 回の送信上限 = **5 通**）。`line_flex_messages.message_items`（= `LineFlexMessage.items`。`main` はちょうど 1 つ）と、その順に組み立てた **`payloads`**（送信用の配列。`20261112000000_line_flex_multi_messages.sql`）。純粋ロジック `src/lib/line-flex-items.ts`（`normalizeLineFlexItems` / `validateLineFlexItems` / `buildLineFlexPayloads` / `payloadsToPreview` / `itemsToPreview`）、`prepareLineFlexMessage(..., refs)` が payloads を作る。追加 Flex の計測キーは main の続き番号（`instrumentFlexLinks(..., startKey)`。`/go/{id}/{key}` は数字のキーのまま）。`ref` は参照先の Flex 本体 1 通を展開して保存するので、参照先を保存・削除したとき `rebuildDependents` が参照元の payloads を作り直す（自分自身・無い参照先は 400）。送る側は `lineFlexSendMessages(row)`（payloads が無い旧データは `[payload]`）: キーワード応答 = 全部（最大 5）、差し込み（予約確認 / リマインダー / フォロー）= 本体と合わせて 5 通なので `LINE_FLEX_ATTACH_MAX` = 4 通まで（編集画面に警告）、テスト送信 = 全部。`FlexPreview` は `messages` prop で複数通をトーク画面に順番どおり描き（テキストは白い吹き出し、画像 / 動画はサムネイル + 再生ボタン）、カルーセルはマウスの左ドラッグで横スクロール（`DragScroll`。zoom の倍率で移動量を割る）。Vitest: `line-flex-items.test.ts` / `line-flex-service.test.ts`
- **プレビューを直接さわって編集する（ビジュアル編集）**: 編集画面の右のプレビューで、パーツをクリック → 選択（青い枠 + 小さな操作ボタン: つまみをドラッグで並び替え / ↑↓（横並びは ←→）/ 複製 / 削除）、文字はその場で書き換え（Enter = 確定、Shift + Enter = 改行、Esc = 取り消し）。プレビューの下の `FlexPartInspector.tsx` に「＋ 追加」（文字 / 画像（アップロード）/ ボタン / 区切り線 / 横並びの箱 / カード）、「元に戻す / やり直す」、選んだパーツの設定（文字・画像の差し替え・ボタンの文言とリンク先・タップ時のリンク・大きさ / 色 / 余白 / そろえ / 並べ方 / カードの大きさ）。**テンプレート連動と自由編集の両方**: 文字・画像・ボタンの文言とリンク先、一覧の 1 件（メニューのカード・行・ステップなど）の並び替え / 複製 / 削除は**テンプレートの入力値（`data`）に書き戻す**（左の入力欄も変わる）。それ以外（色・大きさなどの見た目、パーツの追加、入力項目に対応しないパーツの移動・削除）は Flex そのものを書き換えて `flex_override` に入れる = 「自由編集」（トーストで知らせる。左の入力欄は効かなくなり、「テンプレートに戻す」か「元に戻す」で戻せる）。保存形式・API・送信側は変更なし
  - 純粋ロジック `src/lib/flex-tree.ts`（パーツの場所 = パス文字列 `contents/1/body/contents/0`。`getAt` / `patchNode`（空の値はキーを消す）/ `parentInfo`（並びの中の位置と向き）/ `moveNode` / `moveNodeTo` / `removeNode`（最後のカード・唯一のブロックは消せない）/ `duplicateNode` / `addPart`（箱を選んでいればその中、並びのパーツならすぐ後ろ、それ以外はカード本文の末尾）/ `addBubble`（1 枚ならカルーセルに変える。大きさは既存に合わせ 12 枚まで）/ `newFlexPart` / `describeFlexNode`）と `src/lib/flex-template-map.ts`（`buildTemplateFieldMap(template, data)` = **テンプレートの組み立て関数に手を入れず**、入力値の文字列を目印（私用領域の文字）に差し替えて組み立て、できた Flex から「どのパーツがどの入力項目か」を逆引きする。`applyTemplateOp` が操作を `data` に書き戻し、書き戻せない操作は null → 呼び出し側が自由編集にする。`findItemRootPath` で並び替え後に選び直す）。テンプレートを増やしても対応表は自動で作られる
  - `FlexPreview` の `edit` prop（`FlexPreviewEdit`: `selected` / `onSelect` / `onTextCommit` / `onMoveTo` / `onAction`）を渡したときだけ編集できる（配信の作成画面などは従来どおり表示のみ）。編集できるのは `main: true` の Flex（`itemsToPreview` が Flex 本体に付ける）。各パーツに `data-flex-path`、選択枠と操作ボタンは `EditOverlay`（スマホ枠の中に重ねて描き、位置は 実際の位置 ÷ 縮小倍率。選んだカードが画面外なら横スクロールで見える位置へ）、文字の直接編集は `EditableText`（`contentEditable="plaintext-only"`。中身は DOM で管理）。`DragScroll` は 5px 以上動いてからスクロールを始める（クリックを中のパーツに届かせるため）。色分け（span）を持つ文字はその場では書き換えない
  - 操作 → 新しい内容 は純粋ロジック `src/lib/flex-edit.ts` の `applyFlexEdit(state, op, selected)`（① `applyTemplateOp` で入力値に書き戻す → ② だめなら flex-tree で書き換えて `flexOverride`。戻り値 `{ data? / flexOverride? / selected? / error? / typing / becameFree }`。`currentFlexContents` / `isTemplateLinked` / `validSelection`）。`LineFlexEditorDialog` の `applyEdit` と一覧の「プレビュー編集」が共通で使う。「元に戻す」は `{ template, data, flexOverride }` の履歴（最大 50。`touch()` が変更前を記録し、連続した入力は 0.8 秒以内を 1 回にまとめる。左の入力欄の変更も戻せる）。カルーセルのカードの大きさは全カードに適用。Vitest: `flex-tree.test.ts` / `flex-template-map.test.ts` / `flex-edit.test.ts`
  - **一覧の「プレビュー編集」**（旧「プレビュー」ボタン）: `LineFlexPanel` の各メッセージのカードの中に `LineFlexQuickEdit.tsx` を開く（左 = 編集できるプレビュー / 右 = `FlexPartInspector`。下に「更新」）。「更新」は `PUT /api/stores/{storeId}/line-messages/{id}` にメッセージ全体を送り、変えるのは `data` / `flex_override` だけ（名前・キーワード・送り方・並びは保存済みの値のまま）。プレビューは保存済みの payload ではなく編集中の内容（`itemsToPreview`）を描く。未保存の変更があるまま閉じる / 別のメッセージを開くときは確認を出す。ボタンごとのタップ数はその下に従来どおり表示
- **分岐（ボタンを押したら次のメッセージを返す。設計: `docs/LINEメッセージ分岐_実装設計.md`）**: 2 つの作り方がある
  - **かんたんモード = テンプレート `scenario`（分岐アンケート）**: `ScenarioEditor.tsx` で 質問 → 選択肢 → 「選んだら」（次の質問 / 結果（文章 + 予約ボタン）/ 保存済みの LINE メッセージ / 何も返さない）を上から入力する。入力値は木（`ScenarioData { root: ScenarioQuestion, color }`。選択肢 `ScenarioChoice { key, label, tags, then }`）。最初の質問のカードが Flex 本体、2 問目以降・結果は「ノード」。上限: 選択肢 6 / 深さ 5 段 / 質問 + 結果 40。純粋ロジック `src/lib/line-flex-scenario.ts`（`buildScenarioFlex` / `buildScenarioNodeFlex` / `listScenarioNodes` / `collectScenarioChoices` / `validateScenario` / `updateScenarioQuestion` / `updateScenarioResult`）。編集画面では各質問・結果の「プレビューで見る」でそのカードを右に表示（見るだけ）
  - **くわしくモード**: どのテンプレートでも、ボタンの動きを「押したら URL を開く / 押したら次のメッセージを送る」から選ぶ（共通部品 `FlexLinkField.tsx`。テンプレートのボタン欄と、プレビュー下の設定欄の両方）。値はリンク先の欄に `next:{メッセージID}?tags=タグ1,タグ2` の書き方で入る（`isFlexActionUrl` が通す）
  - **保存時**（`prepareLineFlexMessage`）: `src/lib/line-flex-branch.ts` の `instrumentFlexBranches` が、リンク先が `next:` / `choice:{選択肢のキー}` のボタンを LINE の postback ボタン（`data = lf:{メッセージID}:{キー}`。`show_choice_text` が ON なら `displayText` = ボタンの文言）に置き換え、対応表 `line_flex_messages.branches`（キー → `{ label, question, tags, next: message | node | none }`。`next:` のキーは `b1, b2…`、分岐アンケートは選択肢のキー）を作る。分岐アンケートのノードは送信用メッセージを作って `branch_payloads`（ノードのキー → payload。計測リンクのキーは本体の続き番号）に保存。次に送るメッセージが同じ店舗に無いと 400
  - **押されたとき**: Webhook が postback イベントで `handleLineFlexPostback(storeId, userId, data)` → `line_flex_answers` に 1 行記録（`recordLineFlexAnswer`。`src/lib/line-flex-answers.ts`）→ 選択肢のタグを顧客に付ける（`applyTagsToLineCustomer`。LINE ユーザー ID で顧客を検索、無ければ何もしない）→ 次（ノードの payload / 保存済みメッセージの payloads。無効・削除済みなら何も返さない）を reply（最大 5 通）。記録・タグ付けに失敗しても返信はする
  - **回答の活用**: 一覧の「プレビュー編集」を開くと `LineFlexAnswerSummary.tsx`（`GET /api/stores/{storeId}/line-messages/{id}/answers` → `summarizeBranchAnswers` = 質問ごとの人数・回数。同じ人の押し直しは 1 人）。顧客詳細の LINE タブに `CustomerLineAnswers.tsx`（`GET /api/stores/{storeId}/line-messages/answers?line_user_id=`。回答が無ければ何も出さない）。一覧には「分岐あり」バッジ
  - **トーク表示**: 編集画面 → その他 → 「分岐ボタンを押したとき、選んだ内容をお客様のトークに表示する」（`show_choice_text`。既定 ON。メッセージごと）
  - マイグレーション `20261116000000_add_line_flex_branching.sql`（template の CHECK に `scenario`、`branches` / `branch_payloads` / `show_choice_text` 列、`line_flex_answers` テーブル + RLS（読み取りのみ 3 階層））。**staging / production へは Dashboard の SQL Editor で手動適用**。未適用の環境でも、分岐を使っていないメッセージは列なしで保存する（`line-flex-repository.ts` の `isMissingBranchColumn`）。Edge Function は変更なし（差し込み・配信で送る payload は保存時に postback 入りで作られる）。local は `data/line_flex_answers.json`。Vitest: `line-flex-branch.test.ts` / `line-flex-branch-service.local.test.ts`
- **あいさつメッセージ（友だち追加されたときに送る）**: 編集画面 → 送り方 → 「あいさつメッセージ」のチェック「友だち追加されたときに送る」（`line_flex_messages.send_on_follow`。`20261117000000_add_line_flex_send_on_follow.sql`。**staging / production へは Dashboard の SQL Editor で手動適用**。未適用の環境でも、この設定を使っていないメッセージは列なしで保存する = `isMissingGreetingColumn`）。Webhook が `follow` イベント（ブロック解除を含む）で `listLineFlexGreetingMessages(storeId)`（ON の有効なメッセージを一覧の順に、追加メッセージを含めて最大 5 通。送った分は `reply_count` に数える）を reply で返す（無料）。公式 LINE 管理画面の「あいさつメッセージ」が ON だと両方届くので、編集画面に注意書きを出す。一覧には「あいさつメッセージ」バッジ。Vitest: `line-flex-service.test.ts`
- Webhook は既存コマンドの後にキーワード応答、【ご予約確認】の reply に `attach_confirm` の payloads を続ける（`replyRawMessages`。1 回の reply は 5 通まで）。Edge Function `send-reminders` / `send-follow-messages` は `loadFlexAttachments()` で店舗ごとの `payloads`（無ければ `payload`）を読んで push に追加（**変更時は Edge Function の再デプロイが必要**）
- 制限: Flex JSON 30KB / カルーセル 12 枚 / altText 400 文字 / 画像は https のみ（`/api/upload/menu-image`、`menuId = flex_{id}_{slot}`）。一斉配信は下の「配信機能」

**公式 LINE 配信機能（セグメント配信 / 自動配信。仕様: `docs/LINE配信機能_仕様書.md`、リリース手順: `docs/LINE配信機能_リリース手順.md`。PR 1 = 土台、PR 2 = 1 回配信、PR 3 = 自動配信と設定。すべて実装済み）:**
- **自動配信（ステップ配信）**: 配信タブ → 「自動配信」（`BroadcastAutomationPanel`。テンプレート 5 種から作成、ON / OFF、次の判定で送られる人数の見積り、「今日の判定を今すぐ実行」）。サーバー `src/lib/broadcast-automation-service.ts`: `prepareAutomation` / `saveAutomation` / `previewAutomation` / **`runDueAutomations(now, origin, deadline, { storeId?, ignoreTime? })`** = ON のルールのうち店舗の実行時刻（`stores.broadcast_automation_time`。JST）を過ぎて今日まだ判定していないものを処理。`claimAutomationRun`（`last_run_date` の条件付き UPDATE）で 1 日 1 回を先に確保 → `pickAutomationTargets`（きっかけ → 追加の絞り込み → 送れない人を除外 → 送信記録）→ その日の配信（`broadcasts.automation_id`、名前「【自動】…」）を 下書き → 宛先 → `broadcast_automation_sends` → `scheduled` の順で作り `send-broadcasts` に任せる。月間上限を超える日は送らず `cancelled`（一覧では「見送り」）+ 理由を残す
- **自動配信のきっかけ「いつもの来店間隔に合わせてお誘い」**（`AutomationTrigger` の `visit_cycle`。テンプレートの 6 つ目。設計: `docs/来店周期の自動配信_実装設計.md`）: 固定の「◯ 日後」ではなく、お客様ごとのいつもの来店間隔がたった頃に送る。1 日 1 回の判定（`runDueAutomations`）の中で、ほかの日数系のきっかけと同じ流れで動く。DB・API・Edge Function の変更なし
  - 純粋ロジック `src/lib/broadcast-visit-cycle.ts`: `customerVisitCycleDays(c, trigger)` = （最終来店日 − 初回来店日）÷（来店回数 − 1）を四捨五入（連続する来店の間隔の平均と同じ。`VISIT_CYCLE_MIN_DAYS` = 7 より短ければ 7、`VISIT_CYCLE_MAX_DAYS` = 365 を超える人は対象外。来店 1 回の人は `first_visit_days`、null なら対象外）/ `visitCycleDueDays` = 間隔 + `offset_days`（最短 1）/ `normalizeVisitCycleTrigger` / `describeVisitCycleTrigger`
  - ルールごとの設定: `offset_days`（−30〜30。少し前 / ちょうど / 少し後）、`first_visit_days`（来店 1 回の人の目安の日数 7〜365。null = 送らない）。marker = `cycle:{最終来店日}`（同じ来店には 1 回。次に来店するとまた対象）。送る日を過ぎてから `AUTOMATION_WINDOW_DAYS` = 14 日以内だけ
  - **これからの予約がある人には常に送らない**（`pickAutomationTargets` が `hasUpcomingReservation` で除く。そのため `selectTargets` は `visit_cycle` のとき予約を必ず読み込む）。来店記録は予約成立時に予約日の日付で作られるので、最終来店日が先の日付の人も判定から外れる
  - 編集 UI は `BroadcastAutomationPanel.tsx` の `TriggerFields`（`data-slot="visit-cycle-fields"`）。Vitest: `broadcast-visit-cycle.test.ts` / `broadcast-visit-cycle-service.local.test.ts`
- **自動配信のきっかけ「予約フォームでキャンセルが出た時」**（`AutomationTrigger` の `reservation_cancelled`。テンプレートの 7 つ目）: お客様が公式 LINE で予約をキャンセルして枠が空いたら、**キャンセルした本人以外**へ「空きが出ました」のカード（日付と時間 + 予約フォームを開くボタン）を一斉に送る。ほかのきっかけと違い **1 日 1 回の判定ではなくキャンセルのその場で動く**（`isEventTrigger` = `runDueAutomations` は扱わない）。通数を多く使う（キャンセル 1 回 = 対象人数ぶん）
  - 純粋ロジック `src/lib/broadcast-cancel-opening.ts`: `CANCEL_OPENING_DEFAULT_TRIGGER` / `normalizeCancelOpeningTrigger` / **`checkCancelOpeningRule(trigger, { source, slotStartMs, now, sentToday })`**（送らない理由 `source` / `past` / `too_close` / `quiet` / `daily_limit`）/ `buildCancelOpeningFlex(card, { storeName, date, time, bookingUrl })` / `pickCancelOpeningTargets`（LINE 連携済み・配信停止でない・ブロックされていない・追加の絞り込みに合う人 − キャンセルした本人。marker = `cancel:{予約ID}`。同じ LINE ユーザーには 1 回）
  - ルールごとの設定: `only_if_open`（本当に空いた時だけ。空き待ちと同じ `evaluateWaitlistSlot` で、キャンセル後のカレンダーを見て判定。既定 ON）/ `min_hours_before`（予約の N 時間前より後のキャンセルは送らない。既定 3）/ `quiet_hours`（夜間のキャンセルは送らない。既定 ON・22〜8 時。**朝にまとめて送ることはしない**）/ `max_per_day`（1 日の回数の上限。既定 3。その日に作った配信（見送りを除く）を数える）/ `include_store_cancel`（店舗が管理画面でキャンセルした時も送る。既定 OFF）/ `card: { title, text, button_label }`（`{日時}` `{店名}` を差し込める。日時の表示・先着順の注意・ボタンは常に入る）/ `resend_after_days`（空 = キャンセルのたびに全員へ。入れると同じ人にはその日数に 1 回まで）
  - サーバー `runCancelOpeningAutomations({ storeId, reservation, source, origin, now })`（`broadcast-automation-service.ts`）: ON のルールごとに 条件 → **空き待ちの人がいる枠なら送らない（空き待ちを優先）** → 空きの確認 → 対象者 → 月間上限（超えるなら `cancelled` で理由を残す）→ 配信を 下書き → 宛先 → 送信記録 → `scheduled` の順で作り `send-broadcasts` に任せる。カードは 1 通目の Flex として `rule.items` の前に足す（追加メッセージは 4 通まで。無くても ON にできる）。配信名は「【自動】ルール名（11/25（水）14:00）」。対象はカレンダー表示モードの予約フォームの予約（宿泊・時刻の無い予約は対象外）。ボタンはその予約フォームの `https://liff.line.me/{liffId}`（計測リンクになる）
  - 呼び出し `scheduleCancelOpeningBroadcast({ storeId, reservation, source, origin })`（`after()` でレスポンス後。ルールが無い店舗では何もしない。**10 秒待ってから**判定）: LINE Webhook のキャンセル（`source: 'customer'`）と `PATCH /api/reservations/{id}` のキャンセル（`source: 'store'`）。編集 UI は `BroadcastAutomationPanel.tsx` の `CancelOpeningFields`（条件）/ `CancelOpeningCardEditor`（カードの文言）。見積りは「キャンセル 1 回につき最大 N 人」。DB の変更なし（`broadcast_automations.trigger` は JSONB）。Vitest: `broadcast-cancel-opening.test.ts`
- **自動配信のきっかけ「特定の曜日に1週間の空き状況」**（`AutomationTrigger` の `weekly_availability`。テンプレートの 8 つ目）: 選んだ曜日の実行時刻（`stores.broadcast_automation_time`）に、選んだ予約フォームの「これから N 日間の空き状況」を **日付 × 時間帯（午前 = 〜12 時 / 午後 = 12〜17 時 / 夕方 = 17 時〜）の 〇△✕ の表**にしたカードで一斉に送る。1 日 1 回の判定（`runDueAutomations`）の中で動き、選んだ曜日でない日は何もしない（その日の判定も確保しない）
  - 純粋ロジック `src/lib/broadcast-weekly-availability.ts`: `WEEKLY_DEFAULT_TRIGGER` / `normalizeWeeklyAvailabilityTrigger`（曜日が 1 つも無ければ null = 保存不可）/ `isWeeklyAvailabilityDay` / `weeklyAvailabilityDates` / **`summarizeAvailability(daySlots, fewThreshold)`**（時間帯ごとに `ok` = 〇 / `few` = △（空きが few_threshold 枠以下）/ `ng` = ✕ / `none` = 受付なし。受付の無い日は `closed` = 休み。期間中に受付の無い時間帯は表に出さない）/ `hasEnoughOpenSlots` / `buildWeeklyAvailabilityFlex(card, summary, { storeName, bookingUrl, staffName })` / `sampleAvailabilitySummary`（プレビューの例）
  - ルールごとの設定: `weekdays`（送る曜日）/ `form_id`（カレンダー表示モードの予約フォーム。ON にするには必須）/ `days`（3 / 5 / 7 / 10 / 14）+ `include_today`（当日から / 翌日から）/ `duration_minutes`（「◯ 分の予約が入る空き」として数える。0 = フォームの時間間隔）/ `min_open_slots`（空きが合計この枠数以上の時だけ送る。既定 1）/ `staff_id`（スタッフ選択のフォームで、そのスタッフの空きだけ。null = 指名なしと同じ = 自動割当の対象の誰かが空いていれば空き）/ `few_threshold`（△ の枠数。既定 2）/ `card: { title, text, button_label }`（`{店名}` `{期間}`。表・凡例・「配信時点の空き状況です」の注意書き・ボタンは常に入る）。テンプレートの初期の絞り込みは `{ upcoming_reservation: false }`（これからの予約がある人には送らない）
  - サーバー `computeWeeklyAvailability(storeId, trigger, now)`（`broadcast-automation-service.ts`）: 「予約を変更」と同じ `evaluateDaySlots`（受付期間・営業時間・✕にする時間帯・祝日 + Google カレンダーの予定）で日ごとの時刻と空きを出す。スタッフ選択のフォームはスタッフごとの希望日時設定・スタッフ同時刻上限も見る。**メニュー / オプションの対応時間設定・スタッフごとのメニュー表示は見ない**。カレンダーを取得できないときは送らない（理由を返す）。local はカレンダーを見ず設定だけで判定。`runWeeklyAvailabilityRule` が 空きの集計 → 枠数の確認 → 対象者（marker = `week:{日付}`。`resend_after_days` 空 = 毎回全員）→ 月間上限 → 配信を作る。カードは 1 通目の Flex として `rule.items` の前に足す（追加メッセージは 4 通まで）
  - 編集 UI は `BroadcastAutomationPanel.tsx` の `WeeklyAvailabilityFields` / `WeeklyAvailabilityCardEditor`。見積り API（`preview: true`）が `availability`（いまの実際の空き状況）/ `availability_error` / `staff`（そのフォームで選べるスタッフ）も返し、右のプレビューは**いまの実際の空き状況**で描く（取得できないとき・フォーム未選択のときは例の表）。DB の変更なし。Vitest: `broadcast-weekly-availability.test.ts`
- **自動配信の起動は Edge Function ではなく Next.js の API**: pg_cron `run_broadcast_automations`（毎時 2 分。**本番のみ登録**）→ `POST /api/cron/broadcast-automations`（`Authorization: Bearer <service_role>` を `SUPABASE_SERVICE_ROLE_KEY` と timing-safe 比較。local は認証なし。22 秒で切り上げ、残りは次の回）。**staging の Vercel はログイン保護（Deployment Protection）で cron から呼べない**ので、staging は `POST /api/stores/{storeId}/broadcast-automations/run`（画面の「今日の判定を今すぐ実行」）で確認する
- **配信の設定**: 配信タブ → 「設定」（`BroadcastSettingsCard`）。`GET/PUT /api/stores/{storeId}/broadcast-settings`（`saveBroadcastSettings` = キーワードの重複・予約語・LINE メッセージの自動応答キーワードとの衝突・時刻 HH:00・上限を検証。`fetchLineQuota` = LINE の `/v2/bot/message/quota` + `/quota/consumption`。取得できなければ `line_quota: null`）。自動配信 API: `GET/POST /api/stores/{storeId}/broadcast-automations`（POST に `preview: true` で人数だけ返す）、`PUT/DELETE .../{id}`、`POST .../run`
- **「配信」タブ**（`StoreAdminTabId` = `broadcasts`。店舗管理者ページ `/{storeId}/admin?tab=broadcasts` とテナント側 店舗ページの「LINE メッセージ」の右）。`src/components/broadcast/`: `BroadcastPanel`（今月の通数・一覧・宛先と結果・スタンプ素材）/ `BroadcastEditorDialog`（① 配信先 ② メッセージ ③ 送るタイミング + スマホ枠プレビュー + 送信前の確認）/ `AudienceEditor`（「条件を追加」のチップ。条件を変えるたびに 0.5 秒待って人数を見積り）/ `BroadcastItemsEditor`。条件の選択肢は既存 API（`/customers/tags`・`/forms`・`/surveys`・`/line-messages`）から `src/lib/broadcast-options.ts`（`menuNamesFromForms` / `formOptionsFromForms` / `surveyChoicesFromForms`）で作る
- **流れ**: 下書き（`draft`）を保存 → 「今すぐ送る / 予約する」で `scheduleBroadcast()` が **対象者（`broadcast_recipients`）と送信用メッセージを確定**し `scheduled` に → Edge Function `send-broadcasts` が送って `sent` / `failed`。編集できるのは下書きだけ。予約の取り消し = 下書きに戻す（`cancelBroadcast`。送信開始後は不可）。サーバーは `src/lib/broadcast-service.ts`（`prepareBroadcast` / `estimateAudience` / `scheduleBroadcast` / `cancelBroadcast` / `duplicateBroadcast` / `testSendBroadcast` / `getBroadcastOverview` / `triggerBroadcastSender` = 今すぐ送るとき Edge Function を直接起こす）
- **API**（すべて `authorizeStoreAccess`）: `GET/POST /api/stores/{storeId}/broadcasts`（一覧 + overview）、`GET/PUT/DELETE .../broadcasts/{id}`、`POST .../broadcasts/estimate`（`{ audience, list? }`）、`POST .../broadcasts/{id}/schedule`（`{ scheduled_at?, confirmed?, double_confirmed? }`。409 + `code`: `over_limit` / `needs_confirm` / `needs_double_confirm`）、`.../cancel`、`.../duplicate`、`.../test`、`GET .../recipients`、`GET/POST/DELETE /api/stores/{storeId}/broadcast-stickers`、計測 `GET /go/b/{broadcastId}/{key}`
- **Edge Function `supabase/functions/send-broadcasts`**（pg_cron `send_broadcasts` 5 分おき。**cron はマイグレーションに含めず Dashboard から登録**）: 配信を `claimed_at` で確保 → pending の宛先を 500 人ずつ。差し込み無し = multicast（`X-Line-Retry-Key` = バッチ先頭の宛先行 ID。409 は送信済み扱い）、`{name}` あり = 1 人ずつ push（10 並列）。401 / 403 は配信全体を failed、429 / 5xx は pending のまま次の回、6 時間で打ち切り。`{name}` の置き換えは `personalizePayloads` と同じ規則を Deno 側にも持つ（**直すときは両方**）
- **配信の成果（配信 → 予約数・売上。設計: `docs/配信の成果_実装設計.md`）**: 配信一覧の送信済みの配信に「成果（7 日以内）タップした人の予約 N 件・¥N ／ 受け取った人の予約 N 件・¥N」を出す。期間は一覧の上のチップで 3 / 7 / 14 日を切り替え（`RESULT_WINDOW_OPTIONS`。既定 7）。「宛先と結果」に予約した人の一覧（タップ経由のバッジ）と、宛先ごとの「タップ 日時」
  - 数え方（純粋ロジック `src/lib/broadcast-results.ts` の `computeBroadcastResult(recipients, reservations, { days, tracked, now })`）: 送信済みの宛先ごとに、その人への送信時刻 〜 N 日以内に**受け付けた**（`reservations.created_at`）予約。キャンセルは除く。紐付けは 顧客 ID → LINE ユーザー ID。売上は `reservationAmount`。「タップした人の予約」= タップ（`tapped_at`）より後に受け付けた予約。同じ予約が 2 つの配信の期間に入れば両方に数える。集計は保存せず開いたときに計算する
  - **誰がタップしたかの記録**: `buildBroadcastPayloads` が計測 ON のとき、このアプリの計測リンク（`/go/b/{配信ID}/{key}` と、`ref` の `/go/{メッセージID}/{key}`）の末尾に宛先の印 `?r=__RID__` を付ける（`tagRecipientLinks`）。Edge Function `send-broadcasts` が送信時に宛先の行 ID（`broadcast_recipients.id`）へ置き換える（`fillRecipientLinks`。**TS 版と Deno 版は同じ規則。直すときは両方**）。**印のある配信は multicast ではなく 1 人ずつ push**（`{name}` の差し込みと同じ経路。20 並列）。計測リンク（`/go/b/…` / `/go/…`）は `?r=` があれば `recordBroadcastTap` → DB 関数 `broadcast_record_tap` で `broadcast_recipients.tapped_at`（最初のタップ）/ `tap_count` を更新。テスト送信は印を外す（`fillRecipientLinks(payloads, null)`）
  - `tracked = false`（`payloadsHaveRecipientLinks(payloads)` が false = この機能より前の配信・計測 OFF・ボタンなし）の配信は「受け取った人の予約」だけを出す
  - サーバー `src/lib/broadcast-results-service.ts`（`getBroadcastResultSummaries` = 送信が始まった配信の新しい順 30 件 / `getBroadcastResultDetail`）。API `GET /api/stores/{storeId}/broadcasts/results?days=`、`GET .../broadcasts/{id}/results?days=`（LINE ユーザー ID は返さない）。マイグレーション `20261119000000_add_broadcast_recipient_taps.sql`（**staging / production へは Dashboard の SQL Editor で手動適用**。未適用でも配信・タップ数は動き、タップした人の予約が 0 件になるだけ）。**リリース時は Edge Function `send-broadcasts` の再デプロイが必要**。Vitest: `broadcast-results.test.ts` / `broadcast-results-service.local.test.ts` / `broadcast-items.test.ts`
- **最初から入っているスタンプ（配信タブ → スタンプ・素材。全店舗共通の 110 個）**: 定義は `src/lib/broadcast-builtin-stickers.ts` の `BUILTIN_STICKERS`（`{ file, label, genre }`。ジャンル `STICKER_GENRES` = あいさつ / お知らせ / 季節・お祝い + 業種別 10 ジャンル × 10 個 = エステ・美容サロン / 害虫・害獣駆除 / 整体・整骨院 / かわいい / 美容室・ヘアサロン / ネイル・まつげ / 飲食店・カフェ / 旅館・宿泊 / ジム・ヨガ / ペットサロン・トリミング。絵のプロンプト・文字の一覧・**どのジャンルまで作ったか**は `docs/配信スタンプ_ジャンル別プロンプト集.md`。効果を約束する言葉は使わず、害虫は本物そっくりに描かない）。画像は `public/broadcast-stickers/{file}.png`（送信用 800px）と `{file}_s.png`（一覧用 320px）。**DB には入れない**（ID は `builtin:{file}` で固定。下書きがこの ID を持つのでファイル名は変えない）。`listBroadcastStickers()` が 最初から入っているスタンプ → DB の共通分 → 店舗の画像 の順で返す。URL はサイト内のパスなので、送信用メッセージを作るとき `resolveStickerUrl(url, origin)` が https の絶対 URL にする（`buildBroadcastPayloads`。**staging はログイン保護で LINE が画像を取りに来られない**ので、実機に届く画像の確認は本番で）。ジャンルの切り替えは `StickerFilterChips.tsx`（一覧と、メッセージの「＋ スタンプ」の選択欄で共通。`stickerFilterOptions` / `matchesStickerFilter`。店舗の画像は「店舗で追加」）。絵はオリジナルの白いねこのキャラクター（Codex の画像生成で文字なしの絵を作り、文字は Zen Maru Gothic（SIL OFL）で `sharp` を使って合成）。増やすときは画像 2 枚を置いて `BUILTIN_STICKERS` に 1 行足す。Vitest: `broadcast-builtin-stickers.test.ts`
- **友だち登録だけの人にも配信する**（`src/lib/line-friend-customers.ts`）: 予約もアンケートもしていない LINE 友だちを、LINE の表示名で顧客として自動登録する（`customers.line_friend_only = true`。`20261114000000_add_customer_line_friend_only.sql`）。タイミングは Webhook の `follow` / `message` / `postback`（`ensureFriendCustomer`。失敗しても Webhook は続行）と、配信タブ → 設定 → 「友だちを取り込む」（`POST /api/stores/{storeId}/line-friends/import` → `importLineFriends` = followers 一覧。**認証済みアカウントのみ**、未認証は 403 → 案内文。22 秒で切り上げ `remaining: true`）。予約すると `promoteFriendOnlyPatch` が印を外して名前・電話を予約時の値に（`POST /api/reservations` の顧客更新 2 か所）。**顧客一覧（`GET /customers` は既定で除外、`?include_friends=1` で含める。一覧の「LINE 友だちのみも表示」のチェックは端末ごと・店舗ごとに覚える = localStorage `customer_list_show_friends_{storeId}`、`src/lib/customer-list-prefs.ts`。`friend_only_count` を返す。列未適用なら絞り込みなしで取り直す）・顧客分析・全店舗ランキングの友だち追加率からは除外**し、配信先の判定・自動配信には含める。一意制約 `unique_customers_store_line_user`（store_id + line_user_id）があるので二重登録はされない。Vitest: `line-friend-customers.test.ts` / `customers-friend-only.local.test.ts`
- **配信の作成ダイアログの注意点**（`BroadcastEditorDialog`）: 初期化は**開いたときだけ**行う（`wasOpen` ref）。開いている間に `initial` が変わっても初期化しない（「今すぐ送る / 予約する」の前に自動保存 → 親が保存後の配信を渡し直す → ここで初期化すると送信前の確認が閉じ、「日時を指定」が「今すぐ送る」に戻る不具合があった）。確認を開く前に `fetchEstimate()` で人数を取り直す（計算が終わる前に押しても確認が出るように。ボタンは「確認中…」）。内容・タイミングを変えたら確認は閉じる。**送信日時は 5 分刻み**（日付 + 時 + 分のプルダウン。`src/lib/broadcast-schedule.ts` の `SCHEDULE_MINUTE_OPTIONS` / `roundUpToScheduleStep` / `composeLocalScheduleValue` / `defaultScheduleValue`。cron `send_broadcasts` が 5 分おきのため）。Vitest: `broadcast-schedule.test.ts`
- **友だち状態の扱い（配信先から外すのはブロックの通知が来た人だけ）**: `customers.line_friend_flag` は「友だち追加が予約より先だった」「フォームで取得できなかった」だけでも false のままになるので、**false / null は「未確認」として配信先に含める**（友だちなのに 0 人になる不具合があった）。外すのは `customers.line_blocked_at`（`20261115000000_add_customer_line_blocked_at.sql`。Webhook の `unfollow` で入れ、`follow` / 発言で消す）がある人だけ（`isLineBlocked`）。`ensureFriendCustomer` は既存の顧客が発言・操作してきたら友だちに直す。`scheduleBroadcast` は未確認の宛先を LINE のプロフィール取得で確認（`verifyLineFriends`。成功 = 友だち → `updateLineFriendStatus(true)` / 404 = 友だちでない → `line_blocked_at` を入れて宛先から外す。10 秒で打ち切り、残りはそのまま送る。local は確認しない）。見積りは `unverified`（未確認の人数）を返す。自動配信は確認せずに送る
- **配信停止**: LINE Webhook が既存コマンドより先に `handleBroadcastOptCommand()`（`src/lib/broadcast-opt-out.ts`。20 文字以内の発言だけ設定を読み、失敗時は素通し）で「配信停止」「配信再開」を処理し `customers.line_opt_out_at` を更新。顧客詳細の LINE タブに「お知らせの配信」の表示と切替（`PATCH /customers/{id}` に `line_opt_out: boolean`）。このキーワードは LINE メッセージのキーワード自動応答に登録できない（`reservedKeywordsFor`）。予約確認・リマインダー・フォローは止めない
- 型 `src/types/broadcast.ts`（`BroadcastAudience` = 配信先の条件 / `BroadcastItem` = LINE メッセージの並びから `main` を除き `sticker` を足したもの / `Broadcast` / `BroadcastRecipient` / `AutomationTrigger` / `BroadcastSettings`）
- 純粋ロジック（Vitest）:
  - `src/lib/broadcast-audience.ts`: `normalizeAudience` / `buildCustomerFacts`（予約 = customer_id → line_user_id で紐付け・キャンセル除く、来店、アンケート = line_user_id）/ `matchAudience`（種類の違う条件は AND。タグだけ any / all。メニューは「メニュー」「メニュー > サブメニュー」「カテゴリー > メニュー」の表示名で照合）/ `selectAudience`（LINE 未連携・配信停止 `line_opt_out_at`・ブロック中 `line_friend_flag = false` を除外して数える。同じ LINE ユーザーは 1 人）/ `segmentOf`（`determineCustomerSegment` と同じ規則の now 指定版）/ `describeAudience`。日付は JST の暦日（`jstDateOf` / `toJstDate` / `daysBetween`）
  - `src/lib/broadcast-items.ts`: `normalizeBroadcastItems` / `validateBroadcastItems`（`validateLineFlexItem` を再利用）/ `buildBroadcastPayloads`（`ref` は保存済み LINE メッセージの送信用メッセージを展開、`sticker` は画像メッセージ、追加 Flex の計測リンクは `/go/b/{broadcastId}/{key}`、展開後 5 通を超えたらエラー）/ 差し込み `{name}`（テキストメッセージのみ。`payloadsHavePersonalization` / `personalizePayloads` / `resolveRecipientName` = 顧客名 → LINE 表示名 → 「お客様」）
  - `src/lib/broadcast-quota.ts`: `jstMonthRange` / `evaluateQuota`（月間上限。1 人 = 1 通）/ `canSendBroadcast`（上限超過 = block は不可・confirm は確認、100 人超は 2 段階確認）/ `buildSendSummary` / `normalizeBroadcastSettings` / `matchOptKeyword`（配信停止 / 配信再開）
  - `src/lib/broadcast-automation.ts`: `AUTOMATION_TEMPLATES`（休眠 / 誕生月 / 初回来店 N 日後 / 来店 N 回目 / タグ）/ `evaluateAutomationTrigger` → marker（`dormant:{最終来店日}` など。送信記録は ルール × 顧客 × marker で一意）/ 日数系は到達から `AUTOMATION_WINDOW_DAYS` = 14 日以内だけ（ON にした日の一斉送信を防ぐ）/ `isAutomationSendAllowed` / `isAutomationTimeReached`
- サーバー `src/lib/broadcast-repository.ts`（local は `data/broadcast_data.json` + 既存の `data/*.json`）: 配信 / 宛先（`replaceBroadcastRecipients`）/ `countMonthlySent` / 自動配信 / スタンプ / 店舗設定（`stores.broadcast_*`）/ `loadAudienceSource`（顧客・予約・来店・アンケートを 1000 件ずつ全件）/ `setLineOptOut`
- マイグレーション `20261113000000_add_broadcasts.sql`: `broadcasts` / `broadcast_recipients` / `broadcast_automations` / `broadcast_automation_sends` / `broadcast_stickers`、`stores.broadcast_monthly_limit` / `broadcast_over_limit` / `broadcast_opt_out_keyword` / `broadcast_opt_in_keyword` / `broadcast_automation_time`、`customers.line_opt_out_at`、DB 関数 `broadcast_increment_tap`。**staging / production へは Dashboard の SQL Editor で手動適用**
- Vitest: `broadcast-audience.test.ts` / `broadcast-items.test.ts` / `broadcast-quota-automation.test.ts` / `broadcast-repository.local.test.ts` / `broadcast-service.local.test.ts` / `broadcast-automation-service.local.test.ts`

**朝の「今日の予約まとめ」・月次レポート（店舗スタッフへメール / LINE で自動送信。設計: `docs/朝のまとめ・月次レポート_実装設計.md`、リリース手順: `docs/朝のまとめ・月次レポート_リリース手順.md`）:**
- 設定は店舗管理者ページの設定タブとテナント側 店舗ページの設定タブの `StoreDigestSettings.tsx`（同じカード。**既定はすべて OFF**）。`DigestSettings { morning: { enabled, time（HH:00。5〜12 時。JST） }, monthly: { enabled }, channels: { email, line }, emails（5 件まで） }`。ON にするには送り先が必要（`validateDigestSettings`）
- **朝のまとめ**（`buildMorningDigest`）: 今日の予約（キャンセル除く。時刻順）の 時刻・お名前・メニュー・担当、未確認の申し送り（`pickPendingNextVisitNote`）、しるし（新規 = 台帳に無い / 来店 1 回、VIP = 5 万円以上 or 10 回以上、誕生月）、今日の日時への空き待ちの件数。**アレルギー・既往歴は中身を載せず「注意あり」とだけ出す**（要配慮個人情報。Vitest で本文に含まれないことを検査）。**予約が 0 件の日は送らない**（記録は `skipped`）。LINE は Flex 1 通（15 件まで + 「ほか N 件」）、メールは全件
- **月次レポート**（`computeMonthlyReport(all, month, broadcasts)`）: 予約日がその月の予約（キャンセル除く。`computeReservationAnalytics` / `reservationAmount`）の 予約数・売上・1 件あたり・新規のお客様（その月より前に予約が無い人。顧客 ID → LINE ユーザー ID → 電話番号で特定）・リピート率・キャンセル率・前月比・人気メニュー上位 5・配信の成果（その月に送った配信ごとの送信後 7 日以内の予約 = `computeBroadcastResult` の合計）。集計は保存せず毎回計算する。毎月 1 日（取りこぼし用に 3 日まで）に前月分を送る（`monthlyReportTargetMonth`）
- **月次レポートの画面**: `MonthlyReportView.tsx`。`/{storeId}/admin?tab=dashboard&report=YYYY-MM`（`report` が空 = 先月）。ダッシュボードの「月次レポートを見る」とメール・LINE のリンクから開く（未ログインでもログイン後にそのまま開く）。月の切り替え（最初の予約の月 〜 今月。`listReportMonths`）。API `GET /api/stores/{storeId}/reports/monthly?month=`
- **LINE のスタッフ登録（合言葉）**: 設定カードに出る 4 桁の合言葉（店舗ごと。初めて開いたときに作る）を付けて、スタッフが公式 LINE に「スタッフ登録 4821」と送る → Webhook が `handleStaffLineCommand`（配信停止より先。失敗しても他の応答は止めない）で `store_digest_staff` に登録（10 人まで。表示名は LINE のプロフィール）。「スタッフ登録解除」/ 設定カードの「解除」で解除。**合言葉を 5 回間違えると無効**（`recordStaffCodeFailure` → `staff_code = NULL`。「合言葉を出し直す」= `reissueStaffCode` で戻す）。「スタッフ登録」「スタッフ登録解除」は LINE メッセージのキーワード自動応答・配信停止キーワードに登録できない（`RESERVED_KEYWORDS` / `SYSTEM_KEYWORDS`）。画面・API に LINE ユーザー ID は返さない。LINE で送ると公式 LINE の通数を使う（1 回 × スタッフの人数）
- **送信** `runDueDigests(now, origin, deadline)`（`src/lib/store-digest-service.ts`）: ON の店舗のうち送る時刻を過ぎて `DIGEST_LATE_HOURS` = 3 時間以内（`isDigestTimeDue`）の店舗について、`claimDigestLog(store, kind, 対象日 / 対象月)`（`store_digest_logs` の一意制約）で**送る前に行を確保**してから送る = 回が重なっても 1 回だけ。メールは `sendEmail`（Resend）、LINE は `pushLineMessages`。1 件でも届けば `sent`、全滅は `failed`（理由を `detail` に）。起動は pg_cron `run_store_digest`（毎時 0 分。**本番のみ登録。マイグレーションに含めない**）→ `POST /api/cron/store-digest`（Service Role Key の Bearer。22 秒で切り上げ）。**staging は設定カードの「テスト送信」**（`POST /api/stores/{storeId}/digest/test`。記録に残さず、予約 0 件でも送る）で確認する
- API（すべて `authorizeStoreAccess`）: `GET/PUT /api/stores/{storeId}/digest`（設定 + 合言葉 + スタッフ + 最近の送信 10 件）、`POST .../digest/staff-code`、`DELETE .../digest/staff/{staffId}`、`POST .../digest/test`
- 純粋ロジック `src/lib/store-digest.ts`、保存 `src/lib/store-digest-repository.ts`（local は `data/store_digest.json`）。マイグレーション `20261120000000_add_store_digest.sql`（`store_digest_settings` / `store_digest_staff` / `store_digest_logs`。RLS ポリシー無し = service_role のみ。**staging / production へは Dashboard の SQL Editor で手動適用**。未適用でも既存の動きには影響せず、月次レポートの画面は見られる）。Vitest: `store-digest.test.ts` / `store-digest-service.local.test.ts`

**寄せ書きウォール（匿名の付箋ボード。LINE LIFF 専用）:**
- 要件定義: `docs/寄せ書きウォール_要件定義書.md`。店舗管理者ページ / テナント側 店舗ページの「寄せ書き」タブ（`walls`。抽選と設定の間）。お客様画面は Next.js ページ `/wall/{storeId}`（`src/components/wall/WallApp.tsx`。静的 HTML ではない）を店舗ごとの LIFF（`wall_boards.liff_id`）で開く
- **匿名性**: 投稿者は `author_hash` = HMAC-SHA256(店舗 ID + LINE ユーザー ID, `WALL_AUTHOR_HASH_SECRET`)（`src/lib/wall-author-hash.ts`）だけを保存。API の型（`WallPublicPost` / `WallAdminPost`）に hash・ユーザー ID を含めない（Vitest で再帰的に検査）。`wall_posts` / `wall_reports` / `wall_consents` / `wall_moderation_logs` は RLS ポリシー無し（service_role のみ）、`wall_boards` だけ 3 階層ポリシー
- 本人確認は LIFF ID トークン（`verifyLineIdToken`。local は `line_user_id` の申告を許容）。削除は本人のみ（他人の付箋は 404）。他店舗の付箋は取得・削除・通報・管理操作すべて 404
- ルール（`src/lib/wall-rules.ts`）: 本文 140 文字 / 1 人 1 店舗 1 日 N 件（`wall_boards.daily_max`、1〜10、既定 1。JST。本人削除分も数える。`20261010000000_add_wall_daily_max.sql`）/ 30 秒間隔 / 通報 3 件で `review`（ボードから外す）/ 初回投稿時に同意文 + `WALL_TERMS_VERSION` を `wall_consents` に保存（未同意は 428）。投稿の判定と挿入は DB 関数 `wall_insert_post_checked`、通報は `wall_add_report`
- 表示: 店舗設定 `moderation`（`instant` / `approval`）。NG ワード（`src/lib/wall-ng-words.ts` の共通語 + URL / メール / 電話 / @ID の形式 + 店舗の追加語）を含む付箋は `pending`（`pending_reason: 'ng_word'`）。閲覧・投稿範囲 `access_mode`（`login` / `friend_to_post` / `friend_only`）
- 店舗の操作: 公開 / 非公開のみ。非公開の理由は `terms_violation`（規約違反）だけ受け付ける（低評価を理由に消せない）。操作は `wall_moderation_logs` に記録
- 見た目はテーマ値だけで変える（`src/lib/wall-themes.ts`: プリセット cork / wood / paper / chalkboard、背景色、付箋色 3〜8、フォント、見出し・説明・例文）。付箋の色・傾き・ずれは投稿 ID から決定（`src/lib/wall-layout.ts`）。共通描画 `WallBoardView.tsx`（管理画面のプレビューでも使用）
- API: お客様 `GET /api/walls/{storeId}` / `POST .../posts` / `DELETE .../posts/{postId}` / `POST .../posts/{postId}/report`。管理 `GET/PUT /api/stores/{storeId}/wall/settings` / `GET .../wall/posts?filter=` / `PATCH .../wall/posts/{postId}`（`{ action: 'publish' }` or `{ action: 'hide', reason: 'terms_violation' }`）/ `GET .../wall/stats`（ダッシュボードの確認待ち表示）
- サーバー: `wall-service.ts`（業務ロジック）/ `wall-repository.ts`（local は `data/wall_*.json`）。マイグレーション: `20261009000000_add_wall.sql`
- **追加機能（`20261011000000_add_wall_engagement.sql`。提案書 `docs/寄せ書きウォール_追加機能提案.md` の案 1・2・3・6・7・8。新設定はすべて既定 OFF）**
  - お店からのスタンプ（案 1）: `wall_posts.reaction`（`WALL_REACTIONS` の 4 種のみ）。`PATCH .../wall/posts/{id}` に `{ action: 'react', reaction | null }`。付箋の左上に表示
  - 「わかる！」共感（案 2）: `wall_boards.empathy_enabled` / `empathy_show_count`（数を見せない = API は `empathy_count: null`）。`POST /api/walls/{storeId}/posts/{id}/empathy` で押す / 取り消す（DB 関数 `wall_toggle_empathy`。`wall_empathies` は hash のみ・ポリシー無し）。自分の付箋は不可。並び順には使わない
  - お題（案 3）: `wall_topics`（期間の重なりは保存時に拒否 = 開催中は常に 1 つ）。`GET/POST .../wall/topics`、`PUT/DELETE .../wall/topics/{id}`。お客様は「お題に答える / 自由に書く」を選び `topic_id` を送る（終了後は 400 `topic_closed`）。管理一覧は `?topic=` / `?search=`（本文の部分一致）で絞り込み
  - 色・飾りをお客様が選ぶ（案 6）: `wall_boards.customer_pick_enabled`。`note_color` は店舗の `theme.note_colors` の中から、`note_deco` は `WALL_NOTE_DECORATIONS`（8 種固定）から
  - 見どころまとめ（案 7）: `GET .../wall/insights`。純粋ロジック `src/lib/wall-insights.ts`（カタカナ / 漢字 / 英数字の 2 文字以上を含む付箋数で数える。ひらがなだけ・一般語・NG ワードは除外。外部 AI 不使用）。言葉をタップで「付箋の確認」を検索
  - 自分の付箋 / あとで読む（案 8）: `GET /api/walls/{storeId}/my-posts`（状態付き）/ `GET .../posts/lookup?ids=`（公開中だけ返す）。保存は localStorage `wall_saved_{storeId}`（サーバーには送らない）
  - UI: 管理は `WallTopicsCard.tsx` / `WallInsightsCard.tsx`、お客様は `WallApp.tsx`（お題バナー・自分の付箋・あとで読む・色と飾りの選択）、共通描画 `WallBoardView.tsx`

**抽選フォーム機能（LINE LIFF 専用）:**
- 設計書: `docs/抽選フォーム_実装設計.md`。即時抽選（その場で結果）と後日抽選（応募 → 管理画面で抽選 → 当選者へ Bot push）の 2 方式
- 型: `src/types/lottery.ts`（`LotteryConfig` / `LotteryForm` / `LotteryEntry`）。読み取り時は必ず `normalizeLotteryForm()`（`src/lib/lottery-normalizer.ts`）を通す
- 純粋ロジック: `src/lib/lottery-engine.ts`（確率判定・在庫・回数制限・引換コード・有効期限・後日抽選の当選者抽出）。DB 非依存で Vitest 対象
- 抽選の実行: `src/lib/lottery-service.ts` の `executeLotteryDraw()`。サーバー側で結果を確定し、クライアントは演出のみ。同時アクセスの在庫・回数チェックは DB 関数 `lottery_insert_entry_checked`（`src/lib/lottery-repository.ts` から RPC）
- 本人確認: LIFF の ID トークンを `src/lib/line-verify.ts` で検証。チャネル ID は `stores.line_channel_id` → 環境変数 `NEXT_PUBLIC_LINE_CHANNEL_ID` の順（local は `line_user_id` の申告を許容）
- LINE 通知: LIFF `sendMessages` 用テキストと Bot Flex 当選カードは `src/lib/lottery-line-message.ts`。push は `src/lib/line-push.ts`（はずれには送らない）
- 引換: 6 桁コード（店舗内ユニーク）+ QR 方式（`qr_token`）。管理者ページから `redeem / unredeem / cancel / restore`
- **詳細設定（賞品と確率タブ → 当選確率の合計の上、折りたたみ）** `config.advanced`（`no_lose` / `redistribute_on_sold_out`。既定 false、即時抽選のみ）
  - はずれ 0%（`no_lose`）: はずれ分は残念賞へ、残念賞が無い / 在庫切れなら残っている賞品へ比例配分。賞品 + 残念賞の在庫合計 = 抽選できる合計回数（`total_draws`。無制限の賞品があれば null）。全部尽きると `GET /stock` が `all_sold_out: true` + `closed_message` を返し、フォームは開いた時点で赤いバナー「賞品がなくなったので抽選は終了いたしました。」（`LOTTERY_CLOSED_MESSAGE`）を出して抽選ボタンを隠す。抽選 API も 410 で同じ文言。同時アクセスで在庫が尽きたら在庫を取り直して最大 3 回選び直す
  - 在庫切れ時の確率変動（`redistribute_on_sold_out`）: 在庫切れ賞品の確率を残っている賞品へ設定確率の比で上乗せ
  - 計算は `computeEffectiveOdds(config, issuedCounts)`（`changed` = 設定値から変わっている）/ 抽選は `selectPrizeEffective`（どちらかが ON のときだけ使う。OFF は従来の `selectPrize`）。`/stock` の `odds` でフォームは「現在 X%」（`applyOdds`）、編集画面は各賞品の下に「現在の当選確率」と合計回数 / 残り回数を表示（`LotteryPrizeEditor` の `advanced` / `onAdvancedChange`）
- **在庫の最新化**: 静的 HTML の「残り N」はデプロイ時の値で、公開プロキシは 1 時間キャッシュするため、フォームは開いたとき・抽選直後・再抽選前に `GET /api/lotteries/{id}/stock`（公開・件数のみ）で `stock − 発行済み` を取り直して表示を差し替える（`refreshStock()` / `applyStock()`。0 は「在庫なし」赤字）。純粋ロジックは `computePrizeStockStatus()`、サーバーは `getPrizeStockStatus()`。編集画面「賞品と確率」の在庫欄の下に「現在の残り：N（当選 M 件）」を同じ API で表示（`LotteryPrizeEditor` の `stockStatus`）
- **残り参加回数と再抽選**: 抽選結果（`LotteryDrawResponse.remaining_entries`）に `computeRemainingEntries()`（上限 − 対象期間の参加数。cancelled は数えない）を添え、即時抽選で 1 以上なら結果画面の「LINE に結果を送る」の下に「再度抽選する（あと N 回）」を出す。`my-result` の再表示も同じ値で判定（旧: `limit !== 'once'` の固定判定は廃止）
- **あなたが当選した一覧**: `GET /api/lotteries/{id}/my-entries?id_token=`（ID トークン検証）が本人の当選（賞品付きの drawn / redeemed、新しい順）を `LotteryDrawResponse[]` で返す（`getUserWinResults()`）。フォームは LIFF 認証後に取得し、賞品一覧の上のバーと結果画面のボタン「あなたが当選した一覧（N件）」からモーダル（`#winsModal`）で表示。タップで `showResult(win, { existing: true, fromList: true })` により引換コード / QR を再表示。複数回抽選で 2 回目に当選しても 1 回目の内容を確認できる
- お客様自身の「使用済みにする」: 当選画面のボタン → 確認ダイアログ → `PATCH /api/lotteries/{id}/my-result` に `{ redeem: true, entry_id }`（ID トークン検証。本人の当選で未引換・期限内のみ）→ `selfRedeemEntry()` が `redeemed` + 備考「本人操作」で更新。`presentation.allow_self_redeem`（既定 true）で店舗が無効化できる
- 管理 API は `src/lib/store-access.ts` の `authorizeStoreAccess()` で保護（local はスキップ）。ローカルデータは `data/lottery_forms.json` / `data/lottery_entries.json`
- 静的 HTML: `src/lib/static-generator-lottery.ts` の `StaticLotteryGenerator.generateHTML(form, 'production' | 'preview')`。演出はスクラッチ / ガチャ / シンプル。**スクラッチ**は全体の 4 割（`SCRATCH_REVEAL_RATIO`）が削れたら開く。削る太さ（半径）は枠の高さの 22%（最低 26px）で、前の位置から線でつないで削る（速くこすっても点々にならない）。指を離したときにも判定し、12 秒操作が無ければ自動で開く（以前は 55%・半径 22px の点で、何度もこすらないと開かなかった）。**ガチャ**は本体とハンドルが画像（`public/lottery-assets/gacha-machine.webp` / `gacha-handle.webp`。Codex の画像生成で作り、`sharp` で外側の光を落として縮小・WebP 化。パスは `GACHA_MACHINE_IMAGE` / `GACHA_HANDLE_IMAGE`。フォームは公開プロキシ経由でアプリと同じオリジンから配信されるので絶対パスで読める。読み込めないときは `.gacha.no-image` で CSS の簡易版に切り替える）。ハンドルの位置（left 49.4% / top 68.8% / width 31%）は本体画像の銀色の台座に合わせた値なので、**本体画像を差し替えたら合わせ直す**。流れは ハンドルを回す（`turning`）→ カプセルが取り出し口から転がり出る（`drop` → `ready`）→ タップで手前に来て震え（`rattle`）→ 光と星と一緒に開く（`open` + `.gacha.burst`）→ 結果。カプセルの上半分はランク色。埋め込み JS はバッククォート不使用、設定 JSON は `\u003c` エスケープで埋め込む
- デプロイ: `POST /api/lotteries/{id}/deploy` → `lotteries/{storeId}/{formId}/index.html`。プレビュー: `/preview/{storeId}/lotteries/{formId}`、`POST /api/preview/generate`（`formType: 'lottery'`）
- QR 画像: `GET /api/lotteries/qr/{token}.png`（`qrcode` パッケージ、認証なし。トークン自体が秘密）。ヘルパーは `src/lib/lottery-qr.ts`
- 賞品の画像: 「賞品と確率」タブの各賞品の「画像」は、枠か「画像を選ぶ」を押すとパソコン・スマートフォンの中の画像を選んでアップロードできる（`LotteryPrizeEditor.tsx` の `PrizeImageField`。`/api/upload/menu-image`、`menuId = lottery_prize_{賞品ID}`。「URL で指定する」で従来どおり URL も入れられる）
- 管理画面: テナント側 店舗ページの「抽選フォーム」タブ（作成・一覧・履歴）、店舗管理者ページの「抽選管理」タブ（`lotteries`）。編集は `FormEditModal` → `src/components/FormEditor/Lottery/LotteryFormEditor.tsx`（賞品は `LotteryPrizeEditor.tsx`）。一覧 `LotteryFormList.tsx`、履歴・引換 `LotteryEntryList.tsx`
- QR 引換: `/{storeId}/admin/lottery-scan`（カメラ読み取り + コード手入力）、`/r/{token}` はスキャン画面へリダイレクト
- 保存前の検証はクライアントでも使うため `src/lib/lottery-validation.ts`（純粋関数）。`lottery-service.ts` はサーバー専用（fs / Supabase に依存）なのでクライアントから import しない
- 後日抽選: `src/lib/lottery-deferred-service.ts`。応募（entered）→ 抽選実行（provisional）→ 手動修正 → 確定（drawn / lost）+ 当選者へ Bot push。仮当選はお客様には応募済みとして見せる。管理 UI は `LotteryDeferredPanel.tsx`
- マイグレーション: `20260903000000_add_lottery.sql`（テーブル・RLS・DB 関数・監査ログの form_type 追加）/ `20260903000001_add_store_line_channel_id.sql`

**店舗セットアップヘルプ:**
- `/tenant/{slug}/admin/help` - 店舗セットアップガイドページ
- `src/lib/store-setup-status.ts` - `getStoreSetupStatus()` で店舗の設定完了状態を判定
- フォームカードにセットアップ状態バッジを表示

**店舗管理者管理:**
- `/api/stores/{storeId}/admins` - 管理者一覧・追加
- `/api/stores/{storeId}/admins/{userId}` - 管理者削除
- `StoreAdminManager.tsx` - 管理者追加・削除 UI

### ID 生成パターン
- **店舗 ID**: 6文字ランダム `[a-z0-9]{6}`（新規）または UUID（レガシー互換性）
- **フォーム ID**: 12文字ランダム文字列
- **アンケート ID**: 12文字ランダム文字列
- **ローカル開発**: 店舗用に `st{timestamp}` 形式（JSON 互換性）

### 主要ファイルとその役割

**型定義:**
- `src/types/form.ts` - 予約フォーム型（`Form`、`FormConfig`）、CRM 型（`Customer`、`CustomerVisit`、`CustomerSegment`）
- `src/types/survey.ts` - アンケートフォーム型（`SurveyForm`、`SurveyConfig`）
- `src/types/store.ts` - 店舗型（`Store`、`StoreWithForms`）

**コアユーティリティ:**
- `src/lib/form-normalizer.ts` - 後方互換性正規化（全フォーム読み取りで必ず通す）
- `src/lib/env.ts` - 環境検出（`getAppEnvironment()`、`shouldSkipAuth()`、`shouldUseMockBlob()`）
- `src/lib/supabase.ts` - Supabase クライアントファクトリ（認証 vs 管理者）
- `src/lib/supabase-storage-deployer.ts` - Storage アップロード/デプロイ
- `src/lib/static-generator-reservation.ts` - 予約 HTML 生成（祝日計算 / 営業時間 / 時間間隔等）
- `src/lib/static-generator-survey.ts` - アンケート HTML 生成
- `src/lib/store-id-generator.ts` - ID 生成ロジック
- `src/lib/google-calendar.ts` - Google Calendar API 操作（`getCalendarClientForStore()` で OAuth/SA 自動切替）
- `src/lib/google-calendar-token.ts` - OAuth トークン暗号化
- `src/lib/customer-utils.ts` - CRM 顧客管理ユーティリティ
- `src/lib/auth-helper.ts` - 認証ヘルパー（`getCurrentUser()` など）
- `src/lib/store-setup-status.ts` - 店舗セットアップ状態判定
- `src/lib/email-sender.ts` - Resend ラッパ（fromName / replyTo 対応、API キー無しで安全スキップ）
- `src/lib/email-templates.ts` - お客様確認 / 店舗通知の 2 種類のメールテンプレ
- `src/lib/reservation-email.ts` - Web 予約完了時のメール送信オーケストレーション
- `src/lib/lottery-engine.ts` / `lottery-normalizer.ts` / `lottery-repository.ts` / `lottery-service.ts` / `lottery-line-message.ts` - 抽選フォーム（詳細は上記「抽選フォーム機能」）
- `src/lib/line-verify.ts` - LINE ID トークン検証 / `src/lib/line-push.ts` - Messaging API push
- `src/lib/store-access.ts` - 店舗単位の管理 API 共通認可（`authorizeStoreAccess`）

**Middleware & 認証:**
- `src/middleware.ts` - ルート保護（UI ページアクセス制御のみ）、RLS バイパスルーティング

## よくある開発ワークフロー

### 新しいフォーム機能の追加

フォーム型・normalizer・FormEditor・静的ジェネレータを編集する際は `.cursor/rules/form-feature-checklist.mdc` ルールに従う（4点更新・`normalizeForm()` 使用のみ）:

1. `src/types/form.ts` で型を更新（`FormConfig` インターフェースに追加）
2. `normalizeForm()`（`src/lib/form-normalizer.ts`）にデフォルト値を追加
3. `src/components/FormEditor/` でフォーム編集 UI を更新
4. `src/lib/static-generator-reservation.ts` または `src/lib/static-generator-survey.ts` で静的 HTML ジェネレータを更新
5. staging にデプロイする前に、ローカル（JSON モード）でテスト

### API 開発パターン
```typescript
// 例: src/app/api/stores/[storeId]/route.ts
import { getAppEnvironment } from '@/lib/env';
import { getSupabaseAdminClient } from '@/lib/supabase';

export async function GET(req, { params }) {
  const env = getAppEnvironment();

  if (env === 'local') {
    // data/stores.json から読み取り
  } else {
    // Admin Client で Supabase をクエリ
    const supabase = getSupabaseAdminClient();
  }

  // 日本語のエラーメッセージを返す
  return NextResponse.json({ error: 'エラーメッセージ' }, { status: 404 });
}
```

### フォーム編集 & デプロイフロー
1. 店舗管理者が `/{storeId}/forms/{formId}` でフォーム編集
2. 「保存」クリック → `PUT /api/forms/{formId}` で DB/JSON 更新
3. 「保存＆デプロイ」クリック → さらに `POST /api/forms/{formId}/deploy` を呼び出し
4. Deployer が HTML 生成 → Supabase Storage にアップロード → `static_deploy` フィールド更新
5. 顧客が `/api/public-form/reservations/{storeId}/{formId}/index.html` プロキシ経由でアクセス

## 重要なルールと制約

### 絶対にやってはいけないこと:
- **npm/yarn を使用しない** - 常に pnpm を使用（lockfile の整合性）
- **JSON ファイルを直接変更しない** - 常に API ルート経由
- **日本語のエラーメッセージを英語に変更しない** - ユーザー向け表示の一貫性
- **Supabase Storage パスに環境プレフィックスを追加しない** - プロジェクトはすでに分離されている
- **Vercel Blob を使用しない** - 非推奨、Supabase Storage のみ使用（`src/lib/vercel-blob-deployer.ts` に残存。実ファイル削除は今回スコープ外。`src/lib/env.ts` の `shouldUseMockBlob()` も `BLOB_READ_WRITE_TOKEN` を参照しており完全除去は未了）

### 必ずやること:
- **コミット前に `pnpm type-check` を実行**
- **任意のソースからフォームを読み取る際は `normalizeForm()` を使用**
- **PUT リクエストではフォームオブジェクト全体を渡す**（部分更新なし）
- **すべての認証済み fetch 呼び出しに `credentials: 'include'` を含める**
- **ドラフト機能実装時は draft_config と config の両方を更新**
- **Supabase 統合テストの前にローカル JSON モードでテスト**

### コード整理ポリシー:
- 1-2 リリース後に `deprecated` メソッドを削除
- `*-old.ts`、`*-preview.ts`、`new-*.ts` という名前のファイルは即座に削除（`src/lib/static-generator-old.ts.bak` が現在残存 → 削除 TODO）
- 実装後に `TODO:` コメントを更新/削除
- `normalizeForm()` のような互換性関数は無期限に保持

## Git ワークフロー

### ブランチ戦略:
- `dev` - 直接プッシュ可能、アクティブ開発
- `staging` - dev/feature/* からの PR 必須、staging 環境に自動デプロイ
- `main` - staging からのみ PR、production に自動デプロイ

### PR ベースマージ（ブランチ保護有効）:
1. `dev` または `feature/*` ブランチで作業
2. 変更をプッシュ: `git push origin dev`
3. GitHub で PR 作成: dev → staging
4. 自動チェック実行: ESLint、type-check、build
5. 承認後、マージで Vercel デプロイメントをトリガー
6. Production 用: PR を作成 staging → main

**main への force push は絶対禁止** - GitHub がブロック

## API 規約

### RESTful パターン:
- `GET /api/stores` - 店舗一覧（**運営だけ**。マスター = 全店舗 / システム管理者 = 同じテナント / 店舗管理者 = 403 / 未ログイン = 401）
- `POST /api/stores` - 店舗作成（運営だけ）
- `GET /api/stores/{storeId}` - 店舗詳細取得（**見ている人で内容が変わる**。下の「店舗情報の出し分け」）
- `PUT /api/stores/{storeId}` - 店舗更新（運営だけ）
- `DELETE /api/stores/{storeId}` - 店舗削除（運営だけ。フォームもカスケード削除）

**店舗情報の出し分け（`src/lib/store-view.ts` の `toStoreView(store, viewer)`）:**
- 店舗の行には外に出してはいけない値（`line_channel_access_token` = 公式 LINE を操作できる鍵、`google_calendar_refresh_token`）が入っているので、**`stores` を `select('*')` した結果をそのまま返さない**。以前は `GET /api/stores` / `GET・PUT・DELETE /api/stores/{storeId}` がログインなしで呼べて、全店舗の LINE のトークンが読める・店舗を書き換えられる状態だった
- `viewer`（`src/lib/store-access.ts` の `resolveStoreViewer`）: `public`（未ログイン / その店舗にアクセスできない）= `id` / `name` / `logo_url` / `theme_color` だけ（店舗管理者ページのログイン画面が使う）、`store`（店舗管理者）= 鍵を除いた店舗情報 + `line_channel_access_token_set`、`upper`（運営。移行期間中の旧サービス管理者 = `isServiceAdmin` を含む）= LINE のトークンを含む（店舗編集の入力欄で使う）。`google_calendar_refresh_token` は誰にも返さない
- **管理画面からは `fetchWithAuth(`/api/stores/${storeId}?full=1`)` で呼ぶ**: `?full=1` はログインが切れていると 401（その店舗にアクセスできなければ 403）を返すので、`fetchWithAuth` が Cookie を取り直して再試行する。付けないと、ログインが切れたときに「店舗名だけ」が 200 で返り、画面が設定の無い店舗として動いてしまう（店舗管理者に表示するメニューの設定が効かず全タブが出る、など）。ログイン前の画面だけ `?full=1` なしで呼ぶ
- 更新は `sanitizeStoreUpdate(body, { isMaster })` を通す（`id` / `created_at` / `google_calendar_refresh_token` / 表示用の `*_set` を取り除く。`org_id` = テナントの付け替えはマスター管理者だけ）
- 運営だけの操作は `authorizeUpperAdminStoreAccess(request, storeId)`（店舗管理者は 403）。画面でボタンを隠すだけにしない
- Vitest: `store-view.test.ts` / `store-api-auth.test.ts`

**管理用の API は必ず認可チェックを通す（`src/lib/store-access.ts`）:**
- 以前は、次の API がログインなしで呼べた（お客様の名前・電話番号・アンケートの回答が読める、フォームを書き換え・削除できる、店舗管理者を追加できる、画像置き場のファイルを消せる）。**新しい管理用の API を作るときは、ハンドラの最初で下のどれかを必ず呼ぶ**。`getCurrentUserId` は「誰が変更したか」の記録用で、認可にはならない
  - `authorizeStoreAccess(request, storeId)` … URL に店舗 ID がある API（マスター / 同じテナントのシステム管理者 / その店舗の店舗管理者）: `GET /api/stores/{storeId}/reservations`・`forms`（GET / POST）・`surveys`（GET / POST）・`surveys/responses`・`POST .../calendar`・`POST / DELETE /api/upload/menu-image`
  - `authorizeRecordStoreAccess(request, 'reservation_form' | 'survey_form' | 'reservation', id)` … フォーム ID・アンケート ID・予約 ID で呼ぶ API。行の店舗を調べてから確認する（行が無ければ 404）: `PUT / DELETE /api/forms/{formId}`・`.../deploy`・`.../duplicate`、`PUT / DELETE /api/surveys/{id}`・`.../deploy`・`.../duplicate`、`PATCH /api/reservations/{reservationId}`
  - `authorizeUpperAdminStoreAccess(request, storeId)` … 運営だけ（店舗管理者は自分の店舗でも 403）: `GET / POST /api/stores/{storeId}/admins`・`DELETE .../admins/{userId}`、店舗の更新・削除
  - どれも local 環境は認証スキップ。未ログイン = 401 / 別の店舗 = 403
- **ログインなしで呼べるままにしている API（お客様のフォームが使う）**: `GET /api/forms/{formId}`・`GET /api/surveys/{id}`・`GET /api/lotteries/{id}`・`POST /api/reservations`・`POST /api/surveys/submit`・空き状況（`calendar/availability`・`stay/availability`）・`change-source` / `change-menu` / `waitlist`（LINE ユーザー ID で本人確認）・抽選 / 寄せ書き（LIFF の ID トークン）・Webhook・`POST /api/preview/generate`
- **画面からは `fetchWithAuth`（`src/lib/client-auth.ts`）で呼ぶ**: Cookie のログイン情報は約 1 時間で切れる。`fetchWithAuth` は 401 のとき Cookie を取り直して 1 回だけ再試行する。素の `fetch` だと、画面を開いたまましばらく置いたあとの操作が失敗する
- 画像のアップロードは、店舗 ID と画像の名前（`menuId` / `submenuId`）に英数字・`_`・`.`・`-` だけを通す。削除できるのは `menu_images/{storeId}/` と `submenu_images/{storeId}/` の下だけ（フォームの HTML などは消せない）
- **店舗管理者ページ（`/{storeId}/admin`）を開いたときのアクセス確認は `GET /api/stores/{storeId}?full=1`**（`src/lib/store-admin-access.ts` の `storeAdminAccessCheckUrl` / `storeAdminAccessError` = 401 / 403 / 404 の文言）。以前は店舗管理者の一覧（`/admins`）で確認していたため、その API を運営だけにしたとき、店舗管理者の全員が「この店舗へのアクセス権限がありません」で入れなくなった。**API を運営だけにするときは、店舗管理者の画面がその API を呼んでいないかを先に調べる**。Vitest: `store-admin-access.test.ts`
- Vitest: `admin-api-auth.test.ts`（各 API の 未ログイン 401 / 別の店舗 403 / 運営だけの操作 403）

### フォーム固有の API:
- `GET /api/forms/{formId}` - 公開エンドポイント（顧客アクセス）
- `PUT /api/forms/{formId}` - 保護（店舗管理者）
- `POST /api/forms/{formId}/deploy` - Supabase Storage へデプロイ
- アンケートフォームは `/api/surveys/{id}` で同じパターン

### プレビュー API:
- `POST /api/preview/generate` - 保存前のフォーム編集状態からプレビュー HTML 生成

### 予約ステータス API:
- `PATCH /api/reservations/{reservationId}` - 予約ステータス更新（pending/confirmed/cancelled/completed）

### 顧客管理 API:
- 全エンドポイントで認証必須（`getCurrentUser` + `checkStoreAccess`、local 環境はスキップ）
- `GET /api/stores/{storeId}/customers` - 顧客一覧（`search`（名前・電話・メール部分一致 + タグ完全一致）/ `tag` / `customer_type` / `segment` / `limit` / `offset`）
- `POST /api/stores/{storeId}/customers` - 顧客作成（電話番号重複時は 409 + `existing_customer_id`）
- `GET /api/stores/{storeId}/customers/{customerId}` - 顧客詳細（予約履歴・来店履歴含む）
- `PATCH /api/stores/{storeId}/customers/{customerId}` - 顧客情報更新（空文字は nullable フィールドで自動的に null に正規化）
- `GET /api/stores/{storeId}/customers/tags` - 店舗の顧客タグを使用回数順に最大 50 件（`{ tags: [{ tag, count }] }`）
- `PATCH /api/stores/{storeId}/customers/{customerId}/visits/{visitId}` - 来店記録の申し送り更新（`next_visit_note` / `next_visit_note_by` / `acknowledge: true`）
- `DELETE /api/stores/{storeId}/customers/{customerId}` - 顧客削除（`customer_visits` は CASCADE、`reservations.customer_id` は SET NULL）
- `GET /api/stores/{storeId}/customers/analytics` - 顧客分析データ（セグメント分布、月別新規、性別/年齢、`line_friend_rate` + `line_friend_connected` + `line_linked_customers`、平均来店間隔、リピート率、売上ランキング）

### リッチメニュー API:
- `GET/POST /api/stores/{storeId}/rich-menus` - 一覧（+ 選べる予約フォーム・LINE のいまの設定との食い違い）/ 下書きを作る
- `PUT/DELETE /api/stores/{storeId}/rich-menus/{id}` - 内容を保存 / 削除（反映中は不可）
- `POST /api/stores/{storeId}/rich-menus/{id}/publish` / `.../unpublish` - 全員向けのメニューとして公式 LINE に反映 / 反映をやめる（お客様ごとのメニューは、条件に合うお客様に出す / 出すのをやめる）
- `POST /api/stores/{storeId}/rich-menus/sync` - お客様ごとのメニューの設定を、いまの条件に合わせて見直す
- `POST /api/stores/{storeId}/rich-menus/rule-order` - お客様ごとのメニューの優先順位（`{ ids }`）
- `POST /api/cron/rich-menu-sync` - 1 日 1 回の見直し（pg_cron から。Service Role Key の Bearer）

### 1 対 1 トーク API:
- `GET/PUT /api/stores/{storeId}/chat-settings` - トーク機能の ON / OFF・会話の保存期間（`{ enabled?, retention_years? }`。運営だけ。ON にできるのはチャネルシークレットを登録した店舗だけ）
- `GET /api/stores/{storeId}/chat/threads` - 会話の一覧（`filter` = all / unread、`search` = 名前。未読が上・新しい順。LINE ユーザー ID は返さない）
- `GET /api/stores/{storeId}/chat/threads/{threadId}` - 会話 1 本とメッセージ（開くと既読。`before` / `after` = メッセージ ID、`read=0` = 既読にしない。他の店舗の会話は 404）
- `POST /api/stores/{storeId}/chat/threads/{threadId}/messages` - 返信（`{ text, client_key }`。同じ `client_key` は 1 回だけ送る。公式 LINE の通数を 1 通使う）
- `GET /api/stores/{storeId}/chat/unread` - トーク機能が ON か・未読の合計（`quota=1` で今月の通数も）
- `DELETE /api/stores/{storeId}/chat/threads/{threadId}` - 会話 1 本を、メッセージ・画像ごと消す（運営だけ。元に戻せない）
- `PATCH /api/stores/{storeId}/chat/threads/{threadId}` - 対応中 / 対応済み の切り替え（`{ status }`）
- `GET /api/stores/{storeId}/chat/media/{messageId}` - お客様から届いた画像（公開していない置き場から、ログインと店舗を確かめて返す）
- `POST /api/stores/{storeId}/chat/images` - 返信で送る画像のアップロード（FormData の `file`。JPEG / PNG・1MB まで）
- `GET/PUT /api/stores/{storeId}/chat/templates` - 定型文（`{ templates: [{ id?, title, text }] }`）
- `GET /api/master-admin/chat-usage` - 全店舗のトークの利用状況（`month` = YYYY-MM、`format=csv`。マスター管理者だけ）
- `GET/PUT /api/stores/{storeId}/chat/notifications` - 新着の通知の設定（`{ line, email, emails, quiet: { enabled, start, end } }`。店舗管理者も変えられる）
- `POST /api/stores/{storeId}/chat/notifications/test` - テストの通知を送る
- `POST /api/cron/chat-retention` - 保存期間を過ぎた会話の自動削除（pg_cron から。Service Role Key の Bearer）

### 予約カレンダー API:
- `GET /api/stores/{storeId}/reservations/calendar` - 期間に掛かる予約と、予約以外の予定の時間（`from` / `to` = YYYY-MM-DD。最大 62 日。認証必須）

### 予約分析 API:
- `GET /api/stores/{storeId}/reservations/analytics` - 予約統計（`date_from` / `date_to` = 予約日 YYYY-MM-DD、`form_id` = フォーム絞り込み。認証必須）

### 流入経路 API:
- `GET/POST /api/stores/{storeId}/reservation-sources` - 経路の一覧（+ 選べる予約フォーム）/ 作成（`{ name, form_id }`）
- `PUT /api/stores/{storeId}/reservation-sources/{id}` - 名前 / 開くフォーム / 有効・停止（`{ name?, form_id?, active? }`。削除は無い）
- `GET /api/stores/{storeId}/reservation-sources/{id}/qr` - QR コードの PNG
- `GET /api/stores/{storeId}/reservation-sources/stats` - 経路ごとの 予約数 / キャンセル数 / 売上 / 読まれた数 / 予約率（`date_from` / `date_to` = 予約日 YYYY-MM-DD、`form_id`）
- `GET /s/{code}` - 経路の URL（公開。読まれた数を数えて予約フォームへ移動）
- `POST /api/reservations` に `source_code`（フォームが `?src=` から読んで送る。店舗の有効な経路のものだけ記録）

### 宿泊モード API:
- `GET /api/stores/{storeId}/stay/availability?form_id=&from=&to=&guests=` - 夜ごとの空き・残り・料金（公開。予定のタイトル等は返さない。`guests` は `{ "<category_id>": n }` の JSON か `adult:2,child:1`。最大 93 日）
- `POST /api/reservations` に `checkout_date` / `guest_counts`（宿泊フォームのとき。料金はサーバーで再計算）、`PATCH /api/reservations/{id}` に `checkout_date` / `guest_counts` / `cancel_fee_percent` / `cancel_fee_amount`

### Google Calendar 連携 API:
- `GET /api/integrations/google-calendar/connect?store_id=xxx` - OAuth 認証開始（リダイレクト）
- `GET /api/integrations/google-calendar/callback` - OAuth コールバック
- `POST /api/stores/{storeId}/calendar` - 店舗用カレンダーを SA で新規作成（system モード）
- `PUT /api/stores/{storeId}/calendar` - カレンダー ID 切替（書き込み権限を再検証、store_oauth 専用）
- `GET /api/stores/{storeId}/calendar/list` - 連携アカウントの書き込み可能カレンダー一覧（store_oauth 専用）
- `POST /api/stores/{storeId}/calendar/disconnect` - カレンダー連携解除
- `GET /api/stores/{storeId}/calendar/availability` - カレンダー空き状況（時刻ごとのイベント情報）

### 店舗管理者 API:
- `GET /api/stores/{storeId}/admins` - 管理者一覧
- `POST /api/stores/{storeId}/admins` - 管理者追加（メールアドレス招待）
- `DELETE /api/stores/{storeId}/admins/{userId}` - 管理者削除

### 抽選フォーム API:
- `GET/POST /api/stores/{storeId}/lotteries` - 一覧（参加数・当選数・引換数付き）/ 作成（`form_name`, `liff_id`, `lottery_type`）
- `GET/PUT/DELETE /api/lotteries/{id}` - 取得（公開）/ 更新（config 全体。確率合計・在庫・締切を検証）/ 削除（履歴もカスケード）
- `POST /api/lotteries/{id}/duplicate` - 複製（履歴はコピーしない。賞品 ID は振り直し）
- `POST /api/lotteries/draw` - 抽選実行 / 後日抽選の応募（公開。`id_token` 必須、回数上限は 409 + `existing_result`）
- `GET/PATCH /api/lotteries/{id}/my-result` - 直近結果の再表示 / LIFF 送信完了の記録
- `POST /api/lotteries/{id}/deploy` - 静的 HTML を生成して Storage へデプロイ（設定検証 + LIFF ID 必須）
- `GET /api/lotteries/qr/{token}.png` - 当選 QR コード画像（公開）
- `GET /api/lotteries/{id}/deferred/summary` / `POST .../deferred/draw`（`{ force }`）/ `PATCH .../deferred/winners`（`{ remove, add }`）/ `POST .../deferred/confirm` / `POST .../deferred/resend` - 後日抽選の進行
- `GET /api/stores/{storeId}/lotteries/entries` - 履歴一覧（`form_id` / `prize_id` / `status` / `search` / `from` / `to` / `limit` / `offset`）
- `PATCH /api/stores/{storeId}/lotteries/entries/{entryId}` - `action: redeem | unredeem | cancel | restore`
- `GET /api/stores/{storeId}/lotteries/entries/export` - CSV（UTF-8 BOM）
- `GET /api/stores/{storeId}/lotteries/redeem/{qrToken}` - QR トークン or 6 桁コードで当選内容を照会

### Webhook:
- `POST /api/webhooks/line` - LINE Messaging API Webhook（チャネルシークレットを登録した店舗だけ署名を確認。未登録の店舗は確認しない）
- `GET/PUT/DELETE /api/stores/{storeId}/line-webhook` / `POST .../line-webhook/test` - 署名チェックの状態・チャネルシークレットの登録と削除・接続の確認（運営だけ）

### エラーレスポンス形式:
```json
{
  "error": "日本語のエラーメッセージ",
  "details": "オプションの追加情報"
}
```

## UI コンポーネントシステム

**shadcn/ui 統合:**
- すべての UI コンポーネントは `src/components/ui/` 内
- Radix UI プリミティブベース
- アイコンは `lucide-react` を使用
- Tailwind CSS v4 でスタイリング
- モバイルファーストレスポンシブデザイン

**主要 UI コンポーネント（`src/components/ui/`）:**
- `alert-dialog.tsx` - 確認ダイアログ
- `avatar.tsx` - ユーザーアバター
- `badge.tsx` - ステータスバッジ
- `button.tsx` - ボタン
- `card.tsx` - カード
- `dialog.tsx` - モーダルダイアログ
- `drawer.tsx` - ドロワー（モバイル用）
- `dropdown-menu.tsx` - ドロップダウンメニュー
- `input.tsx` - テキスト入力
- `select.tsx` - セレクトボックス
- `sheet.tsx` - サイドシート
- `table.tsx` - テーブル
- `tabs.tsx` - タブ
- `toast.tsx`, `toaster.tsx`, `use-toast.ts` - トースト通知

**主要ビジネスコンポーネント（`src/components/`）:**
- `StoreAdminLayout.tsx` - 店舗管理者ダッシュボードラッパー
- `StoreAdminManager.tsx` - 店舗管理者追加・削除
- `CustomerList.tsx` - 顧客一覧
- `CustomerDetail.tsx` - 顧客詳細
- `CustomerAnalytics.tsx` - 顧客分析
- `LotteryFormList.tsx` / `LotteryEntryList.tsx` - 抽選フォーム一覧・抽選履歴（引換操作・CSV）
- `ReservationAnalytics.tsx` - 予約分析
- `FormEditor/` - フォーム編集コンポーネント群

## データベーススキーマ（Supabase）

**主要テーブル:**
- `organizations` - テナント（組織）マスタ（id: UUID、name、slug）
- `master_admins` - マスター管理者（user_id → auth.users）
- `system_admins` - システム管理者（user_id → auth.users、org_id → organizations）
- `stores` - 店舗マスタ（id: 6文字、org_id → organizations、name、owner_name、owner_email 等）
- `store_admins` - 店舗管理者マッピング（user_id → store_id）
- `forms` - 予約フォーム（config: JSONB）
- `survey_forms` - アンケートフォーム（config: JSONB）
- `reservations` - 予約レコード（line_user_id、google_calendar_event_id カラム含む）
- `customers` - 顧客マスタ（CRM 機能、LINE 連携情報・統計情報含む）
- `customer_visits` - 顧客来店履歴（visit_date、treatment_menus、amount 等）
- `customer_interactions` - 顧客インタラクション履歴
- `admin_settings` - サービス全体の設定（Google API 認証情報など）
- `lottery_forms` - 抽選フォーム（config: JSONB、後日抽選の進行状態 `deferred_draw_status`）
- `lottery_entries` - 抽選履歴（1 行 = 1 回の抽選 / 1 口の応募。引換コード・QR トークン・引換状態）
- `follow_messages` - LINE フォローメッセージの配信予定・結果（1 予約 1 行。`status` / `skip_reason` / `scheduled_at` / `sent_at` / `claimed_at`）
- `reminder_logs` - LINE 予約リマインダーの送信記録（1 予約 × 対象日 = 1 行。二重送信防止・後追い確認）
- `waitlist_entries` / `waitlist_notifications` - 空き待ち（キャンセル待ち）の登録と通知の記録
- `store_digest_settings` / `store_digest_staff` / `store_digest_logs` - 朝の「今日の予約まとめ」・月次レポートの設定（合言葉つき）/ LINE で受け取るスタッフ / 送信の記録
- `chat_settings` / `chat_threads` / `chat_messages` / `chat_usage_monthly` - 1 対 1 トーク（店舗ごとの設定 = 行なしは OFF / 会話 = 店舗 × LINE ユーザーで 1 本 / メッセージ / 店舗 × 月の利用量）
- `wall_boards` / `wall_posts` / `wall_reports` / `wall_consents` / `wall_moderation_logs` / `wall_topics` / `wall_empathies` - 寄せ書きウォール（ボード設定 / 付箋 / 通報 / 同意 / 公開操作の記録 / お題 / 共感。投稿者・共感した人は hash のみ）

**RLS（Row Level Security）:**
- マスター管理者: `is_master_admin()` で全テーブルフルアクセス
- システム管理者: `is_system_admin()` + `system_admin_store_ids()` で同テナント内のみ
- 店舗管理者: `store_admins` テーブル経由で `store_id` でフィルタ
- テナント分離: `stores.org_id` と `system_admins.org_id` で完全分離
- 公開 API（フォーム取得、予約作成）は匿名アクセスを許可

**主なマイグレーション（`supabase/migrations/`）:**
- `20250101000000_initial_schema.sql` - 全テーブルの初期スキーマ
- `20250103000000_add_source_medium.sql` - 流入経路（source_medium）カラム追加
- `20250204000000_add_crm_tables.sql` - customers・customer_visits テーブル追加
- `20250211000000_add_google_calendar_oauth_columns.sql` - Google Calendar OAuth カラム追加
- `20250212000000_add_reservations_google_calendar_event_id.sql` - 予約への Calendar イベント ID カラム追加
- `20260308000000_remove_subdomain_columns.sql` - subdomain・custom_domain カラム削除
- `20260407000000_add_multi_tenant_admin.sql` - master_admins・system_admins テーブル追加（マルチテナント）
- `20260411000000_add_organizations.sql` - organizations テーブル追加
- `20260411100000_add_reminder_settings.sql` - stores.reminder_enabled / reminder_time 追加
- `20260411100001_update_cron_hourly.sql` - send-reminders Edge Function を毎時実行に変更
- `20260429000000_add_store_postal_code.sql` - stores.postal_code 追加（Web 予約メール用）
- `20260902000000_add_admin_visible_tabs.sql` - stores.admin_visible_tabs 追加（店舗管理者に表示するタブ）
- `20260904100000_add_visit_next_note.sql` - customer_visits に次回への申し送り 3 列追加（カルテ機能）
- `20260903000000_add_lottery.sql` - lottery_forms / lottery_entries テーブル・RLS・`lottery_insert_entry_checked` 関数
- `20260903000001_add_store_line_channel_id.sql` - stores.line_channel_id 追加（ID トークン検証用）
- `20260904000000_add_admin_visible_options.sql` - stores.admin_visible_options 追加（店舗管理者に表示する項目の個別設定）
- `20260908000000_add_follow_message.sql` - stores.follow_* 5 カラム + follow_messages テーブル（フォローメッセージ配信予定）+ RLS
- `20260911000000_message_delivery_reliability.sql` - reminder_logs テーブル、stores.reminder_* の CHECK、follow_messages に sending / claimed_at、DB 関数 follow_message_schedule / follow_message_restore_for_user
- `20261013000000_add_same_day_reminder.sql` - stores.reminder_same_day_enabled / reminder_same_day_time（当日リマインダー）、reminder_logs.kind + 一意キーの差し替え
- `20261014000000_add_before_time_reminder.sql` - stores.reminder_before_time_enabled / reminder_before_time_minutes（直前リマインダー）、reminder_logs.kind に before_time
- `20261101000000_add_stay_reservation.sql` - 宿泊モード: reservations に checkout_date / stay_nights / guest_counts / guest_count / stay_price_total / cancel_fee_percent / cancel_fee_amount / cancelled_at、DB 関数 `stay_insert_reservation_checked`
- `20261120000000_add_store_digest.sql` - 朝のまとめ・月次レポート: store_digest_settings / store_digest_staff / store_digest_logs
- `20261125000000_add_line_rich_menus.sql` - リッチメニュー: line_rich_menus
- `20261126000000_add_line_rich_menu_links.sql` - リッチメニューのお客様ごとの切り替え: line_rich_menu_links
- `20261127000000_add_chat.sql` - 1 対 1 トーク: chat_settings / chat_threads / chat_messages、DB 関数 `chat_record_inbound`
- `20261128000000_add_chat_notifications.sql` - 1 対 1 トークの通知と自動削除: chat_settings の notify_* 列、DB 関数 `chat_claim_notification` / `chat_purge_expired`
- `20261129000000_add_chat_media.sql` - 1 対 1 トークの画像と定型文: chat_settings.reply_templates、公開しない Storage バケツ `chat-media`
- `20261130000000_add_chat_events_usage.sql` - 1 対 1 トークの自動の記録と利用量: chat_usage_monthly、DB 関数 `chat_add_usage` / `chat_record_system_events`、`chat_record_inbound` の差し替え
- `20261009000000_add_wall.sql` - 寄せ書きウォールの 5 テーブル・RLS・DB 関数 `wall_insert_post_checked` / `wall_add_report`
- `20261010000000_add_wall_daily_max.sql` - wall_boards.daily_max
- `20261011000000_add_wall_engagement.sql` - 寄せ書きの追加機能（wall_topics / wall_empathies、wall_posts の reaction / topic_id / note_color / note_deco / empathy_count、wall_boards の empathy_* / customer_pick_enabled、DB 関数 `wall_toggle_empathy`）

## テンプレートシステム

予約フォームテンプレート 5 種類:
1. **基本** - シンプルなメニュー選択
2. **スタンダード** - + 性別選択
3. **プレミアム** - + サブメニュー
4. **コンプリート** - + オプション、来店回数
5. **アルティメット** - + クーポン、リピート予約

テンプレートは初期 `config` 構造を提供し、後からカスタマイズ可能。

### FormConfig の主要フィールド

**基本情報 (`config.basic_info`):**
- `form_name` / `store_name` / `liff_id` / `theme_color` / `logo_url` / `notice`
- `second_message: { enabled, text }` - LIFF 2 通目固定テキスト送信（公式 LINE 完全一致応答用）
- `submit_button_label` - 「予約する」ボタンの文言（空 = 既定「予約する」。手動予約フォームは常に「予約を行う」）
- `complete_message` - LINE メッセージ送信成功後（`liff.closeWindow()` 前）に `alert` で出す案内（空 = 既定「当日キャンセルは無いようにお願いいたします。」）
- `line_only`（デフォルト true）- LINE フォームを LINE アプリ以外のブラウザで開いたとき、`liff.isInClient()` で判定して案内画面を表示し予約を受け付けない。`web` フォーム・プレビュー（`generateHTML(..., 'preview')`）・店舗側手動予約（`'manual'`）では無効。SDK 未読込など判定不能時は制限しない

**メニュー (`MenuItem` / `SubMenuItem` / `MenuOption`):**
- `hide_price` / `hide_duration` - 料金・所要時間を非表示にするフラグ（任意）
- メニュー / サブメニューの画像は `ImageCropperModal.tsx` でトリミングしてアップロード。アスペクト比は `CROP_ASPECTS`（16:9 / 4:3 / 1:1 / 3:4 / 9:16。幅 720px 基準）+ 「自由形」（スライダーで 1:2〜5:2。`freeOutputSize()` で横長は幅 720 / 縦長は高さ 960）。フォーム側の表示（ボタン左のサムネイル = 56px 角丸、詳細モーダル = `max-height: 320px; height: auto`）は画像の形をそのまま保つ
- **画像 URL はアップロードごとに変える**（`/api/upload/menu-image` が `{menuId}_{stamp}.{ext}`）。Storage の画像は 1 年キャッシュ（`cacheControl: 31536000`）のため、同じファイル名で上書きすると古い形の画像が表示され続ける。古い画像は `oldImageUrl` で削除
- **画像の拡大表示**: ボタン左のサムネイルと詳細モーダルの画像をタップするとライトボックス（`#image-lightbox`。`openImageLightbox` / `closeImageLightbox`、閉じるボタン・背景タップ・Esc で閉じる）で画面サイズに合わせて表示。サムネイルのタップはメニュー選択を起こさない（`stopPropagation`）

**オプションのオプション（追加のオプション。`MenuOption.sub_options` / カテゴリー共通オプションにも。純粋ロジック `src/lib/sub-options.ts`）:**
- メニュー編集 → メニューオプション → オプション編集、またはカテゴリー共通オプションの編集で、「追加質問」の上の「オプションのオプション」（`SubOptionsEditor.tsx`）。そのオプションを選んだお客様に、さらに選んでもらう項目（名前・料金・所要時間・料金 / 時間の非表示。20 件まで）。設定: `sub_options_mode`（`multiple` = 複数選べる（既定）/ `single` = 1 つだけ）、`sub_options_required`（必須）、`sub_options_label`（見出し。空 = 「追加オプション」）。カテゴリー共通オプションは `MenuItemModal` を流用しているので `asCategoryOption` のときだけ欄を出す
- **生成 HTML では、追加のオプションを「親のすぐ後ろに並ぶ通常のオプション」として展開する**（`flattenConfigSubOptions(safeConfig)`。展開した行は `parent_option_id` / `sub_label` を持ち、`name` = 「親の名前（追加の名前）」。保存される設定は入れ子のまま）。ボタンは通常のオプションと同じクラス（`.menu-option-item` / `.category-option-item`）で親の直下の `.sub-options-container`（親を選ぶまで非表示）に出すので、**選択の保存・合計金額・合計時間・カレンダーの空き判定・LINE メッセージ・予約データ（`selected_options` に「親（追加）」の名前で入る）・復元・メール・管理画面・分析は既存のオプションの処理のまま動く**（サーバー側の変更なし）
- フォーム側で足したのは `BookingForm.syncSubOptions(clickedId)`（オプションのクリック時と `updateSummary()` の先頭で呼ぶ）= `soSync`（親を外したら子も外す / 1 つだけのときは他を外す）+ 入れ子の表示切替、送信時の `soMissingRequired`（必須なのに未選択なら「「◯◯」の追加オプションを選択してください」）。埋め込み JS は `SUB_OPTIONS_RUNTIME_JS`（TS 版 `syncSubOptionSelection` / `findMissingRequiredSubOptions` と同じ実装。**直すときは両方**）
- 管理画面の予約編集（`ReservationEditForm`）も `flattenSubOptions` で候補に含める。追加のオプションには 追加質問 / 送信時の追加メッセージ / 対応時間設定 は付けられない。「更新して他のフォームにも反映」ではメニュー構成に含まれる。Vitest: `sub-options.test.ts`

**メニュー / オプションの見出し文言 (`config.menu_structure.display_options.menu_heading` / `options_heading`):**
- 予約フォームの「メニューをお選びください」（メニュー欄の見出し）と「オプション」（メニュー直下のオプション欄・カテゴリー共通オプション欄の両方）を店舗が変更できる。空 / 未設定 = 既定文言。40 文字まで。純粋ロジックは `src/lib/menu-headings.ts`（`resolveMenuHeadings(config)` / `DEFAULT_MENU_HEADING` / `DEFAULT_OPTIONS_HEADING`）
- 編集 UI はメニュー構成 → 「カテゴリー・メニュー」見出しの右の「見出しの文言を変更」ボタン（`MenuStructureEditor` の `headingsOpen` パネル。2 つの入力 + フォーム上の表示プレビュー）。「更新して他のフォームにも反映」ではメニュー構成セクションに含まれる。Vitest: `menu-headings.test.ts`
- **見出しの下のテキスト / 画像（`display_options.menu_heading_text` / `menu_heading_image` / `menu_heading_order`、`options_heading_*`）**: 見出しの直下に任意のテキスト（「画像orテキスト設置」と同じ `[color=#rrggbb]` の色タグ。1000 文字まで）と画像（https のみ。`/api/upload/menu-image`、`menuId = heading_menu` / `heading_options`）を表示。両方あるときの並び順は `text_image`（既定）/ `image_text`。オプション欄の設定はメニュー直下・カテゴリー共通オプションの両方に同じ内容が出る。正規化は `resolveMenuHeadingContents(config)`、生成は `renderHeadingContentHtml()`（`.heading-content` > `.heading-content-text` / `.heading-content-image`）。編集 UI は同じパネルの各見出し入力の下（`HeadingContentEditor`）。Vitest: `menu-heading-content.test.ts`

**カテゴリーごとのテキスト・画像ブロック（`MenuCategory.content_blocks`。純粋ロジック `src/lib/category-content-blocks.ts`）:**
- メニュー構成 → 各カテゴリーの「メニュー」一覧の下と「カテゴリー共通オプション」一覧の下にある「＋ テキスト・画像を追加」。中身は詳細設定の「画像orテキスト設置」と同じ（1 ブロック = テキスト（`[color=#rrggbb]` 可・1000 文字まで）か画像（https のみ）。複数追加・上下並び替え）
- 型 `CategoryContentBlock { id, type, text?, image_url?, target: 'menus' | 'options', position: 'top' | 'bottom' | 'after', after_id? }`。表示位置は「メニュー（オプション）一覧の一番上 / 一番下 / 「◯◯」のすぐ下」（`categoryBlockPositionOptions` / キー `top` `bottom` `after:{id}`）。参照先のメニューが削除された `after` は一番下として扱う（`resolveCategoryBlockPosition`）
- 生成 HTML は `renderCategoryBlocksAt(category, target, position, afterId?)`（`.content-block.category-block`。メニュー欄は `.menu-list` の前 / 各メニューの包み `<div>` の直後 / `.menu-list` の後、オプション欄は見出し下コンテンツの後 / 各オプションボタンの直後 / `.category-options-list` の後）。オプションが 0 件のカテゴリーではオプション欄ごと出ない。編集 UI は `CategoryContentBlocksEditor.tsx`。「更新して他のフォームにも反映」ではメニュー構成に含まれる。Vitest: `category-content-blocks.test.ts` / `category-content-blocks-static-form.test.ts`

**カテゴリーまたいでの複数選択 (`config.menu_structure`):**
- `allow_cross_category_selection` ON のとき `max_cross_category_selections`（既定 3、1〜20）で同時に選べるメニュー数を制限。生成 HTML の `getMaxCrossSelections()` が上限で選択を止め「メニューは N つまで選択できます」と案内。編集 UI はトグルの下の「選択できるメニューの数（上限）」

**ご来店回数選択 (`config.visit_count_selection`):**
- `hide_menu_until_selected?: boolean`（既定 true）- ご来店回数選択が ON のとき、選択肢をタップするまでメニュー欄（`#menu-field` = カテゴリーとメニュー）を隠す。初期 HTML で `display:none`、`applyVisitMenuVisibility()` が選択 / 復元時に表示。編集 UI は「来店回数選択を必須にする」の下のチェック
- `label?: string` - フォームに出す見出し（空 / 未設定 = 「ご来店回数」）。フォームの項目名、ご予約内容の行、LINE メッセージの《見出し》、メール・管理画面の項目名（`reservation-detail-items.ts`）に共通で使う。編集 UI はメニュー構成 → 詳細設定 → ご来店回数選択の「項目の見出し」。Webhook の送信テキスト解析は `《ご来店回数》` 固定のまま（`details.visitCount` は未使用のため影響なし）

**単一 / 複数選択の「チェックボックス式」（`choice_style` / `choice_size`。純粋ロジック `src/lib/choice-style.ts`）:**
- 回答タイプのプルダウンに「単一選択 (チェックボックス)」「複数選択 (チェックボックス)」を追加（`CHOICE_TYPE_SELECT_OPTIONS` の 4 つ。キー `radio` / `checkbox` / `radio_check` / `checkbox_check` を `choiceTypeKey` / `parseChoiceTypeKey` で `type` + `choice_style` に相互変換）。**`type` は従来どおり `radio` / `checkbox` のまま**で、`choice_style: 'checkbox'`（未設定 = ボタン式）だけが変わるので、回答値・追加質問・タグ・表示トリガー・復元・LINE メッセージは無変更
- 見た目: 1 列（縦並び）・行全体をタップ。単一は丸（ラジオ風）、複数は四角に ✓。大きさ `choice_size`（`small` 18px / `medium` 24px 既定 / `large` 32px。`CHOICE_SIZE_OPTIONS`）は回答タイプの下の「チェックボックスの大きさ」で選ぶ
- 生成 HTML は選択肢の入れ物（アンケート `.button-group` / 追加質問 `fu-container` / 予約 `.custom-field-radios` `.custom-field-checkboxes`）に `choiceGroupClass()`（`choice-check choice-check--single|multi choice-check--small|medium|large`）を付け、`CHOICE_CHECK_CSS` で描く（DOM 構造・埋め込み JS は従来と同じ。ボタン式の「✓ 選択中」バッジは出さない）
- 対象: アンケートの質問（`SurveyQuestionEditor`）・選択肢の追加質問（入れ子含む。`SurveyFollowUpEditor`）・予約フォームのカスタム項目と選択肢の追加質問・メニュー / オプションの追加質問（`MenuStructureEditor`）。抽選の事前質問では出さない（`allowChoiceStyle={false}`）。Vitest: `choice-style.test.ts` / `choice-style-static-forms.test.ts`

**アンケートの質問型「第三希望日時選択」（`SurveyQuestionType = 'multiple_dates'`）:**
- 回答タイプの「日時選択」の下に追加。予約フォームの日時選択モード「第三希望日時選択」と**同じ設定・同じ選択 UI**（第一〜第三希望の日付 + 時間のプルダウン、曜日別受付時間 / カスタム / 追加の時間帯 / 祝日 / 臨時営業日 / ✕にする時間帯 / 追加で表示する分 / 選択可能日数 / 必須選択 / 非表示設定）
- 設定は `SurveyQuestion.multiple_dates`（型 `MultipleDatesSettings` = `calendar_settings.multiple_dates_settings` と同じ。`src/types/form.ts`）。既定値・正規化は `src/lib/multiple-dates-settings.ts`（`createDefaultMultipleDatesSettings` / `normalizeMultipleDatesSettings` / `getVisibleChoices` / `getRequiredChoices`）。質問の「必須項目にする」が ON のときだけ `required_choices` を検証（第一希望は常に必須）、OFF なら全て任意
- 回答は 1 つの文字列 `第一希望: 2026年10月01日（木） 10:00 / 第二希望: …`（`responses[q.title]`）。復元機能 ON なら選択した日付・時間を端末に保存し再訪時に復元
- **設定 UI は共通コンポーネント** `src/components/FormEditor/Reservation/MultipleDatesSettingsEditor.tsx`（`InfoTooltip` / `ExtraMinutesPicker` / `buildTimeList` もここから export）。予約フォームの `BusinessRulesEditor` とアンケートの `SurveyQuestionEditor` が同じものを使う。抽選フォームの事前質問では `allowMultipleDates={false}` で出さない
- **生成 HTML の共通ロジック** `src/lib/multiple-dates-runtime-js.ts`（`HOLIDAY_RUNTIME_JS` = 祝日判定、`MULTIPLE_DATES_RUNTIME_JS` = `mdGetWeekdayHours` / `mdIsDateSelectable` / `mdPopulateDateOptions` / `mdPopulateTimeOptions` / `mdInsertExtraSlots` / `mdGenerateTimeSlots` / `mdFormatDateTimeJa`）。予約フォーム（`BookingForm` の同名メソッドは薄いラッパー）とアンケート（`initMultipleDatesQuestions` / `collectMultipleDatesAnswer`）の両方が埋め込む。日付判定を直すときはこのファイルだけを直す
- **日付 → 時間 の順でしか選べない**: `mdPopulateTimeOptions` は日付未選択（`selectedDateStr` が空）のとき時間を出さず、`<select>` を `disabled` にして「先に日付を選択」（`MD_TIME_LOCKED_PLACEHOLDER`）だけを出す。日付を選ぶと有効化して「時間を選択」（`MD_TIME_PLACEHOLDER`）+ 時間の選択肢。グレーアウトは `MD_TIME_SELECT_DISABLED_CSS`（`select.datetime-input:disabled`）を両ジェネレータの CSS に埋め込む。予約フォーム / アンケート共通。Vitest: `multiple-dates-time-lock.test.ts`

**アンケート質問の画像と表示トリガー（`SurveyQuestion.image_url` / `image_position` / `hidden_by_default` / `show_triggers` / `show_triggers_mode`）:**
- 画像: 質問に 1 枚添える（https のみ）。位置は `above`（質問名の上。既定）/ `middle`（説明文の下・入力欄の上）/ `below`（入力欄の下）。生成は `renderQuestionImageHtml()`（`.question-image`）
- 表示トリガー: 「フォームを開いたときは非表示にする」+「別の質問（単一 / 複数 / ドロップダウン）で この選択肢が選ばれたら表示」。追加質問の選択肢（入れ子含む）と「その他」（`__other__`）もトリガーにできる（`path` = 生成 HTML の `fu-{qid}-{path}` と同じ配列）。`show_triggers_mode` = `any`（既定）/ `all`。**非表示の質問は送信時に飛ばす**（必須チェック・`responses`・タグ付与・追加質問すべて対象外。回答は消さない）。トリガー元の質問が非表示なら不成立（連鎖）、親の選択肢が外れて隠れた追加質問の選択も数えない
- 純粋ロジック `src/lib/survey-visibility.ts`（`listSurveyTriggerChoices` / `computeHiddenSurveyQuestionIds` / `sanitizeSurveyShowTriggers` / `encodeTriggerKey`）。生成 HTML は `svSelectedValues` / `svGetHiddenQuestionIds` / `svApplyQuestionVisibility`（質問の包み `#qwrap-{id}`）。編集 UI は `SurveyQuestionDisplaySettings.tsx`（`SurveyQuestionEditor` の必須 / 復元チェックの下。`storeId` があるとき = アンケートのみ。抽選の事前質問では出さない / 抽選ジェネレータは未対応）。Vitest: `survey-visibility.test.ts` / `survey-question-visibility.test.ts`

**アンケートの選択肢タグ（`SurveyQuestionOption.tags`）:**
- 質問項目の各選択肢の「タグ」ボタン（追加質問の左）で、その選択肢を選んで送信した回答者に付ける顧客タグを設定（`TagInput`。店舗で使用中のタグを候補表示）
- `POST /api/surveys/submit` が回答保存後に `applySurveyTagsToCustomer()`（`src/lib/survey-tags-apply.ts`）を呼び、`line_user_id` で店舗内の顧客を検索してタグをマージ（顧客が無ければ何もしない。失敗しても送信は成功扱い）。回答 → タグの集計は `src/lib/survey-tags.ts` の `collectSurveyOptionTags()`（radio / select はラベル一致、checkbox は ", " 区切り）
- 顧客一覧はセグメントの隣に「タグで絞り込み」プルダウン（`GET /customers/tags` の一覧。将来の配信機能の絞り込みにも流用予定）

**アンケートフォームの送信ボタン連打対策（`static-generator-survey.ts`）:**
- `submitForm()` は送信中フラグ `svSubmitting` で 2 回目以降のタップを無視し、ボタンを `disabled` + 「送信中…」にする。本体は `submitFormInner()`（戻り値 true = 回答の保存・LINE 送信まで進んだ。false = 入力エラーで中断）。入力エラーのときだけボタンを元に戻し、送信まで進んだら戻さない（成功時はページが閉じる。保存済みの回答を再送させないため）。連打で回答と LINE メッセージが重複した事例への対策。Vitest: `survey-submit-double-click.test.ts`

**アンケート回答の Google スプレッドシート自動転記（`SurveyConfig.basic_info.google_sheets`。設計メモは本節のみ）:**
- アンケート編集 → 基本情報 → 「Google スプレッドシート連携」（`SurveySheetsSettings.tsx`）。**ON/OFF トグル**（`google_sheets.enabled`。OFF のときは ID 等の入力欄・ボタンを隠す。`enabled` 未設定の旧データは ID があれば ON 扱い = `isSurveySheetsEnabled`）、スプレッドシートの ID（URL 貼り付け可。`parseSpreadsheetId` で ID 化）、シート名（タブ。空 = 1 枚目。無ければ自動作成）。OFF または ID が空 = 連携しない。再デプロイ不要（サーバー側で参照）
- 認証は **マスター管理に登録済みのサービスアカウント**（カレンダー作成と同じ `google_service_account_json`。共通化 `src/lib/google-service-account.ts`）。店舗（弊社）はシートの「共有」でサービスアカウントのメールアドレスを**編集者**に追加するだけ（編集画面にメールとコピーボタンを表示）。他アカウントから共有されたシートも wakuwakusystemsharing@gmail.com から再共有できれば可
- **列のカスタマイズ**（「転記する列」の右の「列をカスタマイズ」。`google_sheets.columns: SurveySheetColumn[]`（key = `submitted_at` / `line_display_name` / `line_user_id` / `response_id` / `q:<質問の文言>`、`label` = 見出し名、`enabled`）+ `include_unlisted`（一覧に無い回答キー = 追加質問などを右端に自動追加。既定 true））。未設定 = おすすめ（固定 4 列 + 質問の順）。あとから足した質問は末尾に ON で入り、消えた質問の列は残す（編集画面で「削除された質問」）。`buildSurveySheetColumnPlan(settings, questions)` が「見出し → キー」のプランを作り、見出し行の作成（`mergeSurveySheetHeader(existing, responses, plan)`）と行の組み立て（`buildSurveySheetRow(response, header, plan)`）に使う。見出し名を変えると新しい列として右端に追加される（既存列は見出し名で対応するのでそのまま）。Vitest: `survey-sheets-columns.test.ts`
- 送信 `POST /api/surveys/submit` が回答保存 → タグ付与のあと `syncSurveyResponseToSheet()`（`src/lib/survey-sheets-service.ts`）で 1 行追記。**失敗しても回答の保存は成功扱い**（ログのみ）。1 行目（見出し）は `回答日時 / LINE表示名 / LINEユーザーID / 回答ID / 質問の文言…` を自動で作り、新しいキー（質問の追加・改名・追加質問）は右端に列を足す。列は**見出し名で対応**させるので店舗が列を並べ替えても壊れない。値は `=` `+` `-` `@` 始まりを `'` で無害化（`sanitizeSheetCell`）。日時は JST
- LINE 表示名はフォームの LIFF ID トークンの `name` を `line_display_name` で送り `surveys.line_display_name` に保存。無い回答（過去分）は顧客台帳（`customers.name`）で補う
- 「接続を確認」`POST /api/surveys/{id}/sheets/test`、「過去の回答を書き出す」`POST /api/surveys/{id}/sheets/export`（`surveys.sheet_synced_at IS NULL` の回答を古い順に最大 1000 件追記して `sheet_synced_at` を更新。残りは `remaining` で返しもう一度押す）、状態 `GET /api/surveys/{id}/sheets`（サービスアカウントのメール / 未転記件数）。いずれも `authorizeStoreAccess`
- 純粋ロジック `src/lib/survey-sheets.ts`（`parseSpreadsheetId` / `resolveSurveySheetsSettings` / `mergeSurveySheetHeader` / `buildSurveySheetRow` / `quoteSheetName`）。Vitest: `survey-sheets.test.ts` / `survey-sheets-service.test.ts`（偽の Sheets クライアント）
- マイグレーション: `20261109000000_add_survey_sheets_sync.sql`（`surveys.line_display_name` / `sheet_synced_at`）。**staging / production へは Dashboard の SQL Editor で手動適用**。未適用でも送信 API は列なしで再試行して回答を保存する

**アンケートの「テキスト/画像表示」ブロックと文字色 (`SurveyContentBlock`, `config.content_blocks`):**
- 質問項目の編集画面で Q と Q の間（Q1 の上・最後の Q の下も）に「テキスト/画像表示を追加」。`anchor` = 基準の質問 ID、`position` = `above | below`
- テキストは `[color=#rrggbb]〜[/color]` で部分的に文字色変更（予約フォームの「画像orテキスト設置」と同じ書式）。各質問の説明文も同じ書式に対応
- 共通ヘルパー `src/lib/colored-text.ts`（エスケープ + 色タグ変換。hex 以外は色として扱わない）。編集 UI は `src/components/FormEditor/Survey/SurveyContentBlockEditor.tsx`
- 静的 HTML では `StaticSurveyGenerator.renderContentBlocksAt()` が質問の上下に描画。画像は `/api/upload/menu-image` でアップロード（`menuId = survey_block_{id}`）

**アンケート質問の選択肢 (`SurveyQuestionOption`, `src/types/survey.ts`):**
- 編集画面（`SurveyQuestionEditor.tsx`）で選択肢をドラッグ&ドロップ並び替え可能（配列順がそのまま静的 HTML の表示順）
- `allow_other` は `radio` / `checkbox` / `select` すべてで有効。`select` は内部値 `__other__`（`StaticSurveyGenerator.OTHER_OPTION_VALUE`）で「その他」を表し、送信時に `その他（理由）` に変換
- `follow_ups?: Array<{ id?, enabled, title, type: 'text'|'textarea'|'radio'|'checkbox'|'select'|'birthday', required?, options? }>` - その選択肢が選ばれたときだけ表示する追加質問（**1 選択肢に複数 OK**。上から順に表示）。追加質問の `options[]` にも `follow_ups` / `tags` を付けられる（**入れ子。深さは `SURVEY_FOLLOW_UP_MAX_DEPTH` = 3 階層まで** = 質問を含めて 4 段階）。旧形式 `follow_up`（1 件）は読み取り互換（`getOptionFollowUps()` で両方を読む。編集画面で触ると `follow_ups` に移行）
  - 純粋ロジック: `src/lib/survey-follow-ups.ts`（`getOptionFollowUps` / `setOptionFollowUps` / `followUpTitle` / `resolveFollowUpResponseKey` / `countFollowUpsDeep` / `normalizeQuestionFollowUps`）。静的 HTML の描画と埋め込み JS はアンケート・抽選の事前質問で共通: `src/lib/survey-follow-up-runtime-js.ts`（`renderFollowUpBlocksHtml` / `FOLLOW_UP_RUNTIME_JS` = `fuUpdateVisibility` / `fuSelectChoice` / `fuCollect` / `fuCollectState` / `fuRestoreState` / `fuBindSave`。各ジェネレータは `fuOnChange(questionId)` を定義）。DOM id は `followup-{qid}-{path}` / `fu-{qid}-{path}` / `fu-container-{qid}-{path}`（path = 選択肢 index と追加質問 index を交互に `-` 連結。例 `fu-q2-1-0-2-0`）。入れ子ブロックは親の追加質問ブロックの中に描画
  - 回答は `responses` に追加質問の文言をキーとして親の直後に追加（文言が空なら `親の文言（選択肢名）`。同名キーがあれば `（選択肢名）`、それも重複すれば ` 2`, ` 3` …）。入れ子の回答もその直後に続く。追加質問の選択肢のタグも `collectSurveyOptionTags` が回答キーをたどって集める
  - 追加質問が radio / checkbox / select のときは `allow_other`（「その他」ボタン / 選択肢 + 理由欄 `fu-other-{qid}-{path}`。送信値は `その他（理由）`）と、上下のテキスト / 画像ブロック `content_blocks`（`SurveyContentBlock[]`。`anchor` は未使用、`position` で上下。追加質問ブロックの中に描画。編集 UI は storeId があるときだけ = アンケート）が使える
  - 編集 UI: `src/components/FormEditor/Survey/SurveyFollowUpEditor.tsx`（`OptionFollowUpsEditor`。再帰。各追加質問に「表示する」/ 削除 / 「その他」、選択肢ごとに「タグ」「追加質問」、追加質問の間に「テキスト/画像表示を追加」）。「追加質問」ボタンは配下の件数を `追加質問(N)` で表示し、初めて開くときに 1 件を自動作成。復元機能 ON 時は追加質問の入力（入れ子含む）も localStorage に保存

**カスタムフィールド (`config.custom_fields[]`):**
- `type`: `CustomFieldType` = `'text' | 'textarea' | 'radio' | 'checkbox' | 'date' | 'datetime' | 'birthday' | 'address' | 'select'`（追加質問 `AdditionalQuestion` も同じ）
- **誕生日選択（`birthday`）**: 年 / 月 / 日を別々のプルダウンで選ぶ（年は今年 → 100 年前、日は年月に合わせて 28〜31 日）。予約フォームのカスタムフィールド・追加質問、アンケートの質問・選択肢の追加質問、抽選の事前質問すべてで使える。値は hidden input（既存の id）に `"YYYY-MM-DD"` で入り、`input` / `change` を発火するので既存の値取得・復元・必須チェックがそのまま使える。表示は `formatDateTimeForDisplay` で `YYYY年MM月DD日`。共通実装は `src/lib/multiple-dates-runtime-js.ts` の `BIRTHDAY_RUNTIME_JS`（`bdInitAll` / `bdSyncFromHidden`）/ `renderBirthdayFieldHtml()` / `BIRTHDAY_CSS`。復元などで hidden を直接書き換えたら `bdSyncFromHidden(hidden)` を呼ぶ
- **住所入力（`address`）**: 郵便番号を 7 桁入れると町名までを自動入力し、番地・号と建物名（任意）を手入力する 4 欄（郵便番号 / 都道府県・市区町村・町名 / 番地・号 / 建物名・部屋番号）。予約フォームのカスタムフィールド・追加質問、アンケートの質問・選択肢の追加質問、抽選の事前質問すべてで使える。値は hidden input（既存の id）に **1 つの文字列** `〒150-0001 東京都渋谷区神宮前1-2-3 ○○マンション 101` で入り、`input` / `change` を発火する（誕生日選択と同じ仕組みなので、保存・復元・必須チェック・LINE メッセージ・メール・管理画面・スプレッドシート転記は無変更）。**郵便番号 7 桁・町名まで・番地の 3 つが揃うまで値は空**（必須チェックに掛かる）。住所の検索はフォームから無料の zipcloud API（`https://zipcloud.ibsnet.co.jp/api/search`。CORS 対応）を直接呼び、見つからない / 通信できないときは案内を出して手入力で続けられる。**公開プロキシとプレビューの CSP `connect-src` に zipcloud を入れてある**（`/api/public-form/*` / `/preview/{storeId}/forms/{formId}`。通信先を変えるときはここも）。純粋ロジック `src/lib/address-field.ts`（`composeAddress` / `parseAddress` = 復元用に 4 欄へ分け直す。町名と番地の境目は末尾の番地らしい並びで判定 / `zipDigits` / `formatZip`）、描画 / CSS / 埋め込み JS は `src/lib/address-field-runtime-js.ts`（`renderAddressFieldHtml` / `ADDRESS_CSS` / `ADDRESS_RUNTIME_JS` = `adInitAll` / `adSyncFromHidden` / `adCompose` / `adParse`。TS 版と同じ実装なので**直すときは両方**。バッククォート・バックスラッシュ不使用）。復元などで hidden を直接書き換えたら `adSyncFromHidden(hidden)`（復元した郵便番号では住所を調べ直さない）。Vitest: `address-field.test.ts`
- **ドロップダウン選択の検索・絞り込み機能（`select_search`。予約フォームのカスタムフィールド / アンケートの質問で `type = 'select'` のときだけ）**: `{ enabled, unknown_enabled?（既定 true）, unknown_label?（空 = 「不明」。最大 20 文字） }`。ON のとき静的 HTML は元の `<select>` を非表示にして値の入れ物にし、その上に「名前で検索」入力欄 + 五十音ボタン（あ〜わ + すべて）+ 絞り込みリスト + **独立した「不明」ボタン**（絞り込みに関係なく常に押せる。送信値 = 表示名）を描画。選択するとリストが `<select>` の値を書き換えて `change` を発火するので既存の保存 / 復元 / 追加質問 / Webhook はそのまま動く（復元で `<select>` を直接書き換えたら `ssSyncFromSelect(select)`）。五十音は選択肢の `options[].kana`（ふりがな。任意。編集画面で ON のときだけ各選択肢に入力欄）→ 無ければ表示名の先頭文字で判定（濁音 / 小書き / カタカナは清音のひらがなへ寄せる。漢字始まりは ふりがな 無しだと五十音では出ず名前検索のみ）。アンケートの「その他」は絞り込みに関係なく常にリストの末尾（`fixed`）。純粋ロジックは `src/lib/searchable-select.ts`（`resolveSelectSearchSettings` / `kanaRowOf` / `matchesSelectSearch`）、描画 / CSS / 埋め込み JS は `src/lib/searchable-select-runtime-js.ts`（`renderSearchableSelectHtml` / `SEARCHABLE_SELECT_CSS` / `SEARCHABLE_SELECT_RUNTIME_JS` = `ssInitAll` / `ssSyncFromSelect`。判定は TS 側と同じ実装を持つので直すときは両方）。編集 UI はカスタムフィールドの「選択肢」ブロックの上（`MenuStructureEditor`）/ アンケートの「その他」チェックの下（`SurveyQuestionEditor`）のチェックボックス「検索・絞り込み機能を使う」。追加質問・抽選の事前質問・アンケートの追加質問の select には未対応。Vitest: `searchable-select.test.ts`
- **追加質問「選択したボタンのすぐ下に表示する」（`AdditionalQuestion.show_below_choice`。既定 false）**: メニュー / オプション / カテゴリー共通オプション / カスタム項目の選択肢に付けた追加質問を、OFF なら従来どおり項目の後ろにまとめて（メニュー欄の直後 / カスタム項目の直後）、ON なら選択したボタンの直後に表示する。生成 HTML は `aq-wrap-{id}` に `data-aq-inline="1"` を付け、表示時に `placeAdditionalQuestionBelowChoice()` が要素を移動する（id・入力値・リスナーはそのまま。メニューはボタン + オプション欄 / サブメニュー一覧をまとめた div の直後、オプションはボタンの直後、単一 / 複数選択は選んだ選択肢ラベルの直後に 1 行幅 `aq-field--inline` で割り込み、ドロップダウンはプルダウン（検索機能 ON なら `.ss-field`）の直後）。LINE メッセージ・メール・管理画面の項目順は変わらない。編集 UI は `AdditionalQuestionsEditor` の各質問（「必須項目にする」の下）のチェック。Vitest: `reservation-additional-question-inline.test.ts`
- **画像（`image_url` / `image_position`）**: カスタム項目に 1 枚添える（https の URL のみ描画）。位置は `above`（質問名の上。既定）/ `middle`（説明文の下・入力欄の上）/ `below`（入力欄の下・リンクボタンの上）。編集 UI は各カスタム項目の「画像（任意）」（`/api/upload/menu-image`、`menuId = custom_field_{id}`）。生成は `renderCustomFieldImageHtml()`
- **フォームを開いたときは非表示 + 表示トリガー（`hidden_by_default` / `show_triggers` / `show_triggers_mode`）**: トリガー種別は `visit_count` / `menu` / `option` / `staff` / `gender` / `coupon` / **`custom_field`（別のカスタム項目 `field_id` の選択肢 `value` が選ばれていたら）**。`show_triggers_mode` 未設定 = `any`（いずれか 1 つで表示）/ `all`（すべて成立で表示。トリガー 2 件以上のときに編集 UI に出る）。**非表示の項目は必須チェック・送信内容の対象外**（`getHiddenCustomFieldIds()` を必須チェックが参照）。`custom_field` トリガーは、その項目自体が非表示なら不成立（連鎖。`getHiddenCustomFieldIds` は結果が変わらなくなるまで繰り返す）。非表示になった項目は回答を消し、その選択肢の追加質問も隠す。Vitest: `reservation-custom-field-image-trigger.test.ts`
- 選択肢（`radio` / `checkbox` / `select`）ごとに `options[].additional_questions?: AdditionalQuestion[]`（その選択肢が選ばれたときだけ表示する追加質問。メニュー / オプションの追加質問と同じ型・同じ仕組み）。編集 UI は選択肢行の「追加質問」ボタン → モーダル（`AdditionalQuestionsEditor`）。生成 HTML では親項目の直下に `aq-wrap-{id}`（`data-owner-field`）として描画し、`getAdditionalQuestionEntries()` の `ownerType: 'custom_option'`（`ownerId` = 親フィールド ID、`ownerValue` = 選択肢の value）で表示・必須チェック・LINE メッセージ（親項目の直後に《質問名》）を制御
- **追加質問の追加質問（入れ子。`AdditionalQuestion.options[].additional_questions`）**: 追加質問の回答タイプが 単一選択 / 複数選択（ボタン・チェックボックス）/ ドロップダウン のとき、選択肢ごとの「追加質問」ボタンでさらに追加質問を付けられる（**深さは `ADDITIONAL_QUESTION_MAX_DEPTH` = 3 段まで**。カスタム項目の選択肢の追加質問だけでなく、メニュー / オプション / カテゴリー共通オプションの追加質問でも同じ）。純粋ロジック `src/lib/additional-question-tree.ts`（`flattenAdditionalQuestions` = 親 → 子 の順に 1 列へ / `countAdditionalQuestionsDeep` = ボタンの「追加質問(N)」）。編集 UI は `AdditionalQuestionsEditor` が自分自身を入れ子で描く（`depth` / `parentChoiceLabel`）
  - 生成 HTML: 入れ子の質問は親の `aq-wrap-{id}` のすぐ後ろに `class="aq-field aq-nested"`（カスタム項目の下なら `aq-followup` + `data-owner-field` も）+ `data-aq-path=" 祖先の質問ID… "` で描画（`renderNestedAdditionalQuestions`）。`getAdditionalQuestionEntries()` は入れ子を `ownerType: 'aq_option'`（`ownerId` = 親の質問 ID、`ownerValue` = 選択肢の値、`parent` = 親の entry、`root` = いちばん上の entry）として**親のすぐ後ろ**に並べる（`flattenAdditionalQuestions` と同じ規則。**直すときは両方**。親 → 子 の順は「親が隠れて回答が消える → 子も隠れる」の連鎖が依存している）。表示は「親が表示中 かつ 親の回答がその選択肢」のときだけ。必須チェック・回答の保存（`customer_info.custom_fields` に質問 ID をキーとして入る）・送信時の追加メッセージ・LINE メッセージ（親の質問の直後に《質問名》）は既存の entries のループがそのまま処理する
  - 「選択したボタンのすぐ下に表示する」は入れ子でも使える（親の質問の選択肢の直後に入る。選択肢は `data-field-id` で親のものだけを探す）。OFF の入れ子の質問は、親が選択肢の下へ移動しているとき `placeNestedAdditionalQuestion()` が親のすぐ後ろへ寄せる
  - 管理画面・メールの項目名は `reservation-detail-items.ts` の `collectFieldDefs` が選択肢の下をたどって引く。LINE の送信数の上限（`countReservationMaxLineMessages`）は入れ子の選択肢の追加メッセージも数える。Vitest: `reservation-nested-additional-questions.test.ts`

**カレンダー設定 (`config.calendar_settings`):**
- `booking_mode`: `'calendar'`（Google カレンダー連携式）| `'multiple_dates'`（第一〜第三希望日時選択）
- `time_interval`: `10 | 15 | 20 | 30 | 45 | 60 | 120` - カレンダー表示モードの時間スロット間隔（デフォルト 30）
- `extra_minutes?: number[]` - 追加で表示する分（0〜59）。時間間隔の行に加えて営業時間内の毎時この分の行を表示（例: 30 分間隔 + `[10]` → 09:00, 09:10, 09:30 …）。`multiple_dates_settings.extra_minutes` も同じ（時間の選択肢に追加）。生成 HTML は `addExtraMinuteSlots()`、正規化は `sanitizeExtraMinutes()`
- `business_hours` - 曜日別営業時間
- `advance_booking_days` - 何日先まで予約可能か（デフォルト 30）
- `max_concurrent_events` - 同時刻にこの件数以上のカレンダーイベントが重なる時間帯は ✕（デフォルト 1）。**サーバー側でも再確認**: `POST /api/reservations` はカレンダー表示モードで店舗カレンダーへ予定を作る予約（手動予約フォーム含む）について、送信時点の店舗カレンダーの予定を数え（営業日イベント除外・終日予定は JST の 1 日全体 = 画面の〇✕と同じ数え方。`countStoreCalendarEventsInSlot` / `src/lib/staff-availability.ts` の `countEventsOverlappingSlot` / `resolveReservationSlotWindow`）、上限に達していれば `409 { code: 'slot_taken' }`。予定を取得できないときも安全側で 409（「空き状況を確認できませんでした」）。静的フォームも送信直前に `recheckSelectedSlot()` でキャッシュを捨てて空き状況を取り直し、✕になっていれば送信しない（取得失敗時は止めずサーバーに任せる）。フォームを開いたまま他の予約が入ったことでダブルブッキングが起きた事例への対策。Vitest: `reservation-slot-recheck.test.ts` / `staff-availability.test.ts`
- `few_left_mark?: { enabled, count, label? }` - **予約が一定数で△で表示する**（カレンダー表示モード・`max_concurrent_events` が 2 以上のときだけ。編集 UI は「同時刻に埋まるイベント数」の下のチェック → 「△ にするイベント数」（1 〜 上限 − 1）と「△ の説明」）。その時間に重なる予定（予約 + Google カレンダーのイベント。営業日イベント除く = ✕ の判定と同じ数）が `count` 件以上・上限未満のセルを △（白地にオレンジ `#ea580c`。**予約はできる**）で表示。例: 上限 2 / △ 1 → 0 件 = 〇、1 件 = △、2 件 = ✕。ON のフォームだけ凡例（予約可 / 満席）の間に「△ {label}」（空 = 「残りわずか」。20 文字まで）を出す。**スタッフ選択（スタッフごとのカレンダー）を使うフォームでは出さない**（上限自体を使わないため。編集画面に注意書き）。表示だけの機能でサーバー側の空き再確認は無変更。純粋ロジック `src/lib/slot-mark.ts`（`resolveFewLeftMark` / `sanitizeFewLeftMark`（normalizeForm が適用。未設定はキーを持たない）/ `slotMarkOf` / `maxFewLeftCount` / `usesStaffCalendars`、埋め込み JS `SLOT_MARK_RUNTIME_JS` = 同名の `resolveFewLeftMark` / `slotMarkOf`。**直すときは両方**）。生成 HTML は `renderCalendar()` がセルに `data-mark="ok|few|ng"` とクラス `few` を付ける。Vitest: `slot-mark.test.ts`
- `max_concurrent_reservations_per_user` - 同一ユーザーの未来予約最大件数（0 = 制限なし）
- `holidays_as_closed` + `excluded_holiday_types` - 日本の祝日を予約不可にする（1980-2099 年計算）。除外配列で個別の祝日を ✕ 対象から外せる
- `allow_exceed_business_hours` - 営業時間超過の予約を許可
- `special_business_days?: Array<{ date: 'YYYY-MM-DD', open, close }>` - 臨時営業日。登録した日付は曜日設定が定休でも、祝日設定・「祝日を予約不可にする」の対象でも、この時間で営業（〇）にする（優先順位: 臨時営業日 > 祝日 > 曜日）。カレンダー表示モードは `calendar_settings.special_business_days`、第三希望日時モードは `multiple_dates_settings.special_business_days`（別々に設定）。編集 UI は営業時間・ルール → 各モードの祝日行の下「臨時営業日」（`renderSpecialBusinessDays`）。正規化は `sanitizeSpecialBusinessDays()`（不正行除去・日付で重複排除・昇順）。生成 HTML は `findSpecialBusinessDay()` / `getDayBusinessHours()` / `isCalendarDateBlockedAsHoliday()` / `isMdDateSelectable()`。✕にする時間帯（`blocked_times`）はそのまま適用される
- `show_customer_name` / `show_customer_phone` - 入力欄の表示制御（false 時は LIFF 表示名/「未記入」を自動補完）
- `customer_name_label` - 「お名前」欄の見出し（空 = お名前。例: 氏名 / お名前（フルネーム））。フォームの入力欄・ご予約内容・未入力アラートに使う。**LINE メッセージの《お名前》・メール・管理画面の項目名は Webhook の解析（`《お名前》` で新形式判定）に使うため固定**
- `require_customer_name` / `require_customer_phone` - お名前 / 電話番号を必須にする（既定 true）。false で「（任意）」表示 + 必須チェックをスキップし、空なら LIFF 表示名 →「未記入」/「未記入」で補う。生成時に内部フラグ `customer_name_optional` / `customer_phone_optional` に変換（手動予約フォームは `manual_form_settings` が優先）
- `show_message_field` / `message_label` - 「メッセージ（任意）」欄の表示（既定 true）と見出し（空 = メッセージ。フォームでは「見出し（任意）」）。非表示のときは LINE メッセージ・メール・管理画面（`reservation-detail-items.ts`）にも《メッセージ》を載せない。編集 UI は営業時間・ルール → 「電話番号」フィールドを表示の下
- `show_menu_field` - メニュー欄の表示制御（false 時は希望日時/カレンダーをデフォルト表示）
- `show_customer_email` - メールアドレス入力 2 欄（メイン+確認）の表示。Web 予約での自動メール送信に必須
- `notification_email` - Web 予約の店舗側通知メール宛先（空時は `store.owner_email`）
- `multiple_dates_settings` - 希望日時モードの時間間隔・選択日数・曜日別時間設定
  - `weekday_hours[day].extra_slots?: Array<{ label, after }>` - 通常の時間リストに差し込む追加の選択肢（例: 午前中 / 午後 / 16:00以降）。`after` は `'start'`（先頭）/ `'end'`（末尾）/ `'HH:MM'`（その時刻の直後。✕で消えている時刻なら次の時刻の前）。編集 UI は曜日行と祝日行の「＋ 時間帯を追加」（`holiday_hours.extra_slots` も同形式）。生成 HTML は `insertExtraSlots()`。`custom`（カスタム受付時間）が ON のときは custom_slots が優先され extra_slots は使わない

**条件付き予約受付開始時間設定（`config.calendar_settings.conditional_advance_rules`。営業時間・ルール → 予約ルール設定 → 予約受付開始時間の下）:**
- 型 `ConditionalAdvanceRule { id, from_time?, until_time?, min_days, start_time? }`（`src/types/form.ts`）: 「現在時刻が from_time 以降（until_time より前）なら min_days 日後の start_time から予約可能」。例: 常に 2 日後の 09:30 から = `{ min_days: 2, start_time: '09:30' }` / 15:00 を過ぎたら翌日は不可 = `{ from_time: '15:00', min_days: 2 }`（15:00 までは予約受付開始日どおり）
- 純粋ロジック `src/lib/advance-rules.ts`: `sanitizeConditionalAdvanceRules`（normalizeForm が適用）/ `resolveEarliestBookable(cs, now)` → `{ days, start_time }`（予約受付開始日 `min_advance_days` と合わせて**いちばん先になるもの**を採用。同じ日数なら遅い開始時刻）/ `describeAdvanceRule`。静的 HTML には `ADVANCE_RULES_RUNTIME_JS`（同名の `resolveEarliestBookable` / `arHHMMToMin`）を埋め込む
- 生成 HTML: カレンダー表示モードは `renderCalendar()` の設定の組ごとに `resolveEarliestBookable` で `minDate` / `startTime` を決め、`evaluateSlotRules` が最初に予約できる日の開始時刻より前のスロットを✕にする。第三希望日時モードは `getMinAdvanceDays()` が日数を、`populateTimeOptions` が `earliestStart`（`mdPopulateTimeOptions` の opts）で最初の日の開始時刻より前の時間を隠す
- 編集 UI は `ConditionalAdvanceRulesEditor.tsx`（条件: 常に / ◯時以降 / ◯時より前 / ◯時〜◯時 → N 日後の◯時から）。スタッフごとの希望日時設定（`StaffScheduleSettings.conditional_advance_rules`）でも項目として上書きできる

**スタッフごとの「希望日時設定」（`config.staff_selection.staff[].schedule`。メニュー構成 → 詳細設定 → スタッフ選択 → 各スタッフの「メニューオプション設定」の隣）:**
- 型 `StaffScheduleSettings`（`src/types/form.ts`）。営業時間・ルールタブのうち Googleカレンダー連携モード設定（`business_hours` / `holiday_hours` / `special_business_days` / `blocked_times`+`blocked_time_weekdays` / `time_interval` / `extra_minutes`）と予約ルール（`min_advance_days` / `min_advance_hours` / `conditional_advance_rules` / `advance_booking_days` / `holidays_as_closed`+`excluded_holiday_types` / `allow_exceed_business_hours`）を**項目ごとに**上書き。`undefined` = フォームの設定を使う。**カレンダー表示モードのみ**（第三希望日時モードでは使わない）
- 純粋ロジック `src/lib/staff-schedule.ts`: `STAFF_SCHEDULE_ITEMS`（項目一覧・付随キー）/ `normalizeStaffSchedule`（normalizeForm が各スタッフに適用。上書きが無ければキーを持たない）/ `mergeStaffSchedule(cs, schedule)`（フォーム設定に上書きを重ねる）/ `countStaffScheduleOverrides` / `hasStaffSchedules`。静的 HTML には `STAFF_SCHEDULE_RUNTIME_JS`（同名の `mergeStaffSchedule` / `staffHasSchedule`）を埋め込む
- 生成 HTML の判定: `renderCalendar()` は `getRuleContexts()` が返す「設定の組」ごとに `evaluateSlotRules(ctx, …)`（受付期間 / 営業時間 / ✕にする時間帯 / 祝日 / 営業時間超過）を判定し、**1 つでも通れば候補**。指名あり = そのスタッフの設定 1 つ、指名なし / 未選択 = `getCapableCalendarStaff()`（メニューオプション設定で非表示にしたメニュー・オプションを含む予約では候補にしない）の各スタッフの設定。指名なしの空き判定は「ルールを満たし、かつカレンダーが空いているスタッフが 1 人でもいれば〇」。希望日時設定を持つスタッフがいない（または第三希望日時モード）ときは設定の組がフォーム設定 1 つになり**従来どおり**。時間間隔・追加で表示する分は指名中のスタッフの設定、それ以外はフォームの設定（`getPrimaryCalendarSettings`）。`getDayBusinessHoursFor(cs, date)` / `isBlockedTimeSlotFor` / `shouldBlockAsHolidayWith(cs, date)` が設定指定版、従来名は薄いラッパー
- 編集 UI: `src/components/FormEditor/Reservation/StaffScheduleEditor.tsx`（各項目に「フォームの設定を使う / このスタッフ用に設定」。個別にした時点でフォームの現在値をコピー。`HOLIDAY_TYPES` は `src/lib/holiday-types.ts` に共通化）。`MenuStructureEditor` の「希望日時設定」ボタンは上書き項目数を `（N項目 個別設定）` で表示。「更新して他のフォームにも反映」の「詳細設定（スタッフ選択）」はスタッフの希望日時設定ごとコピーする
- availability API はカレンダーの予定だけを返す（変更なし）。**「指名なし」の自動割当（`POST /api/reservations`）はスタッフごとの希望日時設定も見る**: `src/lib/staff-slot-rules.ts` の `filterNoPreferenceStaffByRules(staff, calendar_settings, { date, time, durationMinutes, now })` が、各スタッフの設定（`mergeStaffSchedule`）で 受付期間（事前予約可能日数 / 予約受付開始日 / 予約受付開始時間 / 条件付き予約受付開始時間）・営業時間 / 定休 / 営業時間超過・✕にする時間帯・祝日 / 臨時営業日 を**日本時間で**判定し（`isSlotBookableForSettings`。生成 HTML の `evaluateSlotRules` と同じ規則。**直すときは両方**。メニューの対応時間設定は見ない）、通ったスタッフの中からカレンダーが空いている人に割り当てる。誰も通らなければ `409 { code: 'slot_taken' }`。以前はカレンダーの予定だけを見ていたため、受付期間外・営業時間外のスタッフにも割り当てられていた。スタッフ指名ありの予約にはルールの再確認をしない（従来どおりカレンダーの空きだけ）。Vitest: `staff-slot-rules.test.ts`
- **「指名なし」の自動割当の対象にする（`staff[].no_preference_assignable`。未設定 = 対象。対象外のときだけ `false` を保存）**: スタッフ選択の各スタッフのチェック（「指名なし」ボタンを表示しているときだけ出る）。OFF のスタッフは指名されたときだけ担当し、「指名なし」の予約は他のスタッフに割り当てる。生成 HTML は「指名なし」を選んでいるときの空き判定を `getNoPreferenceStaff()`（対応できるスタッフのうち対象のスタッフ）で行い、サーバーも同じ絞り込み（`isNoPreferenceAssignable`）。カレンダー表示モードで対象のスタッフが 1 人もいないフォームは「指名なし」ボタンを出さない（編集画面に注意書き）
- **スタッフの指名料（`staff[].nomination_fee`。円。未設定 = なし。設定があるときだけキーを持つ。純粋ロジック `src/lib/nomination-fee.ts`）**: スタッフ選択の各スタッフの「指名料設定」ボタン（`MenuStructureEditor` の `staffFeeOpenId`。押すと金額の入力欄が開く）。フォームのスタッフのボタンに「＋500円」（`.staff-fee`）を出し、**そのスタッフを指名した予約の合計金額に 1 回だけ足す**（メニュー・オプションの料金表示は変えない。「指名なし」の自動割当では足さない）
  - 生成 HTML: `getNominationFee()`（`staffNominationFee` と同じ規則。**直すときは両方**）を `buildSelectionPayload()` が `totalPrice` に足し `nominationFee` も返す。ご予約内容に「指名料: ¥500」、LINE メッセージの《担当スタッフ》の次に《指名料》（送信時の項目編集 `line_message_items.nomination_fee`。既定 ON）、送信データは `customer_info.nomination_fee` + 指名料込みの `customer_info.total_price`。メニュー変更フォームでは変更元の予約の指名料（`change-source` の `nomination_fee`）のまま
  - サーバー: `POST /api/reservations` が `applyNominationFeeToCustomerInfo(customer_info, staff_selection, staff_id)` で確かめ直す（金額はフォーム設定が正。指名していない / 設定なしは消して合計も戻す。**フォームが指名料を送ってこない = 保存＆デプロイ前の HTML では足さない** = お客様に見せた金額だけを記録する）。管理画面の予約編集（メニュー変更で合計を再計算）と LINE のメニュー変更は予約時の指名料をそのまま合計に含める（担当を変えても指名料は変えない）
  - 表示・集計: メール / 管理画面の予約詳細（`reservation-detail-items.ts`。担当スタッフの次に「指名料」）、売上（`reservationAmount`）と来店履歴の金額（`calculateTotalAmount(menus, options, customer_info)`）に含める。DB の変更なし。「更新して他のフォームにも反映」ではスタッフ選択に含まれる。Vitest: `nomination-fee.test.ts`
- **スタッフの空き再確認は freeBusy ではなく予定一覧（`getBusyCalendarsByEvents` / 純粋ロジック `src/lib/staff-availability.ts`）で行う**。freeBusy は Google カレンダーの終日予定（既定で「予定なし」扱い）を返さないため、終日の「予約不可」を入れたスタッフが「指名なし」で割り当てられる事象があった。終日予定は JST の 1 日全体を埋まり扱い（availability API も終日予定を `YYYY-MM-DDT00:00:00+09:00` で返す）。指名なしで全員の確認ができないとき（API 失敗）は割り当てず 409 `slot_taken`

**キャンセルルール設定 (`config.cancel_rules`。営業時間・ルール → 予約ルール設定とご予約内容の間):**
- `deadline_hours`（0 = いつでも）: 予約日時（JST）の N 時間前までお客様自身が LINE の「予約をキャンセル」でキャンセルできる。期限後は一覧にボタンを出さず「店舗へご連絡ください（TEL）」の案内、「キャンセル: N」で来ても案内だけ返して取り消さない。**店舗管理画面（`PATCH /api/reservations/{id}`）からのキャンセルには適用しない**
- `policy_text` + `show_policy_on_form`: キャンセル規定の文言を予約フォームの送信ボタンの上に「キャンセルについて」として表示（`renderCancelPolicy`。期限があれば「LINE からのキャンセルは N 時間前まで」を自動で添える）
- `notify_store_on_cancel`: お客様が LINE でキャンセルしたとき（「予約を変更」で変更したときは「【予約変更】」メール）、`calendar_settings.notification_email` > `stores.owner_email` へ「【予約キャンセル】」メール（`buildCancelNotificationEmail`、Resend。API キー未設定ならスキップ）
- 純粋ロジックは `src/lib/cancel-rules.ts`（`resolveCancelRules` / `isCancelAllowed` / `buildCancelDeadlineMessage` / `buildCancelNotificationEmail`、選択肢 `CANCEL_DEADLINE_OPTIONS`）。Webhook は `getFormConfigByFormId` でフォーム設定を取り、`stores` から `owner_email` / `phone` も取得

**LINE の「予約を変更」（お客様自身による日時・時間・メニューの変更。`cancel_rules.allow_change`）:**
- お客様が公式 LINE で「予約を変更」（`CHANGE_KEYWORD`。完全一致）と送ると、これからの予約ごとにカード（日時を変更 / 時間を変更（同じ日）/ メニューを変更）を返す。以降はボタン（postback。data = `rc:{d|t|c|x}:{予約ID}:…` = 日付一覧 / 時間一覧 / 確認 / 確定。`buildChangePostback` / `parseChangePostback`）で 日付 → 時間（〇✕）→ 変更前後の確認 → 変更完了 と進む。Webhook は postback のうち `rc:` で始まるものを LINE メッセージの分岐（`lf:`）より先に `handleChangePostback` へ渡す。「予約を変更」は LINE メッセージのキーワード自動応答・配信停止キーワードに登録できない（`RESERVED_KEYWORDS` / `SYSTEM_KEYWORDS`）
- **設定**: 営業時間・ルール → キャンセルルール設定 → 「LINE からの予約変更を受け付ける」（`cancel_rules.allow_change`。**未設定 = ON**。OFF のフォームの予約は「店舗へご連絡ください」と案内）。**変更の期限はキャンセル期限（`deadline_hours`）と同じ**、**変更先に選べる日付は今日 〜 フォームの事前予約可能日数（`advance_booking_days`。上限 180 日。28 日ごとに「続きの日付を見る」）**。宿泊の予約は対象外。第三希望日時モードのフォームは「メニューを変更」だけを出す（日時の変更は店舗へ連絡）。再デプロイ不要（Webhook がサーバー側で設定を読む）
- **〇✕の判定**（純粋ロジック `src/lib/reservation-change.ts`）: `evaluateDaySlots(ctx, date, now)` = フォームのカレンダーと同じ行（`listGridTimes` = 全曜日の営業時間の最早〜最遅を時間間隔で刻む + 追加で表示する分）のうち当日の営業時間内の時刻について、`staff-slot-rules.ts` の `isSlotBookableForSettings`（受付期間・営業時間・✕にする時間帯・祝日・営業時間超過）+ カレンダーの予定（`isSlotFreeByEvents`。**自分の予約の予定は除く**。店舗カレンダー = 同時刻に埋まるイベント数まで・「営業日」イベントがあればその時間帯だけ / スタッフのカレンダー = 1 件でも重なれば ✕・スタッフ同時刻上限も見る）。予定を取得できないときはすべて ✕。日付は `evaluateChangeDays` → open（押せる）/ full（✕ 空きなし）/ closed（定休日など。出さない）。**メニュー / オプションの対応時間設定は見ない**。スタッフ選択の予約（指名なしを含む）は**いま割り当てられているスタッフのまま**変更する（日時変更・メニュー変更とも。担当の変更は LINE からはできない）
- **確定時の処理**（`src/lib/reservation-change-service.ts` の `applyReservationChange`）: 押されるたびに 本人の予約か・期限内か・その枠がまだ空いているか を確認し直してから、予約の行の日時を書き換え → Google カレンダーの予定を更新（`buildEventParamsFromReservation` = `src/lib/reservation-event-params.ts`。管理画面の予約編集と共通）→ 来店履歴を作り直し → 予約日が変わったらフォローメッセージの予定を再計算 → 「お客様がキャンセル・変更したら店舗にメールで通知」（`notify_store_on_cancel`）が ON なら「【予約変更】」メール。数週間ぶんの予定は `listCalendarEventsAll`（ページをたどる）で取る
- **メニューを変更 = メニュー変更フォーム**（予約フォームを `https://liff.line.me/{liffId}?change={予約ID}` で開く。**新しい予約は作らず、いまの予約のメニューを書き換える**）: フォームは `getChangeReservationId()`（`liff.state` 経由も読む）→ `GET /api/reservations/change-source?reservation_id&store_id&line_user_id`（公開。予約 ID + LINE ユーザー ID が一致し期限内のときだけ内容を返す）→ `enterMenuChangeMode()` で 見出し「メニュー変更フォーム」・案内（`#change-mode-banner` = 現在のご予約と手順）・「ご予約内容」→「変更内容」（`renderMenuChangeSummary` = 変更前 / 変更後のメニューと日時だけ）・送信ボタン「メニューを変更する」に切り替え、**メニュー欄（メニューの追加質問を含む）とメッセージ欄以外は隠す**（`body.menu-change-mode` の CSS。追加質問の中身の枠も `custom-field-wrap-{id}` なので、`.aq-field:not(.aq-followup)` の中は `display: block !important` で出し直している。お名前・電話番号・担当スタッフ・性別・来店回数・クーポン・カスタム項目・日時はいまの予約のまま使う）。いまの予約のメニュー・オプションを選んだ状態で開く（`applyChangeSource` → `handleRepeatBooking(override)`）
  - **日時はそのまま**。選んだメニューの所要時間がいまの予約より長いときだけ `POST /api/reservations/change-menu` に `check_only: true` で「いまの時間に入るか」を聞き（`scheduleMenuChangeFitCheck`）、入らないときだけ案内（`#menu-change-datetime-note`）とカレンダーを出して日時を選び直してもらう（`setMenuChangeFit(false)` → `body.menu-change-pick-datetime`。空き状況 API には `exclude_reservation={予約ID}` を付けていまの予約の予定を除く。短いメニューに戻すと元の日時に戻る）。第三希望日時モードのフォームでは確認しない（常にそのまま）
  - **送信** `handleMenuChangeSubmit` → `POST /api/reservations/change-menu`（`changeReservationMenu`）: 本人の予約か・期限内か（`validateChangeTarget`。だめなら `409 change_not_allowed`）→ 日時がそのままなら「延びたぶんがカレンダーの空き（自分の予定は除く）と営業時間の終わりに収まるか」だけ、選び直したなら フォームの規則 + カレンダーの空き を確認（入らなければ `409 slot_taken` → フォームが日時の選び直しを出す）→ `selected_menus` / `selected_options` / `menu_name` / `submenu_name` / `customer_info`（合計時間・合計金額・メニューの追加質問の回答をマージ）/ メッセージ（入力があるときだけ）/ 日時（選び直したときだけ）を書き換え → 以降は日時変更と共通（`applyReservationChange` = カレンダーの予定・来店履歴・フォロー予定・店舗への「【予約変更】」メール）。フォームは完了後 LINE に「【メニュー変更】《変更後のメニュー》…《日時》…」（`MENU_CHANGE_MESSAGE_HEAD`）を送り、Webhook が「【メニュー変更完了】」のカード（`buildMenuChangeDoneReply` = いちばん最近更新された予約）を返す。2 通目の固定テキスト・選択肢ごとの追加メッセージは送らない
  - **「メニューを変更」ボタンは、対応済みの HTML をデプロイしたフォームだけに出す**: デプロイ時に `static_deploy.features = ['menu_change']` を記録し（`src/lib/form-deploy-features.ts` の `RESERVATION_FORM_FEATURES` / `hasDeployedFeature`。`POST /api/forms/{id}/deploy` とフォーム作成時）、`buildChangeFormUrl(config, staticDeploy, 予約ID)` が印の無いフォーム・LIFF ID の無いフォーム・Web フォームでは null を返す。**保存＆デプロイしていない古い HTML は `?change=` を知らず通常の予約フォームとして開き、送信すると予約が増えてしまうため**。静的 HTML 側の対応を前提にする機能を足すときは、この印を増やして判定する
- カードの組み立ては `src/lib/reservation-change-flex.ts`（`buildChangeMenuMessage` / `buildChangeDatesMessage` / `buildChangeTimesMessage` / `buildChangeConfirmMessage` / `buildChangeDoneMessage` / `buildMenuChangeDoneMessage`。時間は 1 枚 30 枠・3 列）。Vitest: `reservation-change.test.ts` / `reservation-change-static-form.test.ts`。**リッチメニューに「予約を変更」と送るボタンを置くのは店舗（公式 LINE 管理画面）側の作業**

**空き待ち（キャンセル待ち）機能（`config.calendar_settings.waitlist`。仕様: `docs/8年11月18日追加機能/waitlist-spec.md`、リリース手順: `docs/空き待ち機能_リリース手順.md`。第 1 弾 = 登録・お知らせ・おわび・自動終了・一覧。第 2 弾 = 文面の編集・送信履歴・日時ごとの人数・夜間に送らない・今月の送信数。すべて実装済み）:**
- 満席（✕）の時間にお客様が空き待ちを登録 → キャンセル・日時変更などでその時間が空くと登録者**全員**に LINE で知らせる（先着順）→ 先に予約した人で埋まったら、予約しなかった人におわびを送って空き待ちを続ける → 再び空けばもう一度知らせる。**既定は OFF**（未設定のフォームはキーを持たない）。使えるのは **LINE フォーム × カレンダー表示モード**だけ（`isWaitlistActive(config)`。Web フォーム・第三希望日時・宿泊・手動予約フォーム・プレビューでは動かない）
- 設定 `calendar_settings.waitlist = { enabled, max_per_user（1〜10。既定 3）, deadline_hours（開始の N 時間前まで登録・お知らせ。既定 1）, quiet_hours: { enabled, start, end }（夜間に送らない。日本時間の「時」。既定 OFF / 22 時〜8 時。日付またぎ可）, messages: { registered?, slot_opened?, slot_filled? }（カードの最初の文章。空 = 既定 `WAITLIST_MESSAGE_DEFAULTS`。300 文字まで。`{日時}` `{メニュー}` `{店名}` `{予約URL}` を差し込める = `renderWaitlistMessageText`） }`。編集 UI は営業時間・ルール → 「空き待ち（キャンセル待ち）設定」（`WaitlistSettingsEditor.tsx`。キャンセルルール設定の下）。ON / OFF を変えたら保存＆デプロイが必要（フォーム側の部品は `WAITLIST` 定数が ON の HTML だけが出す）
- 状態 `waiting`（空き待ち中）→ `notified`（空きをお知らせ済み）→ `waiting`（埋まっておわび）… / `fulfilled`（その日時を予約した）/ `expired`（日時を過ぎた）/ `cancelled`（取り消し）/ `inactive`（送信に 2 回失敗）。1 登録 = 1 つの日時（+ 指名したスタッフ。指名なしは `staff_id = null`）。同じ人の同じ条件の二重登録は DB の一意インデックス（有効な空き待ちだけ）で防ぐ
- 純粋ロジック `src/lib/waitlist.ts`（`resolveWaitlistSettings` / `sanitizeWaitlistSettings`（normalizeForm が適用）/ `isWaitlistActive` / `checkWaitlistRegistration` / **`decideWaitlistAction(entry, 枠の状態, 設定, now)`** → `expire` / `notify` / `apologize` / `none`。枠の状態は `open` / `full` / `closed`（受付していない時間）/ `unknown`（カレンダーを取得できない = **何も送らない**））、カード `src/lib/waitlist-flex.ts`、保存 `src/lib/waitlist-repository.ts`（local は `data/waitlist.json`。読み取りは失敗したら「空き待ちなし」= マイグレーション未適用でも予約・キャンセルを止めない）、サーバー `src/lib/waitlist-service.ts`
- **枠が空いているかの判定** `evaluateWaitlistSlot(store, config, entry, now, cache)`: 「予約を変更」と同じ部品（`isSlotBookableForSettings` + `isSlotFreeByEvents`）で、予約 API と同じ見方をする。スタッフ選択のフォーム = 指名あり → そのスタッフのカレンダー / 指名なし → メニューに対応でき自動割当の対象のスタッフの誰かが空いているか（スタッフごとの希望日時設定・スタッフ同時刻上限も見る）。それ以外 = 店舗カレンダー（同時刻に埋まるイベント数まで）。メニュー / オプションの対応時間設定は見ない
- **見回り `processWaitlist({ storeId?, now, deadlineMs })`**: 有効な空き待ちを順に見て 終了 / お知らせ / おわび。**状態を先に書き換えてから送る**（`transitionWaitlistEntry(id, from, patch)` = from の状態のときだけ更新）ので、見回りが重なっても二重に送らない。おわびはお知らせ 1 回につき 1 回。送信は `pushLineMessages`（push = 通数を使う）で `waitlist_notifications` に記録。呼ばれるのは ① 予約のキャンセル・内容の編集（`PATCH /api/reservations/{id}`）・LINE のキャンセル（Webhook）・LINE の予約変更（`applyReservationChange`）の直後 = `scheduleWaitlistCheck(storeId)`（`after()` でレスポンス後。有効な空き待ちが無い店舗では何もしない。**10 秒待ってから**見る = 直後の取り直しを知らせない）② 新しい予約の直後 = `onReservationCreatedForWaitlist`（その人の同じ日時の空き待ちを `fulfilled` にして、すぐ見回る）③ pg_cron `run_waitlist_check`（10 分おき。**本番のみ登録**）→ `POST /api/cron/waitlist`（Service Role Key の Bearer。Google カレンダーを直接消したときの空き・過ぎた空き待ちの終了）④ 管理画面の「今すぐ空きを確認」= `POST /api/stores/{storeId}/waitlist/run`（staging の確認用）
- お客様の API（公開。本人確認 = LINE ユーザー ID + 空き待ち ID）: `POST /api/waitlist`（登録。満席の枠だけ = `slot_open` / `closed` / `duplicate` / `limit` / `deadline` / `disabled` は 409）、`GET /api/waitlist?store_id&line_user_id`、`POST /api/waitlist/cancel`、`GET /api/waitlist/source?entry_id&store_id&line_user_id`（お知らせから開いたとき用。`open` = いま予約できるか）。管理: `GET /api/stores/{storeId}/waitlist?scope=active|all`、`PATCH .../waitlist/{entryId}`（`{ action: 'cancel' }`）
- フォーム側 `src/lib/waitlist-runtime-js.ts`（`WAITLIST_RUNTIME_JS` / `WAITLIST_CSS`。バッククォート・バックスラッシュ不使用）: `renderCalendar()` が「受付しているのに予定で埋まっている」枠（`slotFull`。営業日イベントの時間外は除く）に `waitlist` クラスを付け、`handleDateTimeSelect(date, time, ok, canWaitlist)` が ✕ のタップで `wlOpenDialog` を開く。登録済みの枠は「待」。登録後は `liff.sendMessages` で「【空き待ち登録】…」（`WAITLIST_MESSAGE_HEAD`）を送り、Webhook が受付カードを reply で返す（無料）。カレンダーの上に「あなたの空き待ち（N件）」（一覧・取り消し）。お知らせのボタンは `https://liff.line.me/{liffId}?waitlist={空き待ちID}` → `wlLoadSource` / `wlApplySource` がメニュー・スタッフ・日時を入力済みにし、埋まっていれば「この枠はすでに埋まりました（空き待ちは継続）」と案内する（通常の予約フォームとして送信するので、予約の作成は既存の `POST /api/reservations` = 送信時点の空き再確認つき）
- LINE: 「空き待ち確認」（`WAITLIST_KEYWORD`。LINE メッセージのキーワード自動応答・配信停止キーワードに登録不可）で登録中の一覧 + 取り消しボタン（postback `wl:x:{空き待ちID}`。Webhook は `lf:` より先に処理）
- **夜間に送らない**（`isWaitlistQuietTime(settings, now)`）: その時間帯は `decideWaitlistAction` がお知らせもおわびも `none` にする（状態は変えない。日時を過ぎた空き待ちの終了は行う）。明けたあとの見回り（10 分おきの cron）が、その時点の空きで判断して送る = 夜のうちに埋まった枠は知らせない。登録時の受付カードはお客様の操作への reply なので時間帯に関係なく返す
- **文面の編集**: 変えられるのはカードの最初の文章だけ。日時・メニュー・担当の表示、注意書き（予約を保証しない / 先着順）、「この日時で予約する」ボタンは常に出す（`waitlist-flex.ts` の各関数の `lead` 引数。サーバーは `messageLead(config, key, store, entry)`）。Webhook・見回りがサーバー側で設定を読むので、文面と夜間の設定は再デプロイ不要（ON / OFF・上限・締切はフォームに埋め込むので保存＆デプロイが必要）
- 管理画面: 予約一覧（店舗管理者ページ / テナント側 店舗ページ / `/{storeId}/reservations`）の上の `WaitlistPanel.tsx`（空き待ちが 1 件も無い店舗では何も出さない）。表示は 一覧（受付中 / すべて・取り消し）/ **日時ごとの人数**（`src/lib/waitlist-summary.ts` の `groupWaitlistBySlot` = 受付中の空き待ちを 日付 → 時間 でまとめた人数。3 人以上はオレンジ）/ **送信履歴**（`GET /api/stores/{storeId}/waitlist/notifications` = 新しい順に 100 件 + `month`（今月の空き待ちの送信数。成功 / 失敗）+ `line_quota`（`fetchLineQuota` = 公式 LINE 全体の今月の通数と上限。取得できなければ null））。保存は `listWaitlistNotifications` / `countWaitlistNotifications`
- マイグレーション `20261118000000_add_waitlist.sql`（`waitlist_entries` / `waitlist_notifications`。RLS ポリシー無し = service_role のみ）。**staging / production へは Dashboard の SQL Editor で手動適用**。Vitest: `waitlist.test.ts` / `waitlist-service.test.ts` / `waitlist-static-form.test.ts` / `waitlist-repository.local.test.ts`

**通知メッセージ (`config.notification_messages`。営業時間・ルール → 通知メッセージ → 通知編集):**
- 【ご予約確認】の見出し / フッター、【予約キャンセル】の案内文 / キャンセル完了メッセージ。Webhook がサーバー側で参照（再デプロイ不要）
- 複数行 OK（Flex は `wrap: true` で `
` を折り返す）。文字色は `[color=#rrggbb]〜[/color]`（`ColoredTextToolbar`）。Flex では `src/lib/flex-colored-text.ts` の `flexText()` が色タグを `span` に展開し、常に `wrap: true` を付ける（長文が「…」で切れない）

**店舗側手動予約フォームの項目設定 (`config.manual_form_settings`):**
- `show_customer_name` / `require_customer_name` / `show_customer_phone` / `require_customer_phone`。**手動フォーム（`generateHTML(..., 'manual')`）だけ**に適用し、通常フォームの `calendar_settings.show_customer_*` は変えない。生成時に `safeConfig.calendar_settings` へ上書きし、任意は内部フラグ `customer_name_optional` / `customer_phone_optional`（保存しない）で「（任意）」表示 + 必須チェックをスキップ。空のときは名前 = LINE 表示名 → 「未記入」、電話 = 「未記入」で補う
- 編集 UI は営業時間・ルール → 予約ルール設定の「店舗側手動予約フォームの項目」

**フォームタイプ (`config.form_type`):**
- `'line'` - LIFF 経由（LINE トーク内で開く、メッセージ送信あり）
- `'web'` - 通常の Web フォーム（メール通知あり、LIFF 不使用）

**店舗テーブル (`stores`):**
- `name` / `owner_name` / `owner_email` / `phone` / `postal_code` / `address` - メール本文差し込みに使用
- `reminder_enabled` / `reminder_time` - LINE リマインダーの有効性と送信時刻（デフォルト 19:00）
- `reminder_same_day_enabled` / `reminder_same_day_time` - 当日リマインダー（既定 OFF / 09:00。前日などのリマインダーとは独立）
- `reminder_before_time_enabled` / `reminder_before_time_minutes` - 直前リマインダー（既定 OFF / 60 分前。30 分刻み）
- `follow_enabled` / `follow_base` / `follow_days_after` / `follow_time` / `follow_template` - LINE フォローメッセージ（既定 OFF。基準日 + N 日後に送信）
- `google_calendar_id` / `google_calendar_source` / `google_calendar_refresh_token` - Calendar 連携情報
- `line_channel_access_token` - LINE Messaging API 用

## テストアプローチ

**ローカルテスト:**
```bash
# 1. 開発サーバー起動
pnpm dev

# 2. マスター管理者画面にアクセス
http://localhost:3000/master-admin

# 3. テナント作成、店舗作成、フォーム作成
# 4. フォーム編集、保存＆デプロイ
# 5. public/static-forms/ で生成された HTML を確認
```

**Staging テスト:**
- `dev` ブランチにプッシュ → PR 作成 → `staging` にマージ
- https://form-management-staging.vercel.app に自動デプロイ
- staging Supabase プロジェクトを使用
- 実際の Supabase Storage でテスト

## 関連ドキュメント

詳細ガイドは `docs/` を参照:
- `SETUP.md` - 完全な環境セットアップ
- `WORKFLOW.md` - 日常的な開発フロー
- `ARCHITECTURE.md` - システム設計の詳細
- `API_SPECIFICATION.md` - 完全な API リファレンス
- `SUPABASE_BEST_PRACTICES.md` - Supabase 使用パターン
- `BRANCH_PROTECTION.md` - Git ワークフロールール
- `STORE_ADMIN_MANAGEMENT.md` - ユーザーロール管理
- `.github/copilot-instructions.md` - AI アシスタントクイックリファレンス（MCP セットアップを含む）
