-- Staging/Prod 共通: subdomain・custom_domain カラム削除
-- 既存の 20260308000000_remove_subdomain_columns.sql と同内容だが
-- Staging には未適用だったため再発行

ALTER TABLE stores DROP CONSTRAINT IF EXISTS stores_subdomain_unique;
ALTER TABLE stores DROP CONSTRAINT IF EXISTS stores_custom_domain_unique;

DROP INDEX IF EXISTS idx_stores_subdomain;
DROP INDEX IF EXISTS idx_stores_custom_domain;

ALTER TABLE stores DROP COLUMN IF EXISTS subdomain;
ALTER TABLE stores DROP COLUMN IF EXISTS custom_domain;
