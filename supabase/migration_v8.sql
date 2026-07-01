-- ============================================================================
-- DEFROST — Migration v8
-- Optional countdown target for a reminder. When set, the card counts DOWN to
-- this time instead of counting up since the last outbound. Additive/safe.
-- ============================================================================

alter table public.email_threads
  add column if not exists remind_at timestamptz;
