import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  affinityConfigured,
  whoami,
  whoamiEmail,
  searchPersons,
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
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
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

  // 1) whoami — verify key and identify the key's owner (that's the user).
  const who = await whoami();
  if (!who.ok || !who.data?.user) {
    trace(`whoami: FAILED status=${who.status} raw=${who.raw}`);
    return NextResponse.json(
      { error: "Affinity rejected the API key.", debug: steps.join("\n") },
      { status: 400 },
    );
  }
  const meUser = who.data.user;
  const meId = typeof meUser.id === "number" ? meUser.id : null;
  const meEmailFromAffinity = whoamiEmail(who.data);
  trace(
    `whoami: ok tenant="${who.data.tenant?.name ?? "?"}" user#${meId ?? "?"} ` +
      `name="${`${meUser.firstName ?? ""} ${meUser.lastName ?? ""}`.trim()}" ` +
      `email="${meEmailFromAffinity || "(no email field)"}" keys=[${Object.keys(meUser).join(",")}]`,
  );
  if (meEmailFromAffinity && meEmailFromAffinity.toLowerCase() !== ownerEmail.toLowerCase()) {
    trace(
      `note: Affinity key belongs to ${meEmailFromAffinity}, but you're logged into DEFROST as ${ownerEmail}`,
    );
  }

  // 2) For diagnostics, show what the person search returns for your email.
  const search = await searchPersons(ownerEmail);
  trace(
    `persons?term=${ownerEmail}: status=${search.status} count=${search.persons.length} raw=${search.raw}`,
  );

  // Pick the person id to read interactions for: prefer a search match,
  // otherwise fall back to the whoami user id.
  const lower = ownerEmail.toLowerCase();
  const searchMatch =
    search.persons.find(
      (p) =>
        (p.primary_email ?? "").toLowerCase() === lower ||
        p.emails?.some((e) => e.toLowerCase() === lower),
    ) ?? null;
  const personId = searchMatch?.id ?? meId;
  trace(
    `identity: using ${searchMatch ? `person #${searchMatch.id} (search match)` : `whoami user #${meId} (fallback)`}`,
  );
  if (!personId) {
    return NextResponse.json(
      { error: "Could not resolve your Affinity person id.", debug: steps.join("\n") },
      { status: 404 },
    );
  }

  // 3) Read recent interactions for that person.
  const since = daysAgoISO(sinceDays);
  const inter = await getPersonInteractions(personId, since);
  if (!inter.ok) {
    trace(`interactions: status=${inter.status} raw=${inter.raw}`);
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
  trace(
    `interactions: status=${inter.status} records=${raw.length} raw=${inter.raw}`,
  );

  // 4) Build one prospective thread per external contact (latest email wins).
  const myEmails = new Set(
    [ownerEmail.toLowerCase(), meEmailFromAffinity.toLowerCase()].filter(Boolean),
  );
  const byEmail = new Map<string, { name: string; email: string; at: string }>();
  for (const it of raw) {
    const when = it.date ?? it.start_time ?? "";
    const externals: AffinityPerson[] = (it.persons ?? []).filter(
      (p) => !myEmails.has((p.primary_email ?? "").toLowerCase()),
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
  trace(`contacts: ${candidates.length} external contact(s)`);

  // 5) Upsert into email_threads (dedupe per owner+contact_email).
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
