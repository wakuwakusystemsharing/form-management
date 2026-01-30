-- ==========================================
-- Add Subdomain and Custom Domain Columns
-- サブドメインとカスタムドメインカラムの追加
-- ==========================================

-- subdomainカラム追加（UNIQUE制約）
ALTER TABLE stores ADD COLUMN IF NOT EXISTS subdomain TEXT;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS custom_domain TEXT;

-- 既存店舗にサブドメインを自動生成（storeIdと同じ）
UPDATE stores SET subdomain = id WHERE subdomain IS NULL;

-- UNIQUE制約を追加（既存データの更新後に）
-- まず、重複がないことを確認してから制約を追加
DO $$
BEGIN
  -- 重複チェック
  IF NOT EXISTS (
    SELECT 1 FROM stores 
    GROUP BY subdomain 
    HAVING COUNT(*) > 1 AND subdomain IS NOT NULL
  ) THEN
    -- 重複がない場合のみUNIQUE制約を追加
    ALTER TABLE stores ADD CONSTRAINT stores_subdomain_unique UNIQUE (subdomain);
  END IF;
  
  -- custom_domainにもUNIQUE制約を追加（NULL値は許可）
  IF NOT EXISTS (
    SELECT 1 FROM stores 
    GROUP BY custom_domain 
    HAVING COUNT(*) > 1 AND custom_domain IS NOT NULL
  ) THEN
    ALTER TABLE stores ADD CONSTRAINT stores_custom_domain_unique UNIQUE (custom_domain);
  END IF;
END $$;

-- インデックス追加（パフォーマンス向上）
CREATE INDEX IF NOT EXISTS idx_stores_subdomain ON stores(subdomain);
CREATE INDEX IF NOT EXISTS idx_stores_custom_domain ON stores(custom_domain);

-- コメント追加
COMMENT ON COLUMN stores.subdomain IS 'サブドメイン（例: st0001）。UNIQUE制約あり。';
COMMENT ON COLUMN stores.custom_domain IS 'カスタムドメイン（例: myshop.com）。UNIQUE制約あり。';

