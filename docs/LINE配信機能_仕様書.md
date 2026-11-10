# 公式 LINE 配信機能（セグメント配信 / 自動配信）仕様書（案）

店舗管理者ページ（`/{storeId}/admin`）とテナント側 店舗ページに **「配信」タブ** を追加し、公式 LINE の友だち（= LINE 連携済みの顧客）へ、顧客管理のタグや予約したメニューなどで絞り込んだ相手にだけメッセージを送れるようにする。
送る内容は「LINE メッセージ」タブで作った Flex Message、テキスト、画像、動画、オリジナルのスタンプ風イラストを組み合わせる（1 回 5 通まで）。

> 状態: **仕様確定（2026-11-10）**。実装は §14 の PR 単位で進める。変更があれば §13 に追記する。

---

## 1. 背景と目的

- 公式 LINE 管理画面の「メッセージ配信」は、絞り込みが LINE 側の属性（性別・年齢・OS など）に限られ、**このシステムが持っている情報（タグ / 来店回数 / 予約したメニュー / アンケートの回答）では絞り込めない**
- 本システムには顧客台帳（`customers`）、予約（`reservations`）、来店（`customer_visits`）、アンケート回答（`surveys`）、タグがそろっており、これで絞り込めば「カラーを予約したことがある人にだけ新色の案内」「3 か月来ていない人にだけ再来店クーポン」ができる
- 店舗の LINE チャネルアクセストークン（`stores.line_channel_access_token`）で Messaging API の push / multicast を既に使っている（リマインダー・フォロー・LINE メッセージのテスト送信）ので、送る仕組みの土台はある

### LINE の前提（設計上の制約）

| 項目 | 内容 |
| --- | --- |
| 無料通数 | push / multicast は **月の無料通数**を消費する（コミュニケーションプランは 200 通 / 月。ライトプラン 5,000 通、スタンダードプラン 30,000 通 + 従量）。**1 人に 5 通送っても 1 通として数える**（「宛先 × 送信回数」で数える） |
| 1 回の送信 | messages は最大 5 通 |
| 宛先 | multicast は 1 リクエスト最大 500 ユーザー。友だちでない（ブロック中の）ユーザーには届かないが**通数には数えない**（LINE 側で除外される） |
| 送れるもの | テキスト（5000 文字）/ 画像（https の JPEG・PNG、本体 10MB・サムネイル 1MB）/ 動画（https の mp4、200MB、サムネイル必須）/ Flex / LINE 公式スタンプ（`sticker`。LINE 提供の既定セットのみ。**独自画像はスタンプとして送れない** → 画像メッセージとして送る） |
| レート | multicast 2,000 リクエスト / 分。`X-Line-Retry-Key` で再送時の重複防止 |
| 配信停止 | LINE にはユーザー単位のオプトアウト機能が無い。こちらで「配信停止」を管理し、送らないようにする必要がある |

---

## 2. 機能一覧（第 1 弾 / 第 2 弾）

| # | 機能 | 第 1 弾 | 内容 |
| --- | --- | :-: | --- |
| A | 配信の作成（1 回配信） | ◯ | 配信先の条件 + メッセージ（最大 5 通）を作り、**今すぐ** または **日時指定** で送る |
| B | 配信先の絞り込み | ◯ | タグ / セグメント / 予約したメニュー・フォーム / 来店状況 / 属性（性別・誕生月・アンケート回答）を **AND で組み合わせ**（タグは AND / OR 切替）。該当人数をその場で表示 |
| C | メッセージの構成 | ◯ | LINE メッセージタブの Flex（保存済みから選ぶ）/ テキスト / 画像 / 動画 / スタンプ風イラスト / Flex（JSON）を並べる。「LINE メッセージ」タブの「送る内容の並び」と同じ部品を使う |
| D | スタンプ風イラスト 10 種 | ◯ | サロン向けのオリジナルイラスト（Codex で生成）を同梱。画像メッセージとして送る。店舗が自分のイラストを追加アップロードも可 |
| E | 見積り + 上限ガード | ◯ | 送信前に「対象 N 人 × 1 通 = N 通消費」を表示。店舗ごとの**月間上限**（任意。既定 なし）を超える配信は確認ダイアログ → 超過分は送らない設定も可。今月の配信済み通数を表示 |
| F | テスト送信 / 下書き / 複製 | ◯ | 自分の LINE に送って確認。途中保存。過去の配信をコピーして再利用 |
| G | 配信履歴 + タップ計測 | ◯ | いつ・何人に・何通・成功 / 失敗、ボタンのタップ数（`/go/` 計測リンク）。配信ごとに「対象者一覧」を見られる |
| H | 配信停止（オプトアウト） | ◯ | お客様が「配信停止」と送ると以後の配信から除外（Webhook）。「配信再開」で戻す。顧客詳細にも手動の切替。自動メッセージ（予約確認・リマインダー・フォロー）は**対象外**（予約に伴う連絡なので送る） |
| I | 自動配信（ステップ配信） | ◯ | 条件を満たした人へ自動で送る: 休眠 N 日 / 誕生月 / 初回来店 N 日後 / 来店 N 回目 / タグが付いたとき。1 人 1 ルール 1 回（または N 日に 1 回） |
| J | 繰り返し配信 | ✕ | 毎月◯日などに同じ内容。第 2 弾 |
| K | A/B テスト | ✕ | 第 2 弾 |
| L | テナント管理者の承認制 | ✕ | 第 2 弾（必要なら） |

---

## 3. 画面

### 3-1. 配置

- **店舗管理者ページ** `/{storeId}/admin?tab=broadcasts`: サイドバー / 下部ナビに「配信」（`StoreAdminTabId` に `broadcasts` を追加。`admin_visible_tabs` で非表示にできる。顧客管理 OFF の店舗では条件に顧客の項目が使えないので、`customers` に連動して隠す）
- **テナント側 店舗ページ** `/tenant/{slug}/admin/{storeId}`: 「LINE メッセージ」と「設定」の間に「配信」タブ（同じコンポーネント）
- 「このページの使い方」（`StoreAdminGuide`）に配信タブの説明を追加

### 3-2. 配信タブの構成

```
[使い方（折りたたみ）]
[今月の配信: 120 / 上限 500 通（残り 380）]  [配信停止 3 人]        [＋ 新しい配信]
タブ: [配信一覧] [自動配信] [スタンプ・素材] [設定]

配信一覧（新しい順）
  ┌ 11/20 19:00 予約  「年末キャンペーン」 対象 84 人  状態: 予約済み  [編集][複製][取消]
  ┌ 11/10 送信済み     「新色カラーのご案内」 84 人 → 成功 82 / 失敗 2  タップ 31  [詳細][複製]
  ┌ 下書き            「休眠のお客様へ」 …
```

### 3-3. 配信の作成（`BroadcastEditorDialog`。スマホは `MobileSheet` で全画面）

左右 2 列（スマホは縦）。右は「LINE メッセージ」と同じスマホ枠プレビュー（複数通をそのまま表示）。

1. **基本**: 配信名（管理用）
2. **配信先**（§4）: 条件を足していく UI。「よく使う条件」をチップで先頭に（すべての友だち / タグ / セグメント / 最終来店 N 日以上前 / メニュー）。条件を変えるたびに **該当人数** を API で再計算して表示（`GET …/broadcasts/estimate`）。「対象者を見る」で名前一覧（LINE 表示名）
3. **メッセージ**（§5）: 「＋ 保存済みの LINE メッセージ」「＋ テキスト」「＋ 画像」「＋ 動画」「＋ スタンプ」「＋ Flex（JSON）」。↑↓ で並べ替え。最大 5 通
4. **送るタイミング**: 「今すぐ送る」/「日時を指定」（15 分刻み。JST）
5. **送信前の確認**（送信ボタンを押すと）: 「84 人に 3 通ずつ送ります（無料通数の消費: 84 通）。今月の残り: 380 通 → 送信後 296 通」。上限を超える場合は赤で表示し、`broadcast_settings.over_limit = 'block'` ならボタンを無効、`'confirm'` なら確認チェックを入れて送れる
6. 下部: [下書き保存] [テスト送信] [予約する / 今すぐ送る] [閉じる]

### 3-4. 自動配信（`BroadcastAutomationList`）

ルールの一覧（ON / OFF、対象の定義、メッセージ、直近 30 日の送信数）。新規作成はテンプレートから:

| テンプレート | 条件（既定値） | 送る内容の例 |
| --- | --- | --- |
| 休眠のお客様へ | 最終来店から **90 日**経過（以後 180 日は再送しない） | 再来店クーポン（LINE メッセージのクーポンカード） |
| お誕生日月 | 誕生月の **1 日 10:00**（`customers.birthday`） | バースデークーポン |
| 初回来店のお礼 | 初回来店から **7 日後**（フォローメッセージと重なる店舗は OFF 推奨） | お礼 + 次回予約の導線 |
| 来店 N 回目 | `total_visits` が **5 / 10** に到達した翌日 | VIP 向けの案内 |
| タグが付いたとき | 指定タグが付いた当日（アンケートの選択肢タグ・予約のカスタム項目タグと連動） | タグに応じた案内（例: 「縮毛矯正に興味」→ 縮毛矯正の紹介） |

判定は **店舗ごとの実行時刻**（既定 10:00 JST。Edge Function は毎時 0 分に動き、時刻を過ぎた店舗だけ 1 日 1 回判定）。各ルールに「同じきっかけでは 1 回だけ / 次に送るまで最短 N 日あける」「配信先の追加条件（タグなど）」を付けられる。

**一斉送信の防止**: 日数で決まるきっかけ（休眠 / 初回来店 N 日後 / 来店 N 回目）は「到達してから 14 日以内」の人だけが対象（`AUTOMATION_WINDOW_DAYS`）。ルールを ON にした日に、何年も前から休眠している人へ一斉に送ることはない（そういう相手には 1 回配信で「最終来店 N 日以上前」を使う）。タグは付いた日が分からないため、ON にした時点でタグが付いている人にも送る（ON にする前に該当人数を表示する）。送る前に上限ガードを通す（上限超過時はスキップして履歴に「上限のため見送り」）。

### 3-5. スタンプ・素材（`BroadcastStickerPanel`）

- 同梱 10 種（§6）をグリッド表示。店舗が自分の画像を追加（`/api/upload/menu-image`、`menuId = sticker_{storeId}_{n}`。正方形推奨 512×512、PNG 透過可）
- 配信のメッセージで「＋ スタンプ」を押すとここから選ぶ（画像メッセージとして送られる旨を注記）

### 3-6. 設定

- 月間上限（通数。空 = 制限なし）/ 超えたとき（確認して送れる / 送れない）
- 配信停止の受付キーワード（既定「配信停止」「配信再開」。変更可）と返信文
- 送信元の確認（チャネルアクセストークンの有無。未設定なら赤い警告）

---

## 4. 配信先の条件（セグメント）

### 4-1. 対象の母集団

`customers` のうち **`line_user_id` がある** かつ **配信停止でない**（`line_opt_out_at IS NULL`）顧客。`line_friend_flag = false`（ブロック中）は人数見積りから除外（LINE 側でも届かないため）。

### 4-2. 条件の種類（JSON で保存。`BroadcastAudience`）

```ts
interface BroadcastAudience {
  tags?: { mode: 'any' | 'all'; values: string[] };        // タグ（いずれか / すべて）
  exclude_tags?: string[];                                  // このタグが付いている人は除外
  segments?: Array<'new' | 'repeat' | 'vip' | 'dormant'>;   // 自動セグメント（customer-utils の判定と同じ）
  menus?: { mode: 'any'; names: string[]; within_days?: number }; // 予約したメニュー名（カテゴリー > メニュー > サブメニュー の表示名で照合。直近 N 日以内）
  forms?: string[];                                         // 予約したフォーム ID
  last_visit?: { min_days_ago?: number; max_days_ago?: number }; // 最終来店（例: 90 日以上前 / 30 日以内）
  visits?: { min?: number; max?: number };                  // 来店回数
  upcoming_reservation?: boolean;                           // 今後の予約が ある / ない
  gender?: Array<'male' | 'female' | 'other'>;
  birth_month?: number[];                                   // 誕生月（1〜12）
  survey?: { form_id: string; question: string; options: string[] }; // アンケートで特定の選択肢を選んだ人
  customer_ids?: string[];                                  // 個別指定（追加 / 除外に使う）
  exclude_customer_ids?: string[];
}
```

- 種類の違う条件は **AND**（例: タグ「カラー」 AND 最終来店 60 日以上前）。同じ種類の中は値で OR（タグだけ AND / OR を選べる）
- 何も指定しない = すべての友だち
- **評価は純粋ロジック** `src/lib/broadcast-audience.ts` の `matchAudience(customer, facts, audience)` と、Supabase 用のクエリ組み立て `buildAudienceQuery()`。メニュー・フォーム・アンケートは `reservations` / `surveys` から顧客ごとの事実（`facts`）を先に集めてから判定（1 店舗の顧客は数千件規模なので全件取得 → メモリ判定で十分。1000 件ずつページング）
- メニュー名は予約の `selected_menus[].name`（サブメニューは `submenu_name`）と `customer_visits.treatment_menus` の両方を見る（予約分析の「名前でまとめる」と同じ考え方）
- 見積り API は人数と、先頭 20 人の表示名を返す（全員の一覧は「対象者を見る」で別途ページング）

---

## 5. メッセージの構成

- 「LINE メッセージ」タブの `LineFlexItem`（`src/lib/line-flex-items.ts`）を**そのまま再利用**し、種類を 1 つ足す:
  - `ref`（保存済みの LINE メッセージ。その `payloads` を展開 = Flex 本体 + その追加メッセージ。合計 5 通に収まる範囲）
  - `text` / `image` / `video` / `flex`（JSON）
  - **`sticker`**（新規。`{ type: 'sticker', sticker_id: string }` → 送信時は画像メッセージ `{ type: 'image', originalContentUrl, previewImageUrl }` に展開）
- 配信には `main` が無い（Flex 本体は `ref` で入れる）ので、`normalizeLineFlexItems` に `allowNoMain` オプションを追加する
- 差し込み文字（第 1 弾は最小限）: テキスト内の `{name}` を顧客名（無ければ LINE 表示名、それも無ければ「お客様」）に置き換える。**差し込みがあると 1 人ずつ push**（multicast は全員同じ内容のため）。無ければ multicast で 500 人ずつ
- 保存時に `payloads`（差し込み無しのとき）を組み立て、計測リンクは `/go/b/{broadcastId}/{key}` で配信ごとに数える（既存の `/go/{id}/{key}` は LINE メッセージ用。配信用のプレフィックス `b` を追加）
- プレビューは `FlexPreview` の `messages` で複数通を表示（実装済み）

---

## 6. スタンプ風イラスト 10 種（Codex で画像生成）

画像メッセージとして送るため、**正方形 1024×1024 PNG**（透過なし。LINE の画像は角丸で表示されるので背景色あり）で用意し、`public/stickers/` または Supabase Storage（`stickers/common/{id}.png`）に置く。サムネイル用に 240×240 も生成。

| id | 用途 | 文言（イラスト内） | トーン |
| --- | --- | --- | --- |
| thanks | 来店のお礼 | ありがとうございました | 笑顔のスタイリストがお辞儀 |
| welcome | 新規の挨拶 | はじめまして！ | 手を振る |
| reminder | 予約前日 | 明日お待ちしています | カレンダーとハサミ |
| see_you | 次回予約の案内 | またお待ちしています | ドアで見送り |
| sale | キャンペーン | SALE / キャンペーン中 | 吹き出し・キラキラ |
| new_menu | 新メニュー | NEW MENU | メニューボードに「NEW」 |
| birthday | 誕生日 | Happy Birthday | ケーキ・風船 |
| holiday | 休業のお知らせ | お休みのお知らせ | 「CLOSED」札 |
| rainy | 天候・季節の挨拶 | 雨の日もお待ちしています | 傘 |
| sorry | お詫び・変更連絡 | ご迷惑をおかけします | 頭を下げる |

- 生成プロンプトの方針: フラットなベクター風、線は太め、2〜3 色 + 白、人物は性別・年齢が特定されにくいデフォルメ、**文字は日本語を画像に含めない**（生成 AI の日本語は崩れやすい）→ 文字は後から画像合成（`sharp` で Noto Sans JP を重ねる）か、文字なしイラストにして送るテキストで補う。**おすすめ: 文字なし + 絵だけ**（サロンの業種を問わず使える）
- 業種の違い（美容室 / ネイル / エステ / 整体 / 旅館）を考え、第 1 弾は業種を特定しない汎用の絵柄にする。業種別セットは第 2 弾
- 店舗が追加したイラストは `broadcast_stickers`（store_id, url, label）に保存

---

## 7. 送信の仕組み

### 7-1. 流れ（1 回配信）

```
作成・保存（status: draft）
 → 「予約する / 今すぐ送る」: サーバーで条件を評価して対象者を確定 → broadcast_recipients に 1 人 1 行（pending）
   見積りとの差（その間に友だちが増減）は確定時の人数で上書き。上限ガードもここで判定
 → status: scheduled（scheduled_at = 指定日時 or now）
 → Edge Function send-broadcasts（pg_cron 5 分おき）が scheduled_at <= now の配信を取り、
   recipients を 500 人ずつ multicast（差し込みありは 1 人ずつ push）。行ごとに sent / failed を記録
   途中で止まっても再開できるよう、配信は claimed_at で確保し、recipients の pending だけを続きから送る
 → 全員終わったら status: sent（failed_count を集計）
```

- 取り消し: `scheduled` の間は取り消せる（`cancelled`）。送信中（`sending`）の中断は第 1 弾では無し
- 再送防止: multicast の `X-Line-Retry-Key` に `{broadcastId}:{batchNo}` の UUID v5
- 1 回の実行は 50 秒まで。残りは次の回（フォローメッセージと同じ方式）
- 送信に失敗した宛先（LINE が 400 で返す無効ユーザー）は `failed` + 理由。トークン無効（401）は配信全体を `failed` にして店舗設定に赤い警告

### 7-2. 自動配信

- Edge Function `run-broadcast-automations`（pg_cron **毎日 10:00 JST** = `0 1 * * *` UTC）。店舗ごとに ON のルールを読み、対象者を評価 → `broadcast_automation_sends`（ルール × 顧客 × **marker** の送信記録）に同じ marker が無い人だけ送る。marker はきっかけの中身を表す文字列（`dormant:{最終来店日}` = 来店して再び休眠したらまた送る / `birthday:{年}` = 毎年 1 回 / `first_visit` / `visits:{回数}` / `tag:{タグ}`。`evaluateAutomationTrigger`）。送信は 1 回配信と同じ `broadcast_recipients` を使う（`broadcasts` に `automation_id` を持つ行を日ごとに 1 件作る = 履歴にも並ぶ）
- フォローメッセージ・リマインダーとは独立（重なりは店舗の運用で避ける。「初回来店のお礼」テンプレートにはフォローメッセージ ON の店舗向けの注意書き）

### 7-3. 配信停止（Webhook）

- `/api/webhooks/line` のテキストコマンドに「配信停止」「配信再開」を追加（店舗設定でキーワード変更可）。該当顧客の `customers.line_opt_out_at` を更新し、固定の返信（「以後の配信を停止しました。予約の確認・リマインダーは引き続きお送りします。再開するには「配信再開」と送ってください」）
- LINE メッセージタブのキーワード自動応答（`findLineFlexReplyForText`）より**先**に判定する。予約語として LINE メッセージのキーワードに登録できないようにする
- 顧客詳細に「配信停止中」バッジと手動の切替。顧客一覧の絞り込みにも追加

### 7-4. 月間通数のカウント

- `broadcast_recipients` の `sent` を店舗 × 月（JST）で集計 = 配信機能で消費した通数（1 人 = 1 通。複数メッセージでも 1）。リマインダー・フォロー・テスト送信・LINE メッセージの差し込みは**含めない**（これらは配信機能の外。設定画面に「他にリマインダー等でも無料通数を使います」と注記）
- LINE の残通数は API（`GET /v2/bot/message/quota/consumption`）で取れるので、設定画面に「LINE 側の今月の消費: N 通 / 上限 M 通」も表示する（第 1 弾で入れる。無料通数の使いすぎを防ぐのが目的なので）

---

## 8. データ

```sql
-- 配信（1 回配信 / 自動配信の日ごとの実行）
broadcasts (
  id UUID PK, store_id TEXT FK, name TEXT,
  status TEXT CHECK (draft / scheduled / sending / sent / cancelled / failed),
  audience JSONB,                 -- §4 の条件
  items JSONB,                    -- §5 の並び（sticker 含む）
  payloads JSONB,                 -- 送信用（差し込み無しのとき）
  has_personalization BOOLEAN,    -- {name} などがある = 1 人ずつ push
  links JSONB, tap_counts JSONB,  -- 計測
  scheduled_at TIMESTAMPTZ, claimed_at TIMESTAMPTZ, started_at, finished_at,
  recipient_count INT, sent_count INT, failed_count INT,
  automation_id UUID NULL FK,     -- 自動配信から作られた行
  created_by UUID,                -- 操作した管理者
  created_at, updated_at
)
broadcast_recipients (
  id UUID PK, broadcast_id UUID FK, customer_id UUID FK, line_user_id TEXT,
  status TEXT CHECK (pending / sent / failed / skipped), error TEXT, sent_at TIMESTAMPTZ,
  UNIQUE (broadcast_id, customer_id)
)
broadcast_automations (
  id UUID PK, store_id TEXT FK, name TEXT, enabled BOOLEAN,
  trigger JSONB,                  -- { type: 'dormant', days: 90 } / { type: 'birthday', day: 1, time: '10:00' } / { type: 'first_visit_after', days: 7 } / { type: 'visits_reached', counts: [5, 10] } / { type: 'tag_added', tags: [...] }
  audience JSONB,                 -- 追加の絞り込み（任意）
  items JSONB, payloads JSONB, has_personalization BOOLEAN,
  resend_after_days INT NULL,     -- NULL = 1 人 1 回だけ
  created_at, updated_at
)
broadcast_automation_sends ( automation_id, customer_id, marker, sent_at, PRIMARY KEY (automation_id, customer_id, marker) )
broadcast_stickers ( id UUID PK, store_id TEXT NULL, label TEXT, url TEXT, preview_url TEXT, sort INT )  -- store_id NULL = 共通 10 種
stores に追加: broadcast_monthly_limit INT NULL, broadcast_over_limit TEXT ('confirm' / 'block'), broadcast_opt_out_keyword TEXT（既定 配信停止）, broadcast_opt_in_keyword TEXT（既定 配信再開）, broadcast_automation_time TEXT（HH:00。既定 10:00）
customers に追加: line_opt_out_at TIMESTAMPTZ NULL
```

- RLS は他の店舗設定と同じ 3 階層（`broadcast_recipients` にも `store_id` を持たせ、月間通数の集計と RLS に使う。`display_name` = `{name}` の差し込み用に確定時の名前を保存）。`broadcast_automation_sends` は service_role のみ。共通スタンプ（`store_id` NULL）はログイン済みなら読める
- マイグレーション: `20261113000000_add_broadcasts.sql`（PR 1 で追加。計測の DB 関数 `broadcast_increment_tap` を含む。`broadcast_automations.last_run_date` = 1 日 1 回の実行管理）
- local は `data/broadcasts.json` 等（送信はしない。見積り・履歴の確認用）
- **cron の登録はマイグレーションに含めない**（既存ルール。`docs/フォローメッセージ_リリース手順.md` と同じ手順で Dashboard から）

---

## 9. API（すべて `authorizeStoreAccess`）

| メソッド / パス | 内容 |
| --- | --- |
| `GET /api/stores/{storeId}/broadcasts?status=` | 一覧（新しい順。今月の消費通数・上限も同梱） |
| `POST /api/stores/{storeId}/broadcasts` | 作成（draft）。body: name / audience / items / scheduled_at |
| `GET / PUT / DELETE /api/stores/{storeId}/broadcasts/{id}` | 取得（対象者の集計付き）/ 更新（draft のみ）/ 削除（draft・cancelled・sent） |
| `POST /api/stores/{storeId}/broadcasts/estimate` | body: audience → `{ count, sample: [{ name, line_display_name }], excluded_opt_out, excluded_blocked }` |
| `GET /api/stores/{storeId}/broadcasts/audience?…&offset=` | 対象者の一覧（ページング） |
| `POST /api/stores/{storeId}/broadcasts/{id}/schedule` | 対象者を確定して予約 / 即時送信（上限ガード。`{ force: true }` で確認済み） |
| `POST /api/stores/{storeId}/broadcasts/{id}/cancel` | 予約の取り消し |
| `POST /api/stores/{storeId}/broadcasts/{id}/test` | 自分（LINE 連携済み顧客）へテスト送信 |
| `POST /api/stores/{storeId}/broadcasts/{id}/duplicate` | 複製（draft で作る） |
| `GET /api/stores/{storeId}/broadcasts/{id}/recipients?status=` | 配信ごとの宛先と結果 |
| `GET / POST /api/stores/{storeId}/broadcast-automations`, `PUT / DELETE …/{id}` | 自動配信ルール |
| `GET / POST / DELETE /api/stores/{storeId}/broadcast-stickers` | 店舗のスタンプ素材 |
| `GET / PUT /api/stores/{storeId}/broadcast-settings` | 上限・キーワード。LINE の quota 消費も返す |
| `PATCH /api/stores/{storeId}/customers/{id}` | `line_opt_out: true / false`（既存 API に項目追加） |
| `GET /go/b/{broadcastId}/{key}` | 計測リンク |

---

## 10. コードの置き場所（予定）

- 型 `src/types/broadcast.ts`
- 純粋ロジック（Vitest）: `src/lib/broadcast-audience.ts`（条件の評価・人数見積り）/ `src/lib/broadcast-items.ts`（`LineFlexItem` の拡張 = sticker、差し込み `{name}`、payloads 組み立て）/ `src/lib/broadcast-quota.ts`（月間集計・上限判定・見積り文）/ `src/lib/broadcast-automation.ts`（トリガーの判定）
- サーバー: `src/lib/broadcast-service.ts` / `broadcast-repository.ts`
- Edge Function: `supabase/functions/send-broadcasts` / `run-broadcast-automations`（Deno。`line_flex` と同じく **payloads をそのまま送る**。差し込みは `{name}` の置換だけ Deno 側で行う）
- UI: `src/components/broadcast/`（`BroadcastPanel` / `BroadcastEditorDialog` / `AudienceEditor` / `BroadcastAutomationList` / `BroadcastStickerPanel` / `BroadcastSettings`）。プレビューは `FlexPreview`、メッセージ並びは `LineFlexEditorDialog` の `ItemsEditor` を共通部品に切り出して使う
- Webhook: 配信停止 / 再開コマンド

---

## 11. 段階的リリース

| 段階 | 内容 | 目安 |
| --- | --- | --- |
| 1 | 型・純粋ロジック（条件評価 / 見積り / 上限）+ テスト、マイグレーション | 設計確定後すぐ |
| 2 | 1 回配信（作成 → 予約 → Edge Function 送信 → 履歴）、配信停止 Webhook、スタンプ 10 種 | |
| 3 | 自動配信（5 テンプレート）、quota 表示、顧客詳細の配信停止切替 | |
| 4 | 第 2 弾: 繰り返し配信、A/B テスト、業種別スタンプ、承認制 | 要望を見て |

リリースのたびに: マイグレーション（staging → production、Dashboard から）→ Edge Function デプロイ → cron 登録（初回のみ）→ マージ。

---

## 12. 制限・注意（店舗向けの説明にも使う）

- 配信は**無料通数を消費**する（1 人 = 1 通。5 通まとめても 1 通）。リマインダー・フォローも同じ枠を使うので、設定画面の消費状況を見ながら使う
- ブロックしている人には届かない（通数は消費しない）。配信停止した人には送らない（予約の確認・リマインダーは送る）
- 対象の判定は**本システムに登録されている情報だけ**（LINE 側の性別・年齢は使えない。予約フォームで性別を選んだ人だけ性別で絞れる）
- 画像・動画は https の URL が必要（動画は mp4 の直リンク。YouTube は不可）
- 予約配信は 5 分おきの実行なので、指定時刻から最大 5 分ほど遅れることがある
- 特定電子メール法は LINE メッセージには直接適用されないが、**配信停止の手段を必ず案内する**（初回配信のフッターに「配信停止」の案内を自動で付けるオプション）

---

## 13. 決定事項 / 未決事項

**決定済み（2026-11-10 ヒアリング）**
- 絞り込み: タグ / セグメント、予約したメニュー・フォーム、来店状況、属性（性別・誕生月・アンケート回答）をすべて入れる
- タイミング: 今すぐ + 日時指定、自動配信（ステップ配信）。繰り返し配信は第 2 弾
- 付加機能: 見積り + 上限ガード、履歴 + タップ計測 + 配信停止、テスト送信 / 下書き / 複製。A/B テストは第 2 弾
- スタンプ: 独自イラスト 10 種を画像メッセージとして送る（LINE 公式スタンプは使わない）

**決定済み（2026-11-10 おすすめ案を採用）**
1. **差し込み文字** `{name}` を第 1 弾に入れる（顧客名 → LINE 表示名 → 「お客様」の順で補う。差し込みがある配信は 1 人ずつ push。2,000 リクエスト / 分の範囲）
2. **月間上限の既定値は「なし」**（任意設定）。LINE の quota 消費を設定画面に表示して残りを見せる
3. **自動配信の実行時刻は店舗ごとに設定可**（`stores.broadcast_automation_time`。既定 10:00。Edge Function は毎時 0 分に動き、その時刻を過ぎた店舗のルールだけ判定）
4. **スタンプは文字なし（絵だけ）**。日本語の文字入れは第 2 弾
5. **配信停止キーワードの既定は「配信停止」「配信再開」**（店舗で変更可。公式 LINE 管理画面の応答メッセージと被らないよう案内文に注記）
6. **店舗管理者も「今すぐ送る」可**。送信前の確認ダイアログで人数・通数・今月の残りを必ず表示し、**100 人超は「送信する」をもう一度押す 2 段階確認**

**実装時に決めたこと（PR 2）**
- **予約の取り消しは「下書きに戻す」**（`cancelled` の状態は使わない）。取り消したあと内容を直してもう一度予約できる。送信が始まった配信（`sending`）は取り消せない
- **編集できるのは下書きだけ**。予約済みを直すときは取り消してから
- **「今すぐ送る」は API が Edge Function `send-broadcasts` を直接起こす**（5 分おきの cron を待たない）。cron は日時指定の予約と、途中で止まった配信の続きを送る
- **対象者・送信用メッセージは予約した時点で確定**する（予約後に友だちになった人・タグが変わった人は反映されない。保存済み LINE メッセージを予約後に編集しても、予約済みの配信の内容は変わらない）
- **「配信」タブは店舗管理者にも最初から表示**（`admin_visible_tabs` 未設定 = すべて表示の既存ルールどおり）。隠す店舗は「店舗管理者に表示するメニュー」で OFF
- 配信停止キーワードは LINE メッセージタブのキーワード自動応答より先に判定し、自動応答のキーワードには登録できない
- テスト送信は配信の通数（今月の配信）には数えない（LINE の無料通数は 1 通使う）
- 設定の変更画面（月間上限・キーワード）は PR 3。それまでは既定値（上限なし /「配信停止」「配信再開」）

**未決**: なし（実装中に出てきたものはここに追記する）

---

## 14. 実装の進め方（段階 1〜3 の作業単位）

§11 の段階ごとに PR を分ける。各 PR は staging → 確認 → main。

| PR | 内容 | マイグレーション / Edge Function |
| --- | --- | --- |
| 1（実装済み） | 型 `src/types/broadcast.ts`、純粋ロジック（`broadcast-audience` / `broadcast-items` / `broadcast-quota` / `broadcast-automation`）+ Vitest、マイグレーション（§8 のテーブル・列・RLS）、`broadcast-repository`（local JSON = `data/broadcast_data.json` / Supabase）。画面・API・送信はまだ無い | マイグレーション 1 本（`20261113000000_add_broadcasts.sql`） |
| 2（実装済み） | 1 回配信: API（一覧 / 作成 / 見積り / 対象者 / 予約 / 取消 / テスト / 複製 / 宛先 / スタンプ）、「配信」タブ（一覧・作成ダイアログ・プレビュー・スタンプ素材）、計測リンク `/go/b/`、配信停止 Webhook + 顧客詳細の切替。共通スタンプ 10 種の画像は未投入（画像ができたら `broadcast_stickers` に登録。手順は `docs/LINE配信機能_リリース手順.md`） | Edge Function `send-broadcasts` 新規 + cron 登録（5 分おき） |
| 3 | 自動配信: ルール API・UI（5 テンプレート）、設定タブ（上限 / 超過時 / キーワード / 実行時刻 / LINE quota 表示）、使い方ガイド、CLAUDE.md | Edge Function `run-broadcast-automations` 新規 + cron 登録（毎時 0 分） |
