-- ============================================================================
-- DEFROST — Migration v6
-- Affinity now tracks ORGANIZATIONS from a pipeline list, which may not have a
-- specific contact email yet. So:
--   1) contact_email becomes nullable (org-level threads can omit it)
--   2) add source_ref to dedupe synced rows cleanly (e.g. "org:12345")
-- Run in Supabase SQL editor. Additive/safe to re-run.
-- ============================================================================

alter table public.email_threads
  alter column contact_email drop not null;

alter table public.email_threads
  add column if not exists source_ref text;

create index if not exists email_threads_source_ref_idx
  on public.email_threads (owner_id, source_ref);
