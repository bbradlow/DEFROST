/**
 * Affinity API v2 client (server-only). Bearer auth: Authorization: Bearer <key>.
 * Base https://api.affinity.co/v2. The same Affinity API key works for v2 as
 * long as the account tier supports it (Scale / Advanced / Enterprise).
 *
 * The v2 /emails endpoint is the key win: it returns every email the key owner
 * can see, with direction (sent/received), from, to/cc, subject and sentAt —
 * cursor-paginated and filterable by sentAt. That gives true per-user outbound
 * plus automatic reply detection, with no per-contact/per-org fan-out.
 */

const BASE = "https://api.affinity.co/v2";

export function affinityConfigured(): boolean {
  return !!process.env.AFFINITY_API_KEY;
}

function authHeader(): string {
  return `Bearer ${process.env.AFFINITY_API_KEY ?? ""}`;
}

type Result<T> = { ok: boolean; status: number; data: T | null; raw: string };

async function getUrl<T>(url: string): Promise<Result<T>> {
  const res = await fetch(url, {
    headers: { Authorization: authHeader(), Accept: "application/json" },
  });
  const text = await res.text().catch(() => "");
  let data: T | null = null;
  try {
    data = text ? (JSON.parse(text) as T) : null;
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data, raw: text.slice(0, 300) };
}

// ---- whoami ----------------------------------------------------------------

export type WhoAmI = {
  user?: { id: number; firstName: string; lastName: string | null; emailAddress: string };
  tenant?: { id: number; name: string; subdomain: string };
  grant?: { type: string; scopes: string[] };
};

export function whoami() {
  return getUrl<WhoAmI>(`${BASE}/auth/whoami`);
}

// ---- emails ----------------------------------------------------------------

export type PersonData = {
  id: number;
  firstName: string | null;
  lastName: string | null;
  primaryEmailAddress: string | null;
  type: "internal" | "collaborator" | "external";
};
export type Attendee = { emailAddress: string | null; person: PersonData | null };
export type AttendeesPreview = { data: Attendee[]; totalCount: number };
export type EmailV2 = {
  id: number;
  sentAt: string;
  direction: "sent" | "received";
  subject: string | null;
  from: Attendee;
  toParticipantsPreview: AttendeesPreview;
  ccParticipantsPreview: AttendeesPreview;
};
type EmailPaged = { data: EmailV2[]; pagination: { prevUrl: string | null; nextUrl: string | null } };

/**
 * Pull all emails sent on/after `sinceISO`, following cursor pagination.
 * Returns the collected emails plus a short trace. Bounded by maxPages.
 */
export async function fetchEmailsSince(sinceISO: string, maxPages = 30) {
  const filter = `sentAt>=${sinceISO}`;
  const first = `${BASE}/emails?limit=100&filter=${encodeURIComponent(filter)}`;
  const emails: EmailV2[] = [];
  let url: string | null = first;
  let pages = 0;
  let lastStatus = 0;
  let firstRaw = "";
  while (url && pages < maxPages) {
    const r: Result<EmailPaged> = await getUrl<EmailPaged>(url);
    lastStatus = r.status;
    if (!firstRaw) firstRaw = r.raw;
    if (!r.ok || !r.data) {
      return { ok: false, status: r.status, emails, pages, firstRaw, raw: r.raw };
    }
    emails.push(...(r.data.data ?? []));
    url = r.data.pagination?.nextUrl ?? null;
    pages += 1;
  }
  return { ok: true, status: lastStatus, emails, pages, firstRaw, raw: firstRaw };
}

export function attendeeName(a: Attendee): string {
  const p = a.person;
  const nm = p ? `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() : "";
  return nm || a.emailAddress || "Unknown";
}
