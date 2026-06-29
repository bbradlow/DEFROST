import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  affinityConfigured,
  whoami,
  findInternalPersonByEmail,
  getPersonInteractions,
  type AffinityInteraction,
  type AffinityPerson,
} from "@/lib/integrations/affinity";

export const maxDuration = 60;

function daysAgoISO(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!affinityConfigured()) {
    return NextResponse.json(
      { error: "Affinity is not configured. Set AFFINITY_API_KEY." },
      { status: 400 },
    );
  }

  const ownerEmail = (user.email ?? "").trim();
  let body: { sinceDays?: number };
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const sinceDays = Math.max(1, Math.min(365, body.sinceDays ?? 30));

  const steps: string[] = [];
  const trace = (s: string) => {
    steps.push(s);
    console.log(`[affinity] ${ownerEmail}: ${s}`);
  };

  // 1) Verify key + identify tenant.
  const who = await whoami();
  if (!who.ok) {
    trace(`whoami: FAILED status=${who.status}`);
    return NextResponse.json(
      { error: "Affinity rejected the API key.", debug: steps.join("\n") },
      { status: 400 },
    );
  }
  trace(`whoami: ok tenant="${who.data?.tenant?.name ?? "?"}"`);

  // 2) Match the signed-in DEFROST email to an Affinity internal person.
  const found = await findInternalPersonByEmail(ownerEmail);
  if (!found.match) {
    trace(`match: no Affinity person found for ${ownerEmail} (searched ${found.persons.length})`);
    return NextResponse.json(
      {
        error: `Couldn't match ${ownerEmail} to an Affinity account.`,
        debug: steps.join("\n"),
      },
      { status: 404 },
    );
  }
  const me = found.match;
  trace(`match: ${ownerEmail} -> person #${me.id} (${me.first_name} ${me.last_name})`);

  // 3) Pull recent interactions for this person and keep the email ones.
  const since = daysAgoISO(sinceDays);
  const inter = await getPersonInteractions(me.id, since);
  if (!inter.ok) {
    trace(`interactions: status=${inter.status} (endpoint may need tuning for your tenant)`);
    return NextResponse.json(
      {
        error: "Could not read interactions from Affinity (see diagnostics).",
        debug: steps.join("\n"),
      },
      { status: 200 },
    );
  }
  const raw: AffinityInteraction[] =
    inter.data?.emails ?? inter.data?.interactions ?? [];
  trace(`interactions: received ${raw.length} record(s)`);

  // Build one prospective thread per external contact (most recent email wins).
  const meEmails = new Set([
    ownerEmail.toLowerCase(),
    ...(me.emails ?? []).map((e) => e.toLowerCase()),
  ]);
  const byEmail = new Map<
    string,
    { name: string; email: string; at: string }
  >();
  for (const it of raw) {
    const when = it.date ?? it.start_time ?? "";
    const externals: AffinityPerson[] = (it.persons ?? []).filter(
      (p) => !meEmails.has((p.primary_email ?? "").toLowerCase()),
    );
    for (const p of externals) {
      const email = (p.primary_email ?? p.emails?.[0] ?? "").toLowerCase();
      if (!email) continue;
      const name = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || email;
      const prev = byEmail.get(email);
      if (!prev || (when && when > prev.at)) byEmail.set(email, { name, email, at: when });
    }
  }
  const candidates = [...byEmail.values()];
  trace(`contacts: ${candidates.length} external contact(s) from emails`);

  // 4) Upsert into email_threads (no duplicate per owner+contact_email).
  const { data: existing } = await supabase
    .from("email_threads")
    .select("id, contact_email, last_outbound_at");
  const existingByEmail = new Map(
    (existing ?? []).map((t) => [t.contact_email.toLowerCase(), t]),
  );

  let added = 0;
  let updated = 0;
  for (const c of candidates) {
    const ex = existingByEmail.get(c.email);
    const at = c.at || new Date().toISOString();
    if (!ex) {
      const { error } = await supabase.from("email_threads").insert({
        owner_id: user.id,
        contact_name: c.name,
        contact_email: c.email,
        last_outbound_at: at,
        status: "no_answer",
        source: "affinity",
      });
      if (!error) added += 1;
    } else if (at > ex.last_outbound_at) {
      const { error } = await supabase
        .from("email_threads")
        .update({ last_outbound_at: at })
        .eq("id", ex.id);
      if (!error) updated += 1;
    }
  }
  trace(`upsert: added=${added} updated=${updated}`);

  return NextResponse.json({ added, updated, debug: steps.join("\n") });
}
