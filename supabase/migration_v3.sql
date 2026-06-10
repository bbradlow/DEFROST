-- ============================================================================
-- Cold Outreach Generator — Migration v3
-- Adds a scheduling link (e.g. Calendly) to each writer.
-- Run this in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Safe on an existing project; it only adds one nullable column. The writers
-- table's existing RLS policies already cover it.
-- ============================================================================

alter table public.writers
  add column if not exists calendly text;
