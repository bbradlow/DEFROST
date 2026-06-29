/**
 * Affinity API v1 client (server-only). Auth is HTTP Basic with the API key as
 * the PASSWORD and an empty username: Authorization: Basic base64(":" + key).
 *
 * We use this to (a) match the signed-in DEFROST user's email to their internal
 * Affinity person, and (b) read their recent logged email interactions so they
 * can be tracked in the Follow-Up tab.
 *
 * NOTE: the v1 interactions listing is the least-documented part of the API and
 * may need a small tuning pass against your real tenant. Every call pushes to a
 * debug trace that the sync route returns, so we can see exactly what Affinity
 * sends back and adjust.
 */

const BASE = "https://api.affinity.co";

export function affinityConfigured(): boolean {
  return !!process.env.AFFINITY_API_KEY;
}

function authHeader(): string {
  const key = process.env.AFFINITY_API_KEY ?? "";
  // username empty, key as password
  return "Basic " + Buffer.from(`:${key}`).toString("base64");
}

async function get<T>(path: string): Promise<{ ok: boolean; status: number; data: T | null }> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: authHeader(), Accept: "application/json" },
  });
  let data: T | null = null;
  try {
    data = (await res.json()) as T;
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data };
}

export type AffinityWhoami = {
  user?: { id: number; firstName?: string; lastName?: string; emailAddress?: string };
  tenant?: { id: number; name?: string; subdomain?: string };
};

export async function whoami() {
  return get<AffinityWhoami>("/auth/whoami");
}

export type AffinityPerson = {
  id: number;
  type: number; // 0 external, 1 internal (per v1 docs)
  first_name: string;
  last_name: string;
  primary_email: string | null;
  emails: string[];
  interaction_dates?: {
    last_email_date?: string | null;
    first_email_date?: string | null;
    last_event_date?: string | null;
    next_event_date?: string | null;
  };
};

/** Search people by name or email. Returns the persons array (best effort). */
export async function searchPersons(term: string, withInteractionDates = true) {
  const qs = new URLSearchParams({ term });
  if (withInteractionDates) qs.set("with_interaction_dates", "true");
  const r = await get<{ persons?: AffinityPerson[] }>(`/persons?${qs.toString()}`);
  return { ...r, persons: r.data?.persons ?? [] };
}

/** Find the internal (team) person whose email matches the given address. */
export async function findInternalPersonByEmail(email: string) {
  const r = await searchPersons(email);
  const lower = email.toLowerCase();
  const match =
    r.persons.find(
      (p) =>
        (p.primary_email ?? "").toLowerCase() === lower ||
        p.emails?.some((e) => e.toLowerCase() === lower),
    ) ?? null;
  return { ...r, match };
}

export type AffinityInteraction = {
  id: number;
  type: number; // email types vs meeting/call (type 0). v1 encodes email separately.
  date?: string;
  start_time?: string;
  direction?: number; // 0 = sent, 1 = received (best-effort per v1)
  persons?: AffinityPerson[];
  attendees?: string[];
};

/**
 * Fetch interactions for a person. The v1 endpoint shape varies; we pass the
 * person id and (optionally) a start date, and return whatever comes back so
 * the caller can filter to emails. Wrapped so a non-200 won't throw.
 */
export async function getPersonInteractions(personId: number, startDate?: string) {
  const qs = new URLSearchParams({ person_id: String(personId) });
  if (startDate) qs.set("start_date", startDate);
  return get<{ interactions?: AffinityInteraction[]; emails?: AffinityInteraction[] }>(
    `/interactions?${qs.toString()}`,
  );
}
