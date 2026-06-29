/**
 * Affinity API v1 client (server-only). HTTP Basic auth, API key as the
 * PASSWORD with an empty username: Authorization: Basic base64(":" + key).
 *
 * Identity strategy: internal team members generally do NOT come back from the
 * external person search, so we identify the signed-in user from /auth/whoami
 * (the key's owner) rather than searching persons by email. Every call captures
 * a raw response snippet so the sync route can surface exactly what Affinity
 * returned.
 */

const BASE = "https://api.affinity.co";

export function affinityConfigured(): boolean {
  return !!process.env.AFFINITY_API_KEY;
}

function authHeader(): string {
  const key = process.env.AFFINITY_API_KEY ?? "";
  return "Basic " + Buffer.from(`:${key}`).toString("base64");
}

type Result<T> = { ok: boolean; status: number; data: T | null; raw: string };

async function get<T>(path: string): Promise<Result<T>> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: authHeader(), Accept: "application/json" },
  });
  const text = await res.text().catch(() => "");
  let data: T | null = null;
  try {
    data = text ? (JSON.parse(text) as T) : null;
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data, raw: text.slice(0, 400) };
}

// whoami: { user: { id, firstName, lastName, emailAddress? }, tenant: { name } }
export type AffinityWhoami = {
  user?: Record<string, unknown> & {
    id?: number;
    firstName?: string;
    lastName?: string;
    emailAddress?: string;
    email?: string;
  };
  tenant?: { id?: number; name?: string; subdomain?: string };
  grant?: Record<string, unknown>;
};

export function whoami() {
  return get<AffinityWhoami>("/auth/whoami");
}

export type AffinityPerson = {
  id: number;
  type: number;
  first_name: string;
  last_name: string;
  primary_email: string | null;
  emails: string[];
  interaction_dates?: Record<string, string | null>;
};

export async function searchPersons(term: string, withInteractionDates = true) {
  const qs = new URLSearchParams({ term });
  if (withInteractionDates) qs.set("with_interaction_dates", "true");
  const r = await get<{ persons?: AffinityPerson[] }>(`/persons?${qs.toString()}`);
  return { ...r, persons: r.data?.persons ?? [] };
}

export type AffinityInteraction = {
  id: number;
  type: number;
  date?: string;
  start_time?: string;
  direction?: number;
  persons?: AffinityPerson[];
  attendees?: string[];
};

/**
 * Recent interactions for a person. v1 listing semantics are uncertain, so we
 * return the raw response too; the route logs it for tuning.
 */
export async function getPersonInteractions(personId: number, startDate?: string) {
  const qs = new URLSearchParams({ person_id: String(personId) });
  if (startDate) qs.set("start_date", startDate);
  return get<{ interactions?: AffinityInteraction[]; emails?: AffinityInteraction[] }>(
    `/interactions?${qs.toString()}`,
  );
}

/** Pull the most likely email field off the whoami user object. */
export function whoamiEmail(w: AffinityWhoami | null): string {
  const u = w?.user ?? {};
  const candidates = [u.emailAddress, u.email].filter(Boolean) as string[];
  return candidates[0] ?? "";
}
