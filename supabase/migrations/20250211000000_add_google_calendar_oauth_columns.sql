-- Store Google Calendar OAuth: source (system vs store_oauth) and encrypted refresh token
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS google_calendar_source text NOT NULL DEFAULT 'system'
    CHECK (google_calendar_source IN ('system', 'store_oauth')),
  ADD COLUMN IF NOT EXISTS google_calendar_refresh_token text;

COMMENT ON COLUMN public.stores.google_calendar_source IS 'system: SA-created calendar; store_oauth: store-linked Google account';
COMMENT ON COLUMN public.stores.google_calendar_refresh_token IS 'Encrypted OAuth refresh token when google_calendar_source = store_oauth';
