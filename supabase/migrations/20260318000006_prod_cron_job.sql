-- Prod 用: pg_cron ジョブ作成
-- 前提: Supabase Dashboard → Database → Extensions で pg_cron と pg_net を有効化してから実行
--
-- Staging 相当の日次リマインダーを Prod にも設定する
-- 毎日 10:00 UTC に予約リマインダーを送信

SELECT cron.schedule(
  'send_reservation_reminders',
  '0 10 * * *',
  $cmd$
    select net.http_post(
      url := 'https://tpuqjpdaasxfwsvjcbum.supabase.co/functions/v1/send-reminders',
      headers := '{"Content-Type":"application/json"}'::jsonb
    );
  $cmd$
);
