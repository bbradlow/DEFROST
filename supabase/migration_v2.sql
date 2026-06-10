-- ============================================================================
-- Cold Outreach Generator — Migration v2
-- Adds the "style_prompts" catalog (the Base Style Prompts tab).
-- Run this in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Safe to run on an existing project; it only adds a new table + policies.
-- (If you're setting up fresh, schema.sql already includes this block.)
-- ============================================================================

-- STYLE PROMPTS ---------------------------------------------------------------
-- A reusable "house voice" base prompt. Picked from a dropdown on the
-- Generator tab. Scoped per owner, exactly like writers.

create table if not exists public.style_prompts (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  body        text not null,
  created_at  timestamptz not null default now()
);

create index if not exists style_prompts_owner_id_idx
  on public.style_prompts (owner_id);

alter table public.style_prompts enable row level security;

drop policy if exists "style_prompts_select_own" on public.style_prompts;
create policy "style_prompts_select_own"
  on public.style_prompts for select
  using (auth.uid() = owner_id);

drop policy if exists "style_prompts_insert_own" on public.style_prompts;
create policy "style_prompts_insert_own"
  on public.style_prompts for insert
  with check (auth.uid() = owner_id);

drop policy if exists "style_prompts_update_own" on public.style_prompts;
create policy "style_prompts_update_own"
  on public.style_prompts for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "style_prompts_delete_own" on public.style_prompts;
create policy "style_prompts_delete_own"
  on public.style_prompts for delete
  using (auth.uid() = owner_id);
