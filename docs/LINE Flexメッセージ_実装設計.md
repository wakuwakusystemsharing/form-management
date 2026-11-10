# 公式 LINE 向け Flex Message 機能 実装設計

店舗ページ（テナント側 `/tenant/{slug}/admin/{storeId}`）の「寄せ書き」と「設定」の間に **「LINE メッセージ」タブ** を追加し、
公式 LINE の管理画面では作れない Flex Message をテンプレートから簡単に作って、自動応答や予約の自動メッセージに組み込めるようにする。

## 背景

- 公式 LINE 管理画面で作れるのは「カードタイプメッセージ」だけ。Flex Message は Messaging API からしか送れない
- この店舗は `stores.line_channel_access_token` を持ち、Webhook（`/api/webhooks/line`）・リマインダー / フォロー（Edge Function）で既に Messaging API を使っている
- 自動応答（reply）は無料。こちらから送る push は月の無料通数を消費する

## 機能（第 1 弾）

| 機能 | 内容 |
| --- | --- |
| テンプレート式ビルダー | 予約導線カード / メニュー・料金カルーセル / 料金表（リスト）/ 店舗紹介カード / クーポン・キャンペーン / お知らせ・営業案内 / スタッフ紹介カルーセル / ご利用の流れ。項目を埋めるだけ。右に LINE 仕様値に合わせたプレビュー |
| 上級者向け JSON 編集 | 生成された JSON を直接直せる（`flex_override`）。`custom` は JSON だけで作る |
| 下書きの自動作成 | カルーセル = 予約フォームのメニュー構成から / 店舗紹介 = 店舗情報から |
| キーワード自動応答 | お客様の発言と完全一致したら Webhook が返信（無料）。リッチメニューの「テキスト」アクションと組み合わせる |
| 自動メッセージへの差し込み | 【ご予約確認】（Webhook）/ リマインダー・フォロー（Edge Function）のあとに続けて送る |
| テスト送信 | LINE 連携済みの顧客を選んで push（無料通数 1 通） |
| タップ計測 | ボタンの URL を `/go/{id}/{key}` 経由にしてタップ数を数える |
| 追加のメッセージ（まとめて送る） | Flex 本体に テキスト / 画像 / 動画 / Flex（JSON）/ 保存済みの別の LINE メッセージ を足し、自由な順番で 1 回に最大 5 通送る（キーワード応答・差し込み・テスト送信すべて） |

一斉配信（セグメント / タグ）は第 2 弾。

## 追加のメッセージ（まとめて送る）

- 編集画面「送る内容の並び」に `items`（`LineFlexItem[]`。`main` = テンプレートで作った Flex 本体がちょうど 1 つ）。種類: `text`（5000 文字）/ `image`（アップロード or https URL。サムネイルは同じ URL）/ `video`（mp4 の https URL + サムネイル画像必須。LINE の仕様）/ `flex`（JSON 貼り付け。代替テキスト付き）/ `ref`（同じ店舗の保存済み LINE メッセージ。参照先の Flex 本体 1 通）
- 保存時に `payloads`（送信用メッセージの配列。items の順）を作る（`buildLineFlexPayloads`）。追加 Flex のボタンも計測リンクにし、キーは main の続き番号。`ref` は参照先の `payload` を展開して保存するので、参照先を保存・削除すると参照元の payloads を作り直す（`rebuildDependents`）
- 送る側は `lineFlexSendMessages(row)` = `payloads`（無い旧データは `[payload]`）。キーワード応答は全部（最大 5 通）、差し込み（予約確認 / リマインダー / フォロー）は本体 1 通と合わせて 5 通までなので追加分を含めて 4 通まで（超える設定は編集画面で警告し、先頭 4 通だけ送る）
- プレビューは `FlexPreview` の `messages` で複数通をトーク画面に並べる（テキスト = 白い吹き出し、画像 = 角丸サムネイル、動画 = サムネイル + 再生ボタン）。カルーセルはマウスの左ドラッグで横スクロール
- 列: `message_items JSONB` / `payloads JSONB`（`20261112000000_line_flex_multi_messages.sql`）。Edge Function は `payloads` を読むので**再デプロイが必要**

## データ

`line_flex_messages`（`20261110000000_add_line_flex_messages.sql`）

| 列 | 内容 |
| --- | --- |
| id | 12 文字 `[a-z0-9]`（画像アップロードのため編集画面で先に決める） |
| template | `custom` / `booking_card` / `menu_carousel` / `menu_list` / `store_card` / `coupon_card` / `notice_card` / `staff_carousel` / `steps_card`（CHECK 制約は `20261111000000_line_flex_more_templates.sql`） |
| data | テンプレートの入力値（`BookingCardData` 等） |
| flex_override | JSON 直接編集の contents（NULL = テンプレートから生成） |
| alt_text / keywords | 代替テキスト / 完全一致キーワード（最大 10。「予約確認」「キャンセル」は不可、同じ店舗で重複不可） |
| attach_confirm / attach_reminder / attach_follow | 差し込み先 |
| enabled / track_taps | 有効 / 計測 |
| payload | **Flex 本体の送信用メッセージ**（`{ type: 'flex', altText, contents }`。計測リンク入り）。保存時にサーバーで生成 |
| message_items / payloads | 追加のメッセージの並び（`items`）と、その順に組み立てた送信用メッセージの配列（最大 5 通）。Webhook / Edge Function は `payloads`（無ければ `[payload]`）をそのまま送る |
| links / tap_counts / reply_count | 計測キー → URL / タップ数 / 送信回数 |

RLS は他の店舗設定と同じ 3 階層。カウントは DB 関数 `line_flex_increment_tap` / `line_flex_increment_reply`。local は `data/line_flex_messages.json`。

## コード

- 型 `src/types/line-flex.ts`
- 純粋ロジック `src/lib/line-flex-templates.ts`（`buildTemplateFlex` / `instrumentFlexLinks` / `validateFlexContents` / `normalizeKeywords` / `matchesKeyword` / `menuCarouselFromForm` / `storeCardFromStore`）、`src/lib/line-flex-items.ts`（追加のメッセージ: `normalizeLineFlexItems` / `validateLineFlexItems` / `buildLineFlexPayloads` / `payloadsToPreview` / `itemsToPreview`）。Vitest: `line-flex-templates.test.ts` / `line-flex-items.test.ts`
- サーバー `src/lib/line-flex-service.ts`（`prepareLineFlexMessage` = 検証 → payload 生成。`findLineFlexReplyForText` / `listLineFlexAttachments`）、`src/lib/line-flex-repository.ts`。Vitest: `line-flex-service.test.ts`
- API `GET/POST /api/stores/{storeId}/line-messages`、`GET/PUT/DELETE .../line-messages/{id}`、`POST .../line-messages/{id}/test`（`authorizeStoreAccess`）。計測 `GET /go/{id}/{key}`（認証なし。302）
- UI `src/components/line-flex/`（`LineFlexPanel` = 一覧 + 使い方、`LineFlexEditorDialog` = 編集、`FlexPreview` = HTML 近似プレビュー）
- Webhook `src/app/api/webhooks/line/route.ts`: 既存コマンド（予約確認 / キャンセル / 予約フォーム）の後にキーワード応答。【ご予約確認】の reply に `attach_confirm` の payload を続ける（`replyRawMessages`）
- Edge Function `send-reminders` / `send-follow-messages`: `loadFlexAttachments()` で店舗ごとの payload を読み、push の messages に追加（本体と合わせて最大 5 通）。**デプロイが必要**（`supabase functions deploy send-reminders` / `send-follow-messages`）

## 制限・注意

- Flex JSON 30KB / カルーセル 12 枚 / altText 400 文字 / 1 回の送信 5 通（LINE の仕様）
- 画像は https のみ（`/api/upload/menu-image`。`menuId = flex_{id}_{slot}`）
- 公式 LINE 管理画面の「応答メッセージ」で同じキーワードを設定していると両方届く
- プレビューは HTML による近似（iPhone の実機スクショを計測して合わせている: バブル幅・角丸・行の高さ・日本語は英数字の 92% の大きさ）。絵文字は閲覧している端末の絵柄になる。正確な見た目は「テスト送信」で確認
- 見出し名や URL を変えて保存し直すと payload と計測リンクが作り直される（タップ数のキーは URL の出現順）
