-- ============================================================================
-- DEFROST — Migration v5
-- Stores OAuth tokens for external integrations (currently Calendly).
-- RLS is ENABLED with NO policies: clients cannot read or write tokens at all.
-- Only the server (service-role key, in the /api/calendly/* routes) touches it,
-- exactly like the invite tool's private email catalog. Affinity does NOT use
-- this table — it authenticates with a single server-side API key (env var).
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Additive/safe.
-- ============================================================================

create table if not exists public.integration_tokens (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users (id) on delete cascade,
  provider      text not null,                  -- e.g. 'calendly'
  access_token  text not null,
  refresh_token text,
  expires_at    timestamptz,
  meta          jsonb,                           -- e.g. { user_uri, organization }
  updated_at    timestamptz not null default now(),
  unique (owner_id, provider)
);

-- RLS on, no policies -> only the service-role key (server) can access.
alter table public.integration_tokens enable row level security;
