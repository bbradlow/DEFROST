-- ============================================================================
-- Cold Outreach Generator — Supabase schema
-- Run this in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- ============================================================================

-- WRITERS ---------------------------------------------------------------------
-- A "writer" is the person who actually sends the email (e.g. an analyst).
-- Writers are scoped per owner (the authenticated user). See README "Writer
-- scope" for how to switch to a shared team-wide list instead.

create table if not exists public.writers (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  email       text not null,
  title       text,
  signature   text,
  created_at  timestamptz not null default now()
);

create index if not exists writers_owner_id_idx on public.writers (owner_id);

-- Row Level Security ----------------------------------------------------------
alter table public.writers enable row level security;

-- An owner can only read their own writers.
drop policy if exists "writers_select_own" on public.writers;
create policy "writers_select_own"
  on public.writers for select
  using (auth.uid() = owner_id);

-- An owner can only insert rows owned by themselves.
drop policy if exists "writers_insert_own" on public.writers;
create policy "writers_insert_own"
  on public.writers for insert
  with check (auth.uid() = owner_id);

-- An owner can only update their own writers (and cannot reassign ownership).
drop policy if exists "writers_update_own" on public.writers;
create policy "writers_update_own"
  on public.writers for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- An owner can only delete their own writers.
drop policy if exists "writers_delete_own" on public.writers;
create policy "writers_delete_own"
  on public.writers for delete
  using (auth.uid() = owner_id);

-- ============================================================================
-- OPTIONAL: saved batch history (DISABLED BY DEFAULT)
-- The app keeps generated emails in session state only. If you want persisted
-- batches, uncomment the block below, re-run, and wire up the client (see
-- README "Saving batch history").
-- ============================================================================

-- create table if not exists public.batches (
--   id          uuid primary key default gen_random_uuid(),
--   owner_id    uuid not null references auth.users (id) on delete cascade,
--   label       text,
--   created_at  timestamptz not null default now()
-- );
-- create table if not exists public.emails (
--   id            uuid primary key default gen_random_uuid(),
--   batch_id      uuid not null references public.batches (id) on delete cascade,
--   owner_id      uuid not null references auth.users (id) on delete cascade,
--   writer_id     uuid references public.writers (id) on delete set null,
--   company       text,
--   website       text,
--   recipients    jsonb not null default '[]'::jsonb,
--   body          text,
--   created_at    timestamptz not null default now()
-- );
-- alter table public.batches enable row level security;
-- alter table public.emails  enable row level security;
-- create policy "batches_own" on public.batches for all
--   using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
-- create policy "emails_own" on public.emails for all
--   using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
