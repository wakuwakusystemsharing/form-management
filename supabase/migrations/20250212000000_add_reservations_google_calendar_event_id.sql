-- Store Google Calendar event ID on reservation for reliable deletion on cancel
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS google_calendar_event_id text;
COMMENT ON COLUMN reservations.google_calendar_event_id IS 'Google Calendar event ID for this reservation; used to delete the event on cancel.';
