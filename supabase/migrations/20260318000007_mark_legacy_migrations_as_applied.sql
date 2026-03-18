-- レガシーマイグレーションを「適用済み」としてマーク
-- 背景: 旧マイグレーションは execute_sql で直接 DB に適用したため
--       supabase_migrations.schema_migrations に記録が残っていない。
--       apply_migration ツールが「未適用」と判断して再実行しようとすると
--       forms テーブル（→ reservation_forms にリネーム済み）への参照で失敗する。
-- 対策: 旧マイグレーションを tracking table に INSERT して再実行を防ぐ。

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES
  ('20250101000000', '20250101000000_initial_schema',                                   NULL),
  ('20250116000000', '20250116000000_update_draft_status',                              NULL),
  ('20250125000000', '20250125000000_add_survey_forms',                                 NULL),
  ('20250127000000', '20250127000000_add_stores_columns',                               NULL),
  ('20250128000000', '20250128000000_sync_production_with_staging',                     NULL),
  ('20250129000000', '20250129000000_change_store_id_to_6chars',                        NULL),
  ('20250130000000', '20250130000000_change_stores_id_to_text',                         NULL),
  ('20250131000000', '20250131000000_remove_store_id_default',                          NULL),
  ('20250131000001', '20250131000001_rename_rls_policies_to_english',                   NULL),
  ('20250201000000', '20250201000000_add_reservation_analysis_columns',                 NULL),
  ('20250202000000', '20250202000000_safe_add_forms_status',                            NULL),
  ('20250202000001', '20250202000000_add_subdomain_columns',                            NULL),
  ('20250203000000', '20250203000000_add_line_user_id_to_reservations_surveys',         NULL),
  ('20250204000000', '20250204000000_add_crm_tables',                                   NULL),
  ('20250205000000', '20250205000000_optimize_crm_rls_policies',                        NULL),
  ('20250206000000', '20250206000000_staging_sync_with_dev_schema',                     NULL),
  ('20250211000000', '20250211000000_add_google_calendar_oauth_columns',                NULL),
  ('20250212000000', '20250212000000_add_reservations_google_calendar_event_id',        NULL),
  ('20251204000000', '20251204000000_create_survey_forms',                              NULL),
  ('20260308000000', '20260308000000_remove_subdomain_columns',                         NULL)
ON CONFLICT (version) DO NOTHING;
