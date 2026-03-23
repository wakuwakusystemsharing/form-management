-- Prod 用: pg_cron ジョブ作成
-- 前提: Supabase Dashboard → Database → Extensions で pg_cron と pg_net を有効化してから実行
--
-- 毎日 10:00 UTC に予約リマインダーを送信
-- pg_cron が無効な環境（Preview Branch 等）ではスキップ

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'send_reservation_reminders',
      '0 10 * * *',
      $cmd$
        select net.http_post(
          url := 'https://tpuqjpdaasxfwsvjcbum.supabase.co/functions/v1/send-reminders',
          headers := '{"Content-Type":"application/json"}'::jsonb
        );
      $cmd$
    );
  END IF;
END $$;
