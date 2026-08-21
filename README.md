# DEFROST — Cold Outreach Email Generator

DEFROST (marketed in-app as "Activant — DEFROST") generates personalized
cold-outreach emails in bulk, in a chosen **writer's** voice, and hands the
batch off to whoever sends them. It also tracks sent threads and drafts
follow-ups for ones that haven't gotten a reply.

Built with **Next.js (App Router) + TypeScript + Tailwind**, **Supabase**
(Postgres + Auth, with row-level security), and **OpenRouter** (LLM access,
defaults to free models). Deploys on **Vercel**.

---

## Core concepts

- **Owner** — the signed-in user. Set automatically from the Supabase
  session; used for row-level security so each account only sees its own
  data. The owner never appears in the email body.
- **Writer** — the person who actually sends the email (e.g. an analyst).
  Chosen per email from a dropdown backed by the `writers` table. Each email
  is written in that writer's voice and signed off by them.
- **Style prompt** — a reusable base instruction (per owner, per kind:
  `outreach` or `followup`) that shapes tone/structure on top of the
  per-row "additional info." Managed on the **Prompts** page, stored in
  `style_prompts`.
- **Email thread** — a tracked outbound email (manual entry, or synced from
  Affinity) used to drive the **Follow-up** dashboard's reminders.

---

## Project structure

```
app/                        Next.js App Router pages + API routes
  page.tsx                  Generator page (default route "/")
  writers/page.tsx          Writers admin page
  prompts/page.tsx          Style-prompt admin page
  follow-up/page.tsx        Follow-up dashboard page
  login/page.tsx            Supabase email/password auth page
  auth/callback/route.ts    Supabase auth callback handler
  auth/signout/route.ts     Sign-out route
  layout.tsx, globals.css   Root layout + global styles
  api/
    generate/route.ts       Generates an outreach email body via OpenRouter
    founders/route.ts       Scrapes a company site + LLM-extracts likely
                             founder/exec names, then looks up emails via
                             RocketReach (if configured)
    followup/route.ts       Drafts a follow-up email from a fixed template
                             (no LLM) using a thread + writer
    models/route.ts         Lists available free OpenRouter models
    affinity/sync/route.ts  Pulls sent/received emails from Affinity and
                             upserts them into email_threads

components/                 Client React components used by the pages above
  GeneratorGrid.tsx          Batch table UI: add/import rows, per-row and
                              bulk generate, CSV import
  EmailRow.tsx                One row of the generator grid
  OutputAccordion.tsx         Collapsible per-email output + "copy all"
  WritersAdmin.tsx            CRUD UI for writers
  PromptsAdmin.tsx            CRUD UI for style prompts
  FollowUpDashboard.tsx       Thread list, reminders, Affinity sync trigger,
                              follow-up drafting
  TopBar.tsx                  Site nav (Generator / Writers / Prompts /
                              Follow-up) + owner display

lib/                        Server + shared logic, no UI
  openrouter.ts              OpenRouter chat client, free-model listing,
                              throttling/fallback helpers
  prompts.ts                 Default base style prompt, prompt-building
                              helpers, follow-up template filling
  scrape.ts                  Best-effort server-side website text scraping
                              (plain fetch, no headless browser)
  rocketreach.ts              RocketReach client for recipient email lookup
  csv.ts                      CSV import/export helpers (Papaparse)
  format.ts                   Email/text formatting helpers
  linkify.ts                  Turns plain-text URLs into links for display
  types.ts                    Shared TypeScript types (Writer, StylePrompt,
                              EmailThread, Recipient, row status, etc.)
  integrations/affinity.ts    Affinity API v2 client (emails, attendees)
  supabase/
    client.ts                 Browser Supabase client (anon key)
    server.ts                 Server Supabase client (route handlers)
    middleware.ts              Session refresh helper used by middleware.ts

middleware.ts                Next.js middleware wiring up Supabase session
                              refresh on every request

supabase/
  schema.sql                  Base schema: writers, style_prompts,
                              email_threads tables + RLS policies (plus a
                              commented-out optional batches/emails schema
                              for persisting generated batches)
  migration_v2.sql .. v8.sql  Incremental migrations applied on top of the
                              base schema (style prompts, email_threads,
                              integration_tokens, etc.)

types.ts                     Root-level type re-export/legacy types file
public/                      Static assets (Activant logo, icons)
.env.example                 Documented list of required/optional env vars
```

---

## Pages / features

- **Generator** (`/`) — one row per email. Add rows manually or import a
  CSV, pick a writer per row (or set one writer for all), enter company +
  website, auto-fill likely recipients, add free-text "additional info,"
  then generate per row or in bulk (throttled). Output is a collapsible
  list per email; "Copy all" formats the whole batch for handoff.
- **Writers** (`/writers`) — add/edit the people emails are sent as (name,
  email, optional title/signature/Calendly link).
- **Prompts** (`/prompts`) — manage reusable base style prompts for outreach
  and follow-up emails.
- **Follow-up** (`/follow-up`) — dashboard of tracked email threads with
  reminders (no answer / answered / meeting set), optional one-click sync
  from Affinity, and template-based follow-up drafting.

### Defaults / notable behavior

- Writers, style prompts and threads are scoped per-owner via Postgres RLS.
- Generated outreach emails are **not persisted** by default — they live in
  session state only. An optional `batches`/`emails` schema is included
  (commented out) in `supabase/schema.sql` if you want to persist them; the
  `Recipient`/`EmailRow` shapes in `lib/types.ts` map to those columns.
- Default generation model is the OpenRouter free auto-router
  (`openrouter/free`); the model list is fetched live from `/api/models`
  and filtered to free models rather than hardcoded.
- No subject lines are produced — body only.
- Follow-up drafts use a fixed template (`lib/prompts.ts`), not an LLM call.
- Website scraping (`lib/scrape.ts`) is a plain server-side fetch, so
  JS-heavy sites may yield little text; the UI flags weak extraction.
- Free OpenRouter models are rate-limited (~20 requests/minute, ~200/day);
  generation runs sequentially with throttling and failed rows can be
  retried individually.

---

## Environment variables

See [`.env.example`](./.env.example) for the full documented list. Summary:

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Public anon key, exposed to the browser (safe — RLS scopes data) |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Server-only secret, never prefixed `NEXT_PUBLIC_` |
| `OPENROUTER_API_KEY` | yes | Server-only, used for generation and founder extraction |
| `OPENROUTER_APP_URL` / `OPENROUTER_APP_TITLE` | no | OpenRouter leaderboard attribution |
| `ROCKETREACH_API_KEY` | no | Enables recipient email auto-fill; without it only names are found |
| `FOUNDER_MODEL` | no | OpenRouter model slug for founder/exec extraction (defaults to Claude Haiku) |
| `AFFINITY_API_KEY` | no | Enables the Affinity sync integration in the Follow-up dashboard |

Copy `.env.example` to `.env.local` and fill it in before running locally.
`NEXT_PUBLIC_*` values are exposed to the browser; the service-role and API
keys are read only in route handlers / server modules and never sent to the
client.

## Running locally

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. You're sent to `/login`; create an account,
sign in, then add a writer on the **Writers** page before generating.

Database: run `supabase/schema.sql` (and any newer `migration_v*.sql` files
not yet applied) against your Supabase project via the SQL editor before
first use.

## How secrets are handled

- All OpenRouter, RocketReach and Affinity calls, plus the Supabase
  **service-role** client, live only in server route handlers (`app/api/*`)
  and `lib/` server modules.
- The browser only ever uses the public anon key; RLS scopes every row to
  its owner.
- `OPENROUTER_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ROCKETREACH_API_KEY`
  and `AFFINITY_API_KEY` are never prefixed with `NEXT_PUBLIC_` and never
  reach the client.
