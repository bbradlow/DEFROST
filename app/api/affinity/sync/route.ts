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
  let body: { sinceDays?: number; fromEmail?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const sinceDays = Math.max(1, Math.min(3650, body.sinceDays ?? 30));
  const sinceISO = daysAgoISO(sinceDays);
  const customFrom = (body.fromEmail ?? "").trim().toLowerCase();

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
  // Attribute "my" sent emails to the custom sender if given, else the key owner
  // (whose mailbox the key can see).
  const meEmail = customFrom || keyEmail || ownerEmail;
  if (customFrom) {
    trace(`attributing outbound to custom sender: ${meEmail}`);
  } else if (ownerEmail && keyEmail && ownerEmail !== keyEmail) {
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
  const isMe = (a: Attendee) =>
    (a.emailAddress ?? "").toLowerCase() === meEmail ||
    (a.person?.primaryEmailAddress ?? "").toLowerCase() === meEmail;
  const isInternal = (a: Attendee) => a.person?.type === "internal";

  // Free/personal mailbox domains: don't merge unrelated people who happen to
  // share gmail.com etc. — group those by full address instead of by domain.
  const PERSONAL_DOMAINS = new Set([
    "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "outlook.com",
    "hotmail.com", "live.com", "msn.com", "icloud.com", "me.com", "mac.com",
    "aol.com", "proton.me", "protonmail.com", "pm.me", "gmx.com", "fastmail.com",
  ]);
  const domainOf = (email: string) => {
    const at = email.lastIndexOf("@");
    return at >= 0 ? email.slice(at + 1) : "";
  };
  const groupKeyFor = (email: string) => {
    const d = domainOf(email);
    if (!d) return email;
    return PERSONAL_DOMAINS.has(d) ? email : d;
  };

  // One reminder per company (corporate domain), or per person for personal domains.
  type Grp = {
    key: string;
    domain: string | null; // corporate domain, or null for a personal-mailbox contact
    names: Set<string>;
    emails: Set<string>;
    lastOut: string | null;
    lastIn: string | null;
    subject: string | null;
  };
  const groups = new Map<string, Grp>();
  const getGroup = (email: string): Grp => {
    const key = groupKeyFor(email);
    let g = groups.get(key);
    if (!g) {
      const d = domainOf(email);
      const corporate = !!d && !PERSONAL_DOMAINS.has(d);
      g = { key, domain: corporate ? d : null, names: new Set(), emails: new Set(), lastOut: null, lastIn: null, subject: null };
      groups.set(key, g);
    }
    return g;
  };
  const emailAddr = (a: Attendee) =>
    (a.emailAddress ?? a.person?.primaryEmailAddress ?? "").toLowerCase();

  let myOutbound = 0;
  for (const e of feed.emails) {
    const dir = (e.direction ?? "").toLowerCase();
    if (dir === "sent") {
      // Only emails *I* sent drive which reminders (and names) exist.
      if (!isMe(e.from)) continue;
      myOutbound += 1;
      for (const to of [...e.toParticipantsPreview.data, ...e.ccParticipantsPreview.data]) {
        if (isMe(to) || isInternal(to)) continue; // skip myself + teammates
        const email = emailAddr(to);
        if (!email) continue;
        const g = getGroup(email);
        g.emails.add(email);
        const nm = attendeeName(to);
        if (nm && nm.toLowerCase() !== email) g.names.add(nm);
        if (!g.lastOut || e.sentAt > g.lastOut) {
          g.lastOut = e.sentAt;
          g.subject = e.subject ?? g.subject; // subject of my most recent outbound
        }
      }
    } else {
      // received: a reply from someone at the company marks the group answered.
      if (isMe(e.from) || isInternal(e.from)) continue;
      const email = emailAddr(e.from);
      if (!email) continue;
      const g = getGroup(email);
      if (!g.lastIn || e.sentAt > g.lastIn) g.lastIn = e.sentAt;
    }
  }
  trace(`parsed: ${myOutbound} email(s) I sent; ${groups.size} group(s) touched`);

  // Keep only groups I actually emailed (have an outbound).
  const contacts = [...groups.values()].filter((g) => g.lastOut);
  trace(`companies/contacts with my outbound: ${contacts.length}`);

  // 4) Upsert into email_threads, deduped by source_ref = grp:<company-or-email>.
  const { data: existing } = await supabase
    .from("email_threads")
    .select("id, source_ref, last_outbound_at, status");
  const byRef = new Map(
    (existing ?? []).filter((t) => t.source_ref).map((t) => [t.source_ref as string, t]),
  );

  let added = 0;
  let updated = 0;
  let answered = 0;
  for (const g of contacts) {
    const names = [...g.names].sort((a, b) => a.localeCompare(b));
    const contactName = names.length ? names.join(", ") : [...g.emails][0] ?? g.key;
    const contactEmail = g.emails.size === 1 ? [...g.emails][0] : null;
    const ref = `grp:${g.key}`;
    const replied = !!g.lastIn && (!g.lastOut || g.lastIn >= g.lastOut);
    const status = replied ? "answered" : "no_answer";
    if (replied) answered += 1;
    const ex = byRef.get(ref);
    if (!ex) {
      const { error } = await supabase.from("email_threads").insert({
        owner_id: user.id,
        contact_name: contactName,
        contact_email: contactEmail,
        company: g.domain,
        subject: g.subject,
        last_outbound_at: g.lastOut,
        last_inbound_at: g.lastIn,
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
          contact_name: contactName,
          contact_email: contactEmail,
          company: g.domain,
          last_outbound_at: g.lastOut,
          last_inbound_at: g.lastIn,
          status: newStatus,
          ...(g.subject ? { subject: g.subject } : {}),
        })
        .eq("id", ex.id);
      if (!error) updated += 1;
    }
  }
  trace(`upsert: added=${added} updated=${updated} (answered=${answered})`);

  return NextResponse.json({ added, updated, answered, debug: steps.join("\n") });
}
