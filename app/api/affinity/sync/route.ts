import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  affinityConfigured,
  whoami,
  whoamiEmail,
  getListEntries,
  getSavedViewEntries,
  getOrganization,
  getOpportunity,
  lastEmailDate,
  type AffinityListEntry,
} from "@/lib/integrations/affinity";

export const maxDuration = 60;

const DEFAULT_LIST_ID = 93884; // Activant master pipeline

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

  let body: { listId?: number; viewId?: number; sinceDays?: number; maxOrgs?: number };
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const listId = Number(body.listId) || DEFAULT_LIST_ID;
  const viewId = body.viewId ? Number(body.viewId) : null;
  const sinceDays = Math.max(1, Math.min(3650, body.sinceDays ?? 90));
  const maxOrgs = Math.max(1, Math.min(300, body.maxOrgs ?? 150));
  const sinceMs = Date.now() - sinceDays * 86_400_000;

  const steps: string[] = [];
  const trace = (s: string) => {
    steps.push(s);
    console.log(`[affinity] ${user.email}: ${s}`);
  };

  // 1) Verify the key / identify the owner.
  const who = await whoami();
  if (!who.ok || !who.data?.user) {
    trace(`whoami: FAILED status=${who.status} raw=${who.raw}`);
    return NextResponse.json(
      { error: "Affinity rejected the API key.", debug: steps.join("\n") },
      { status: 400 },
    );
  }
  trace(
    `whoami: ok tenant="${who.data.tenant?.name ?? "?"}" as ${whoamiEmail(who.data) || user.email}`,
  );

  // 2) Pull the pipeline entries (list or saved view), paginating a few pages.
  let entries: AffinityListEntry[] = [];
  let token: string | undefined;
  let pages = 0;
  let firstRaw = "";
  do {
    const r = viewId
      ? await getSavedViewEntries(listId, viewId, token)
      : await getListEntries(listId, token);
    if (!r.ok) {
      trace(`entries: FAILED status=${r.status} raw=${r.raw}`);
      return NextResponse.json(
        { error: `Could not read list ${listId} (see diagnostics).`, debug: steps.join("\n") },
        { status: 200 },
      );
    }
    if (!firstRaw) firstRaw = r.raw;
    entries = entries.concat(r.entries);
    token = r.next ?? undefined;
    pages += 1;
  } while (token && pages < 5 && entries.length < maxOrgs * 2);

  const typeCounts = entries.reduce<Record<number, number>>((m, e) => {
    m[e.entity_type] = (m[e.entity_type] ?? 0) + 1;
    return m;
  }, {});
  trace(
    `entries: ${entries.length} from ${viewId ? `view ${viewId}` : `list ${listId}`} ` +
      `types=${JSON.stringify(typeCounts)} sample=${firstRaw}`,
  );

  // 3) Resolve organization ids from entries (org=1 direct; opportunity=8 via lookup).
  const orgIds = new Set<number>();
  let oppLookups = 0;
  for (const e of entries) {
    if (orgIds.size >= maxOrgs) break;
    if (e.entity_type === 1) {
      orgIds.add(e.entity_id || e.entity?.id || 0);
    } else if (e.entity_type === 8) {
      const direct = e.entity?.organization_ids;
      if (direct?.length) direct.forEach((id) => orgIds.add(id));
      else if (oppLookups < maxOrgs) {
        oppLookups += 1;
        const opp = await getOpportunity(e.entity_id || e.entity?.id || 0);
        opp.data?.organization_ids?.forEach((id) => orgIds.add(id));
      }
    }
  }
  orgIds.delete(0);
  trace(`organizations: ${orgIds.size} resolved (opportunity lookups=${oppLookups})`);

  // 4) For each org, read interaction dates; keep those emailed within the window.
  const { data: existing } = await supabase
    .from("email_threads")
    .select("id, source_ref, last_outbound_at");
  const byRef = new Map(
    (existing ?? []).filter((t) => t.source_ref).map((t) => [t.source_ref as string, t]),
  );

  let added = 0;
  let updated = 0;
  let skippedOld = 0;
  let skippedNoDate = 0;
  let processed = 0;
  for (const orgId of orgIds) {
    if (processed >= maxOrgs) break;
    processed += 1;
    const org = await getOrganization(orgId);
    if (!org.ok || !org.data) continue;
    const when = lastEmailDate(org.data.interaction_dates);
    if (!when) {
      skippedNoDate += 1;
      continue;
    }
    if (Date.parse(when) < sinceMs) {
      skippedOld += 1;
      continue;
    }
    const ref = `org:${orgId}`;
    const ex = byRef.get(ref);
    if (!ex) {
      const { error } = await supabase.from("email_threads").insert({
        owner_id: user.id,
        contact_name: org.data.name ?? `Org ${orgId}`,
        contact_email: null,
        company: org.data.name ?? null,
        last_outbound_at: when,
        status: "no_answer",
        source: "affinity",
        source_ref: ref,
      });
      if (!error) added += 1;
    } else if (when > ex.last_outbound_at) {
      const { error } = await supabase
        .from("email_threads")
        .update({ last_outbound_at: when })
        .eq("id", ex.id);
      if (!error) updated += 1;
    }
  }
  trace(
    `upsert: added=${added} updated=${updated} skipped(old=${skippedOld}, no-date=${skippedNoDate}) processed=${processed}`,
  );

  return NextResponse.json({ added, updated, debug: steps.join("\n") });
}
