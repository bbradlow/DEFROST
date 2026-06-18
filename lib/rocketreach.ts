/**
 * RocketReach person lookup — server-side only. Uses ROCKETREACH_API_KEY.
 *
 * Given a person's name + company, returns the best professional email, or ""
 * when none is found (or no key is configured). RocketReach lookups can be
 * asynchronous: the first response may carry status "searching", in which case
 * we poll by profile id a few times before giving up. A miss costs no credits;
 * credits are only spent when a verified contact is actually returned.
 *
 * Docs: GET https://api.rocketreach.co/api/v2/person/lookup
 *   header: Api-Key: <key>
 *   params: name, current_employer  (or id, or linkedin_url)
 */

const BASE = "https://api.rocketreach.co/api/v2";

type RREmail = { email: string; type?: string; grade?: string };
type RRProfile = {
  id?: number;
  status?: string;
  emails?: RREmail[];
  name?: string;
  current_employer?: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function rocketreachConfigured(): boolean {
  return !!process.env.ROCKETREACH_API_KEY;
}

function gradeRank(g?: string): number {
  const order: Record<string, number> = { A: 5, B: 4, C: 3, D: 2, F: 1 };
  return g ? (order[g.toUpperCase()] ?? 0) : 0;
}

function emailDomain(e: string): string {
  const at = e.lastIndexOf("@");
  return at >= 0 ? e.slice(at + 1).toLowerCase() : "";
}

/**
 * Prefer an email that matches the company's own domain (a strong verification
 * signal), then a professional email, then the best validation grade.
 */
function pickBestEmail(emails?: RREmail[], preferDomain?: string): string {
  if (!emails?.length) return "";
  const dom = (preferDomain ?? "").replace(/^www\./, "").toLowerCase();
  const sorted = [...emails].sort((a, b) => {
    if (dom) {
      const am = emailDomain(a.email).endsWith(dom) ? 1 : 0;
      const bm = emailDomain(b.email).endsWith(dom) ? 1 : 0;
      if (am !== bm) return bm - am;
    }
    const ap = a.type === "professional" ? 1 : 0;
    const bp = b.type === "professional" ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return gradeRank(b.grade) - gradeRank(a.grade);
  });
  return sorted[0]?.email ?? "";
}

async function lookup(params: Record<string, string>): Promise<RRProfile | null> {
  const key = process.env.ROCKETREACH_API_KEY;
  if (!key) return null;
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE}/person/lookup?${qs}`, {
    headers: { "Api-Key": key, Accept: "application/json" },
  });
  if (!res.ok) return null; // 404 = no match (no credit charged)
  const json = await res.json().catch(() => null);
  if (Array.isArray(json)) return (json[0] as RRProfile) ?? null;
  return (json as RRProfile) ?? null;
}

/**
 * Resolve a single person's best email. Returns "" if nothing is found or
 * RocketReach isn't configured. Never throws.
 */
export async function lookupEmail(
  name: string,
  company: string,
  preferDomain?: string,
): Promise<string> {
  if (!rocketreachConfigured()) return "";
  const n = name.trim();
  if (!n) return "";

  try {
    let profile = await lookup(
      company.trim() ? { name: n, current_employer: company.trim() } : { name: n },
    );
    if (!profile) return "";

    let email = pickBestEmail(profile.emails, preferDomain);

    // Poll by id while the contact search is still running.
    let attempts = 0;
    const pending = (s?: string) =>
      !!s && ["searching", "waiting", "progress"].includes(s);
    while (!email && profile?.id && pending(profile.status) && attempts < 3) {
      attempts += 1;
      await sleep(1200);
      profile = await lookup({ id: String(profile.id) });
      if (!profile) break;
      email = pickBestEmail(profile.emails, preferDomain);
    }
    return email;
  } catch {
    return "";
  }
}
