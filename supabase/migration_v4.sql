-- ============================================================================
-- Cold Outreach Generator — Migration v4
-- Adds "email_threads": the data behind the Follow-Up tab. Rows can be added
-- manually now; the Outlook/Affinity connectors will write into this same
-- table later (source = 'outlook' | 'affinity'), so no UI rework is needed.
-- Run in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Safe/additive on an existing project.
-- ============================================================================

create table if not exists public.email_threads (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references auth.users (id) on delete cascade,
  contact_name      text not null,
  contact_email     text not null,
  company           text,
  subject           text,
  last_outbound_at  timestamptz not null default now(),
  last_inbound_at   timestamptz,
  meeting_at        timestamptz,
  status            text not null default 'no_answer'
                      check (status in ('no_answer', 'answered', 'meeting_set')),
  snippet           text,
  source            text not null default 'manual',
  thread_url        text,
  created_at        timestamptz not null default now()
);

create index if not exists email_threads_owner_id_idx
  on public.email_threads (owner_id);

alter table public.email_threads enable row level security;

drop policy if exists "email_threads_select_own" on public.email_threads;
create policy "email_threads_select_own"
  on public.email_threads for select using (auth.uid() = owner_id);

drop policy if exists "email_threads_insert_own" on public.email_threads;
create policy "email_threads_insert_own"
  on public.email_threads for insert with check (auth.uid() = owner_id);

drop policy if exists "email_threads_update_own" on public.email_threads;
create policy "email_threads_update_own"
  on public.email_threads for update
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "email_threads_delete_own" on public.email_threads;
create policy "email_threads_delete_own"
  on public.email_threads for delete using (auth.uid() = owner_id);
