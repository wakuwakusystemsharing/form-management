-- ==========================================
-- Add missing columns to stores table
-- These columns are required by the application code
-- ==========================================

-- Add missing columns
ALTER TABLE stores 
ADD COLUMN IF NOT EXISTS owner_name TEXT,
ADD COLUMN IF NOT EXISTS owner_email TEXT,
ADD COLUMN IF NOT EXISTS phone TEXT,
ADD COLUMN IF NOT EXISTS address TEXT,
ADD COLUMN IF NOT EXISTS website_url TEXT,
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive'));

-- Update existing rows to have default values (if any exist)
UPDATE stores 
SET 
  owner_name = COALESCE(owner_name, ''),
  owner_email = COALESCE(owner_email, ''),
  phone = COALESCE(phone, ''),
  address = COALESCE(address, ''),
  website_url = COALESCE(website_url, ''),
  status = COALESCE(status, 'active')
WHERE owner_name IS NULL OR owner_email IS NULL OR status IS NULL;

-- Make owner_name and owner_email NOT NULL after setting defaults
ALTER TABLE stores 
ALTER COLUMN owner_name SET NOT NULL,
ALTER COLUMN owner_email SET NOT NULL,
ALTER COLUMN status SET NOT NULL;

-- Add index for status if needed
CREATE INDEX IF NOT EXISTS idx_stores_status ON stores(status);

COMMENT ON COLUMN stores.owner_name IS 'オーナー名';
COMMENT ON COLUMN stores.owner_email IS 'オーナーメールアドレス';
COMMENT ON COLUMN stores.phone IS '電話番号';
COMMENT ON COLUMN stores.address IS '住所';
COMMENT ON COLUMN stores.website_url IS 'ウェブサイトURL';
COMMENT ON COLUMN stores.status IS '店舗ステータス (active/inactive)';

