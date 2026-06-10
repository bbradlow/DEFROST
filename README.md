# Cold Outreach Email Generator

Generate personalized cold-outreach emails in bulk, in a chosen **writer's**
voice, and hand the whole batch off to whoever sends them.

Built with **Next.js (App Router) + TypeScript + Tailwind**, **Supabase**
(Postgres + Auth), and **OpenRouter** (free models). Deploys on **Vercel**.

---

## Core concepts

- **Owner** — you, the signed-in user. Set automatically from the Supabase
  session. Used for record ownership / row-level security and shown in the
  header. The owner never appears in the email body.
- **Writer** — the person who actually sends the email (e.g. your analyst).
  Chosen per email from a dropdown backed by the `writers` table. Each email is
  written in that writer's voice and signed off by them. A **"Set one writer
  for all"** control applies one writer to every row in the batch.

---

## Defaults applied ([DEFAULT] choices from the brief)

These are in effect now. Each is reversible — see notes below to change.

1. **Writers are scoped per-owner.** Each owner only sees and manages their own
   writers (enforced by RLS). *If you'd rather share one team-wide writer list,
   see "Writer scope" below — it's a small change.*
2. **Generated emails are not persisted.** They live in session state only
   (kept tight). *To save batch history, an optional `batches`/`emails` schema
   is included (commented out) in `supabase/schema.sql` — see "Saving batch
   history."*
3. **Default model = the OpenRouter free auto-router (`openrouter/free`).** It's
   always the first option and is also the automatic fallback if a chosen model
   errors. Free model IDs change often, so the list is fetched live and filtered
   to free models rather than hardcoded. *Pick a specific free model from the
   dropdown any time.*
4. **Base style prompt** is provided as a sensible cold-outreach voice (concise,
   specific, one clear ask, no subject line, signed by the writer). It's
   **editable in the UI** (Generator page → "Base style prompt"). The default
   wording lives in `lib/prompts.ts` (`DEFAULT_BASE_PROMPT`) — tune it there to
   change the permanent default.

No subject lines are produced — body only, per the brief.

---

## Prerequisites

- **Node.js 18.18+** (Node 20 LTS recommended)
- A **Supabase** account (free tier is fine)
- An **OpenRouter** account + API key (free tier is fine)
- A **GitHub** account and a **Vercel** account for deploy

---

## 1. Supabase setup

1. Create a project at <https://supabase.com> → **New project**. Note the
   database password.
2. **Run the schema.** In the dashboard go to **SQL Editor → New query**, paste
   the contents of [`supabase/schema.sql`](./supabase/schema.sql), and click
   **Run**. This creates the `writers` table and its RLS policies.
3. **Get your keys.** Go to **Project Settings → API**:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (**server-only secret**)
4. **Auth settings.** Go to **Authentication → Providers → Email** and make sure
   Email is enabled. For local dev you may want to turn **"Confirm email"** off
   so you can sign in immediately; for production, leave confirmation on. Under
   **Authentication → URL Configuration**, add your site URL(s) to the redirect
   allowlist (e.g. `http://localhost:3000/**` and your Vercel URL `/**`) so
   magic links / confirmations redirect correctly.

## 2. OpenRouter setup

1. Sign in at <https://openrouter.ai> and create a key at
   <https://openrouter.ai/keys>.
2. Copy it into `OPENROUTER_API_KEY` (server-only — never exposed to the
   browser). No credit card is needed for free models.
3. Free models are rate-limited (~**20 requests/minute, ~200/day**). The app
   generates **sequentially with throttling** and surfaces progress; failed
   rows can be retried individually.

## 3. Environment variables

Copy `.env.example` to `.env.local` and fill it in:

```bash
cp .env.example .env.local
```

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...       # server-only
OPENROUTER_API_KEY=...              # server-only
```

`NEXT_PUBLIC_*` values are exposed to the browser (safe — RLS protects data).
The two server-only keys are read only in route handlers / server code and are
**never** sent to the client.

## 4. Run locally

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. You'll be sent to `/login`. Create an account,
sign in, then add a writer on the **Writers** page before generating.

---

## Using the app

1. **Writers** page: add the senders (name, email, optional title/signature).
2. **Generator** page:
   - Add rows manually (**+ Add row**) or **Import CSV**.
   - Pick a writer per row, or use **Set one writer for all**.
   - Enter company + website. Click **Auto-fill from website** (per row) or
     **Auto-fill recipients (all)** to pull up to 2 likely founders/leaders
     (names only — fill emails in afterward).
   - Put what the email should say in **Additional info** — this drives the
     structure and angle on top of the base style.
   - **Generate** per row, or **Generate all** (throttled).
3. **Output**: each email is a collapsible block. **Copy** one, or **Copy all**
   to get the whole batch formatted for handoff:

   ```
   jane@acme.com, sam@acme.com
   Hi Jane and Sam,
   [body...]



   founder@beta.io
   Hi Alex,
   [body...]
   ```

   The top line is the recipient **emails** (comma-separated); if none are
   filled in yet it falls back to recipient **names**. Emails are separated by
   three blank lines.

### CSV format

Header row required:

```
writer, company, website, recipients, additional_info
```

- `writer` matches a writer by **name or email**; unmatched rows are flagged so
  you can pick a writer manually.
- `recipients` is optional (comma-separated names); leave blank to auto-pull.
- Rows are validated and editable before generating.

---

## Deploy

### Push to GitHub

```bash
git init
git add .
git commit -m "Cold outreach email generator"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

`.env` / `.env.local` are git-ignored — secrets never get committed.

### Deploy on Vercel

1. Go to <https://vercel.com> → **Add New… → Project** and import the GitHub
   repo. Framework preset auto-detects **Next.js**; default build settings
   (`next build`) work as-is — no overrides needed.
2. Under **Environment Variables**, add all four:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `OPENROUTER_API_KEY`
   (optionally `OPENROUTER_APP_URL` = your Vercel URL, `OPENROUTER_APP_TITLE`).
3. **Deploy.** After it's live, add the Vercel URL to Supabase
   **Authentication → URL Configuration** redirect allowlist (e.g.
   `https://your-app.vercel.app/**`).

---

## Changing the defaults

### Writer scope (shared team list instead of per-owner)

Per-owner is enforced by the RLS policies on `writers` and the `owner_id`
column. To make writers shared across all authenticated users, replace the
SELECT policy in `supabase/schema.sql` with one that allows any authenticated
user to read, e.g.:

```sql
create policy "writers_select_all_authed" on public.writers
  for select using (auth.role() = 'authenticated');
```

(You'd typically keep insert/update/delete owner-scoped, or relax them too.)
Decide based on whether writers are personal or a shared roster.

### Saving batch history

The app keeps emails in session state only. To persist them, uncomment the
`batches`/`emails` block at the bottom of `supabase/schema.sql`, re-run it, and
add save/load calls (the browser Supabase client already enforces RLS). The
`Recipient`/`EmailRow` shapes in `lib/types.ts` map directly to the `emails`
columns.

### Email voice

Edit `DEFAULT_BASE_PROMPT` in `lib/prompts.ts` for the permanent default, or
tweak it per session in the Generator UI.

---

## How secrets are handled

- All OpenRouter calls and the Supabase **service-role** client live only in
  server route handlers (`app/api/*`) and `lib/` server modules.
- The browser only ever uses the public anon key; **RLS** scopes every row to
  its owner.
- `OPENROUTER_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are never prefixed with
  `NEXT_PUBLIC_` and never reach the client.

## Notes & limitations

- **Website scraping is best-effort.** It's a plain server-side fetch (no
  headless browser), so JS-heavy single-page sites may yield little text. The UI
  flags weak extraction; always verify recipients and add email addresses
  manually.
- **Free-model rate limits** mean large batches take time (throttled to stay
  under ~20/min). Failed attempts still count toward the daily quota.
- Recipient extraction asks the model for **names only** and instructs it not to
  invent people; treat results as suggestions.
