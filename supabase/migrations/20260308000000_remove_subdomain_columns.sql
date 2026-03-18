-- サブドメイン・カスタムドメイン機能を削除
-- 関連する制約・インデックス・カラムを全て除去する

ALTER TABLE stores DROP CONSTRAINT IF EXISTS stores_subdomain_unique;
ALTER TABLE stores DROP CONSTRAINT IF EXISTS stores_custom_domain_unique;

DROP INDEX IF EXISTS idx_stores_subdomain;
DROP INDEX IF EXISTS idx_stores_custom_domain;

ALTER TABLE stores DROP COLUMN IF EXISTS subdomain;
ALTER TABLE stores DROP COLUMN IF EXISTS custom_domain;
