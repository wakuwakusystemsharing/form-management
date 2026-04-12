-- ==========================================
-- pg_cron ジョブを毎時実行に変更
-- 店舗ごとの reminder_time に合わせて Edge Function が判定
-- ==========================================
-- 注意: 実際の運用では Dashboard の SQL Editor から Service Role Key を直接指定して実行すること。

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- 旧ジョブを削除
    PERFORM cron.unschedule('send_reservation_reminders');

    -- 毎時0分に実行（Edge Function側で店舗ごとの送信時刻を判定）
    PERFORM cron.schedule(
      'send_reservation_reminders',
      '0 * * * *',
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
