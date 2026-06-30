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

// --- List / organization reads (for pipeline-driven sync) -------------------

export type AffinityListEntry = {
  id: number;
  entity_type: number; // 0 person, 1 organization, 8 opportunity
  entity_id: number;
  entity?: { id: number; name?: string; organization_ids?: number[] };
};

function entriesFrom(data: unknown): { entries: AffinityListEntry[]; next: string | null } {
  if (Array.isArray(data)) return { entries: data as AffinityListEntry[], next: null };
  const obj = (data ?? {}) as Record<string, unknown>;
  const entries = (obj.list_entries ?? obj.entries ?? []) as AffinityListEntry[];
  const next = (obj.next_page_token ?? null) as string | null;
  return { entries, next };
}

export async function getListEntries(listId: number, pageToken?: string, pageSize = 500) {
  const qs = new URLSearchParams({ page_size: String(pageSize) });
  if (pageToken) qs.set("page_token", pageToken);
  const r = await get<unknown>(`/lists/${listId}/list-entries?${qs.toString()}`);
  return { ...r, ...entriesFrom(r.data) };
}

export async function getSavedViewEntries(
  listId: number,
  viewId: number,
  pageToken?: string,
  pageSize = 500,
) {
  const qs = new URLSearchParams({ page_size: String(pageSize) });
  if (pageToken) qs.set("page_token", pageToken);
  const r = await get<unknown>(
    `/lists/${listId}/saved-views/${viewId}/list-entries?${qs.toString()}`,
  );
  return { ...r, ...entriesFrom(r.data) };
}

export type AffinityOrganization = {
  id: number;
  name?: string;
  domain?: string | null;
  domains?: string[];
  person_ids?: number[];
  interaction_dates?: Record<string, string | null>;
};

export function getOrganization(orgId: number) {
  return get<AffinityOrganization>(`/organizations/${orgId}?with_interaction_dates=true`);
}

export type AffinityOpportunity = {
  id: number;
  name?: string;
  organization_ids?: number[];
};

export function getOpportunity(oppId: number) {
  return get<AffinityOpportunity>(`/opportunities/${oppId}`);
}

/** Best last-email/interaction date from an interaction_dates object. */
export function lastEmailDate(d?: Record<string, string | null>): string {
  if (!d) return "";
  return (
    d.last_email_date ||
    d.last_interaction_date ||
    d.last_chat_message_date ||
    d.last_event_date ||
    ""
  );
}

export type AffinitySavedView = { id: number; name: string; type?: number };

export async function getSavedViews(listId: number) {
  const r = await get<{ saved_views?: AffinitySavedView[] }>(
    `/lists/${listId}/saved-views`,
  );
  const views = Array.isArray(r.data)
    ? (r.data as AffinitySavedView[])
    : (r.data?.saved_views ?? []);
  return { ...r, views };
}
