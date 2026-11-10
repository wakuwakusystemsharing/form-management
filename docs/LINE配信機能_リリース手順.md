# LINE 配信機能 リリース手順

「配信」タブ（セグメント配信）を staging → 本番で動かすまでの手順です。仕様は `docs/LINE配信機能_仕様書.md`。
既存の予約リマインダー（`send-reminders`）・フォローメッセージ（`send-follow-messages`）の Function と cron には触れません。

## 全体の流れ（環境ごとに 1 → 4 の順）

| ステップ | やること | 備考 |
|---|---|---|
| 1 | マイグレーション `20261113000000_add_broadcasts.sql` を適用 | PR 1 で追加。staging は適用済み |
| 2 | Edge Function `send-broadcasts` をデプロイ | PR 2 で追加（新規） |
| 3 | pg_cron ジョブ `send_broadcasts`（5 分おき）を登録 | **Dashboard から手動**（マイグレーションには含めない） |
| 4 | PR をマージ → 管理画面で動作確認 | |
| 5 | （PR 3）自動配信の cron `run_broadcast_automations` を登録 | **本番のみ**。下の「自動配信の cron 登録」 |

マイグレーションより先にコードをマージしても、配信タブを開いたときにエラーが出るだけで他の機能には影響しません。
ただし LINE Webhook が「配信停止」の判定で `stores.broadcast_*` を読むため（失敗時は素通しする作りです）、**マイグレーションを先に**適用してください。

---

## ステップ 1: マイグレーション

Supabase Dashboard → SQL Editor で `supabase/migrations/20261113000000_add_broadcasts.sql` を実行。

**確認:**
```sql
select table_name from information_schema.tables
 where table_name like 'broadcast%' order by 1;
-- broadcast_automation_sends / broadcast_automations / broadcast_recipients / broadcast_stickers / broadcasts の 5 行

select column_name from information_schema.columns
 where table_name = 'stores' and column_name like 'broadcast_%' order by 1;
-- 5 行

select column_name from information_schema.columns
 where table_name = 'customers' and column_name = 'line_opt_out_at';
-- 1 行
```

## ステップ 2: Edge Function のデプロイ

```bash
supabase functions deploy send-broadcasts --project-ref <プロジェクト ID>
# staging: ohplaysshllkinaiqksb / production: tpuqjpdaasxfwsvjcbum
```

**確認:** Dashboard → Edge Functions に `send-broadcasts` が並ぶ。手動で 1 回叩く:

```bash
curl -X POST https://<プロジェクト ID>.supabase.co/functions/v1/send-broadcasts \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>"
# → {"broadcasts":0,"sent":0,"failed":0,"busy":0,"message":"対象なし"}
```

## ステップ 3: pg_cron ジョブの登録

**必ず Dashboard から手動で登録します**（テンプレートの URL・仮キーがそのまま登録される事故を防ぐため。`docs/フォローメッセージ_リリース手順.md` と同じ方針）。
`<SERVICE_ROLE_KEY>` は **そのプロジェクトの** Service Role Key（`eyJ` で始まる JWT 形式）、URL も **そのプロジェクトの ID** にしてください。

```sql
select cron.unschedule('send_broadcasts');  -- 既に登録済みなら削除（無ければエラーになるが無視してよい）

select cron.schedule(
  'send_broadcasts',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := 'https://<プロジェクト ID>.supabase.co/functions/v1/send-broadcasts',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
      ),
      timeout_milliseconds := 60000
    );
  $$
);
```

**確認:**
```sql
select jobname, schedule, active,
       substring(command from 'https://[^/ ]+supabase[.]co') as target_origin,
       position('<SERVICE_ROLE_KEY>' in command) > 0 as placeholder_key
  from cron.job where jobname = 'send_broadcasts';
-- schedule = */5 * * * *  target_origin = このプロジェクトの URL  placeholder_key = false
```

cron を登録しなくても「今すぐ送る」は動きます（管理画面の API が Edge Function を直接起こすため）。
**日時指定の予約配信と、途中で止まった配信の続きは cron が無いと送られません。**

## ステップ 4: 動作確認

1. テナント側 店舗ページ → 「配信」タブ（または店舗管理者ページ → 「配信」）を開く
2. 「新しい配信」→ 配信先に自分だけが入るタグを指定（顧客管理で自分にテスト用のタグを付けておく）→ 人数が 1 人になることを確認
3. メッセージにテキスト（`{name}さん、テストです`）を追加 → 「テスト送信」で自分に届くこと
4. 「今すぐ送る」→ 確認 → 数十秒〜数分で届くこと。一覧が「送信済み」「送信 1」になること
5. 「日時を指定」で 10 分後に予約 → 一覧に「予約済み」→ 時刻の 5 分以内に届くこと
6. 自分の LINE から「配信停止」と送る → 停止の返信が来る → 新しい配信の人数から外れる（「配信停止 1 人は除いています」）→ 「配信再開」で戻る

**確認用 SQL:**
```sql
select id, name, status, recipient_count, sent_count, failed_count, error, scheduled_at, finished_at
  from broadcasts order by created_at desc limit 5;

select status, count(*) from broadcast_recipients
 where broadcast_id = '<配信 ID>' group by 1;
```

## 自動配信（ステップ配信）の cron 登録（PR 3）

自動配信は、毎時 1 回「実行時刻を過ぎた店舗の ON のルール」を判定して配信を作ります。判定は Next.js の API
（`POST /api/cron/broadcast-automations`）で行い、送信は既存の `send-broadcasts` が行います。
マイグレーションと Edge Function の追加はありません（PR 1 のテーブルをそのまま使います）。

### 本番（production）

PR 3 を main にマージしたあと、**本番の** Supabase Dashboard → SQL Editor で登録します。
`<SERVICE_ROLE_KEY>` は本番の service_role キー（`eyJ` で始まる。`send_broadcasts` の登録で使ったものと同じ）です。
API 側は、このキーが Vercel の環境変数 `SUPABASE_SERVICE_ROLE_KEY` と一致するときだけ実行します。

```sql
select cron.unschedule('run_broadcast_automations');  -- 既に登録済みなら削除（無ければエラーになるが無視してよい）

select cron.schedule(
  'run_broadcast_automations',
  '2 * * * *',
  $$
    select net.http_post(
      url := 'https://nas-rsv.com/api/cron/broadcast-automations',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
      ),
      timeout_milliseconds := 30000
    );
  $$
);
```

**確認:**
```sql
select jobname, schedule, active,
       substring(command from 'https://[^/ ]+') as target_origin,
       position('<SERVICE_ROLE_KEY>' in command) > 0 as placeholder_key
  from cron.job where jobname = 'run_broadcast_automations';
-- schedule = 2 * * * *  target_origin = https://nas-rsv.com  placeholder_key = false

-- 1 時間ほど待ってから、呼び出しが成功しているか（status_code = 200）
select id, status_code, left(content, 200) as content, created
  from net._http_response order by created desc limit 5;
```

`status_code` が 401 のときはキーが違います（本番の service_role を使っているか確認）。404 のときは PR 3 がまだ本番に反映されていません。

### staging

staging の Vercel（`form-management-staging.vercel.app`）は Vercel のログイン保護（Deployment Protection）がかかっていて、
Supabase の cron から API を呼べません（ログイン画面に転送されます）。そのため **staging では cron を登録しません**。
動作確認は、配信タブ → 「自動配信」→ **「今日の判定を今すぐ実行」** ボタンで行います（実行時刻を待たずに同じ処理を動かします）。

### 動作確認（staging / 本番共通）

1. 配信タブ → 「自動配信」→ テンプレート「タグが付いたとき」を選ぶ
2. テスト用のタグ（自分だけに付けたもの）を選ぶ → 「いま ON にすると、次の判定で 1 人に送られます」と出ることを確認
3. メッセージを追加 → 「このルールを ON にする」にチェック → 保存
4. 「今日の判定を今すぐ実行」→ 数十秒〜数分で届く。配信一覧に「【自動】…」「自動配信」のバッジで並ぶ
5. もう一度「今日の判定を今すぐ実行」を押しても、同じ人には送られない（「今日の判定はすでに済んでいます」）
6. 確認が終わったらルールを OFF にするか削除する

## 配信の設定（PR 3）

配信タブ → 「設定」で、公式 LINE の今月の通数（LINE の API から取得）、月間上限、配信停止 / 再開のキーワード、自動配信を判定する時刻を変更できます。
既定値は 上限なし /「配信停止」「配信再開」/ 10:00 です。

## 友だち登録だけの人にも配信する（2026-11-10 追加）

予約もアンケートもしていない LINE 友だちを、顧客管理へ「LINE 友だち（予約なし）」として自動登録する機能です。

**リリース時の作業（環境ごと）**
1. マイグレーション `supabase/migrations/20261114000000_add_customer_line_friend_only.sql` を適用（`customers.line_friend_only` 列を足すだけ。**コードより先に**）
2. PR をマージ（Edge Function・cron・環境変数の変更なし）

**確認:**
```sql
select column_name from information_schema.columns
 where table_name = 'customers' and column_name = 'line_friend_only';   -- 1 行

-- 自動登録された友だちの人数（店舗ごと）
select store_id, count(*) from customers where line_friend_only group by 1 order by 2 desc;
```

**動作確認**
1. まだ顧客管理に登録の無い LINE アカウントで、店舗の公式 LINE に何か送る（または友だち追加する）
2. 顧客管理 → 「LINE 友だちのみも表示」にチェック → LINE の表示名で「LINE 友だち（予約なし）」として出る
3. 配信タブ → 「新しい配信」の人数に含まれる。設定の「友だち登録だけのお客様」の人数が増える
4. 認証済みアカウントの店舗は、配信タブ → 設定 → 「友だちを取り込む」で既存の友だちを一括登録できる（未認証アカウントは案内文が出る）
5. その LINE アカウントで予約すると、通常の顧客に切り替わる（名前が予約時のものになり、「LINE 友だちのみも表示」を外しても一覧に出る）

**注意**: 自動登録は Webhook（`/api/webhooks/line`）が受けたイベントで行います。公式 LINE の Webhook URL がこのシステムに向いていない店舗では登録されません。

## 友だちなのに配信先から外れる不具合の修正（2026-11-10 追加）

**リリース時の作業（環境ごと）**
1. マイグレーション `supabase/migrations/20261115000000_add_customer_line_blocked_at.sql` を適用（`customers.line_blocked_at` 列を足すだけ。**コードより先に**）
2. PR をマージ（Edge Function・cron・環境変数の変更なし）

**動作確認**
1. 配信の編集画面を開き直す → 以前「友だちでない N 人は除いています」で 0 人だった条件で、人数が出る。「うち N 人は友だち追加の記録がありません。送信するときに LINE へ確認し…」と表示される
2. 「今すぐ送る」→ 友だちなら届く。顧客詳細の LINE タブの「友だち追加」が「友だち」に変わる
3. 友だちでない人（未追加・ブロック）が含まれていた場合は、その人だけ自動で外れ、顧客詳細は「ブロック中」になる

## 店舗管理者ページのタブについて

「配信」タブは他のタブと同じく、`stores.admin_visible_tabs` が未設定（すべて表示）の店舗では**店舗管理者にも最初から表示されます**。
見せたくない店舗は、テナント側 店舗ページ → 設定 → 「店舗管理者に表示するメニュー」で「配信」を OFF にしてください。

## スタンプ（共通の同梱イラスト）の登録

共通スタンプは `broadcast_stickers` の `store_id` が NULL の行です。画像（正方形 PNG / JPEG、https で配信できる URL）を用意して登録します。

```sql
insert into broadcast_stickers (store_id, label, url, preview_url, sort) values
  (null, 'ありがとうございました', 'https://…/thanks.png', 'https://…/thanks_240.png', 1),
  (null, 'はじめまして',           'https://…/welcome.png', 'https://…/welcome_240.png', 2);
```

店舗ごとのスタンプは「配信」タブ → 「スタンプ・素材」から追加できます。
