import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  affinityConfigured,
  whoami,
  fetchEmailsSince,
  attendeeName,
  type Attendee,
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

  const ownerEmail = (user.email ?? "").trim().toLowerCase();
  let body: { sinceDays?: number };
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const sinceDays = Math.max(1, Math.min(3650, body.sinceDays ?? 30));
  const sinceISO = daysAgoISO(sinceDays);

  const steps: string[] = [];
  const trace = (s: string) => {
    steps.push(s);
    console.log(`[affinity] ${ownerEmail}: ${s}`);
  };

  // 1) Verify the key + identify the key owner (v2 is Bearer auth).
  const who = await whoami();
  if (!who.ok || !who.data?.user) {
    trace(`whoami: FAILED status=${who.status} raw=${who.raw}`);
    return NextResponse.json(
      {
        error:
          who.status === 401
            ? "Affinity rejected the key for v2 (check the key / that your tier includes API v2)."
            : "Affinity whoami failed.",
        debug: steps.join("\n"),
      },
      { status: 400 },
    );
  }
  const keyEmail = (who.data.user.emailAddress ?? "").toLowerCase();
  trace(`whoami: ok tenant="${who.data.tenant?.name ?? "?"}" key owner=${keyEmail}`);
  // We attribute "my" sent emails to the key owner (that's whose mailbox the
  // key can see). If the DEFROST login differs, note it.
  const meEmail = keyEmail || ownerEmail;
  if (ownerEmail && keyEmail && ownerEmail !== keyEmail) {
    trace(`note: DEFROST login ${ownerEmail} differs from key owner ${keyEmail}; attributing to key owner`);
  }

  // 2) Pull the email feed since the window.
  const feed = await fetchEmailsSince(sinceISO);
  if (!feed.ok) {
    trace(`emails: FAILED status=${feed.status} filter="${feed.filter}" raw=${feed.raw}`);
    return NextResponse.json(
      { error: "Could not read emails from Affinity (see diagnostics).", debug: steps.join("\n") },
      { status: 200 },
    );
  }
  trace(
    `emails: ${feed.emails.length} since ${sinceISO.slice(0, 10)} ` +
      `across ${feed.pages} page(s) [filter="${feed.filter}"]`,
  );
  if (feed.moreAvailable || feed.timedOut) {
    trace(
      `note: did NOT reach the end of the window (${feed.timedOut ? "time budget" : "page cap"} hit). ` +
        `The firm-wide feed has more emails than were pulled, and /emails can't filter by sender — ` +
        `try a shorter window (lower the days box) to fully cover recent mail.`,
    );
  }

  // Decisive breakdown: direction split, date range covered, and whether *my*
  // address appears as a sender anywhere in what we pulled.
  {
    let nSent = 0;
    let nRecv = 0;
    let minSent = "";
    let maxSent = "";
    let meAsSender = 0;
    const internalSenders = new Set<string>();
    const sentFrom = new Set<string>();
    for (const e of feed.emails) {
      const dir = (e.direction ?? "").toLowerCase();
      const fromAddr = (e.from?.emailAddress ?? e.from?.person?.primaryEmailAddress ?? "").toLowerCase();
      if (e.sentAt) {
        if (!minSent || e.sentAt < minSent) minSent = e.sentAt;
        if (!maxSent || e.sentAt > maxSent) maxSent = e.sentAt;
      }
      if (fromAddr === meEmail) meAsSender += 1;
      if (dir === "sent") {
        nSent += 1;
        if (fromAddr) internalSenders.add(fromAddr);
        if (sentFrom.size < 8 && fromAddr) sentFrom.add(fromAddr);
      } else {
        nRecv += 1;
      }
    }
    trace(`feed breakdown: sent=${nSent} received=${nRecv}; matching me=${meEmail}`);
    trace(`date range pulled: ${minSent.slice(0, 10) || "?"} … ${maxSent.slice(0, 10) || "?"}`);
    trace(`distinct internal senders seen: ${internalSenders.size}; my address as sender: ${meAsSender} time(s)`);
    trace(`sample 'sent' senders: ${[...sentFrom].join(", ") || "(none)"}`);
  }

  // 3) Aggregate per external contact: my last outbound + their last reply.
  type Agg = { name: string; email: string; lastOut: string | null; lastIn: string | null; subject: string | null };
  const byContact = new Map<string, Agg>();
  const isMe = (a: Attendee) =>
    (a.emailAddress ?? "").toLowerCase() === meEmail ||
    (a.person?.primaryEmailAddress ?? "").toLowerCase() === meEmail;
  const isInternal = (a: Attendee) => a.person?.type === "internal";

  const upsertAgg = (a: Attendee, when: string, dir: "out" | "in", subject?: string | null) => {
    const email = (a.emailAddress ?? a.person?.primaryEmailAddress ?? "").toLowerCase();
    if (!email) return;
    const cur =
      byContact.get(email) ?? { name: attendeeName(a), email, lastOut: null, lastIn: null, subject: null };
    if (dir === "out" && (!cur.lastOut || when > cur.lastOut)) {
      cur.lastOut = when;
      cur.subject = subject ?? cur.subject; // subject of my most recent outbound
    }
    if (dir === "in" && (!cur.lastIn || when > cur.lastIn)) cur.lastIn = when;
    if (cur.name === email && attendeeName(a) !== email) cur.name = attendeeName(a);
    byContact.set(email, cur);
  };

  let myOutbound = 0;
  for (const e of feed.emails) {
    const dir = (e.direction ?? "").toLowerCase();
    if (dir === "sent") {
      // Only count emails *I* sent.
      if (!isMe(e.from)) continue;
      myOutbound += 1;
      for (const to of [...e.toParticipantsPreview.data, ...e.ccParticipantsPreview.data]) {
        if (isMe(to) || isInternal(to)) continue; // skip myself + teammates
        upsertAgg(to, e.sentAt, "out", e.subject);
      }
    } else {
      // received: from = external contact, to = internal (possibly me)
      if (isMe(e.from) || isInternal(e.from)) continue;
      upsertAgg(e.from, e.sentAt, "in");
    }
  }
  trace(`parsed: ${myOutbound} email(s) I sent; ${byContact.size} contact(s) touched`);

  // Keep only contacts I actually emailed (have an outbound).
  const contacts = [...byContact.values()].filter((c) => c.lastOut);
  trace(`contacts with my outbound: ${contacts.length}`);

  // 4) Upsert into email_threads, deduped by source_ref = email:<contact>.
  const { data: existing } = await supabase
    .from("email_threads")
    .select("id, source_ref, last_outbound_at, status");
  const byRef = new Map(
    (existing ?? []).filter((t) => t.source_ref).map((t) => [t.source_ref as string, t]),
  );

  let added = 0;
  let updated = 0;
  let answered = 0;
  for (const c of contacts) {
    const ref = `email:${c.email}`;
    const replied = !!c.lastIn && (!c.lastOut || c.lastIn >= c.lastOut);
    const status = replied ? "answered" : "no_answer";
    if (replied) answered += 1;
    const ex = byRef.get(ref);
    if (!ex) {
      const { error } = await supabase.from("email_threads").insert({
        owner_id: user.id,
        contact_name: c.name,
        contact_email: c.email,
        subject: c.subject,
        last_outbound_at: c.lastOut,
        last_inbound_at: c.lastIn,
        status,
        source: "affinity",
        source_ref: ref,
      });
      if (!error) added += 1;
    } else {
      // don't downgrade a manually-set meeting
      const newStatus = ex.status === "meeting_set" ? "meeting_set" : status;
      const { error } = await supabase
        .from("email_threads")
        .update({
          last_outbound_at: c.lastOut,
          last_inbound_at: c.lastIn,
          status: newStatus,
          ...(c.subject ? { subject: c.subject } : {}),
        })
        .eq("id", ex.id);
      if (!error) updated += 1;
    }
  }
  trace(`upsert: added=${added} updated=${updated} (answered=${answered})`);

  return NextResponse.json({ added, updated, answered, debug: steps.join("\n") });
}
