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
