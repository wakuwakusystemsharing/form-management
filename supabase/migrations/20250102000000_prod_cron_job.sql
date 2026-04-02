-- Prod 用: pg_cron ジョブ作成
-- 前提: Supabase Dashboard → Database → Extensions で pg_cron と pg_net を有効化してから実行
--
-- 毎日 10:00 UTC (19:00 JST) に予約リマインダーを送信
-- pg_cron が無効な環境（Preview Branch 等）ではスキップ
--
-- 注意: Authorization ヘッダーに Service Role Key が必要。
-- このマイグレーションは初期セットアップ用テンプレート。
-- 実際の運用では Dashboard の SQL Editor から Service Role Key を直接指定して
-- cron.schedule() を実行すること。

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'send_reservation_reminders',
      '0 10 * * *',
      $cmd$
        SELECT net.http_post(
          url := 'https://tpuqjpdaasxfwsvjcbum.supabase.co/functions/v1/send-reminders',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
          )
        );
      $cmd$
    );
  END IF;
END $$;
