-- ============================================================================
-- DEFROST — Migration v7
-- Style prompts can now be either outreach or follow-up prompts. Existing rows
-- default to 'outreach'. Run in Supabase SQL editor. Additive/safe.
-- ============================================================================

alter table public.style_prompts
  add column if not exists kind text not null default 'outreach'
    check (kind in ('outreach', 'followup'));
