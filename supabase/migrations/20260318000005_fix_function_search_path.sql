-- update_updated_at_column 関数の search_path を固定
-- search_path が可変だと search_path injection のリスクあり（Supabase Security Advisor 検出）

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;
