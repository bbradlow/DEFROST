/**
 * OpenRouter helpers. Server-side only — relies on OPENROUTER_API_KEY which
 * must never reach the client.
 */

const BASE = "https://openrouter.ai/api/v1";

/**
 * Free-models auto-router. Confirmed live on OpenRouter: it selects a free
 * model at random and filters for the capabilities a request needs. We use it
 * as the default fallback when a chosen model errors or is unavailable.
 * (Free model IDs churn, so we never hardcode a specific one as the fallback.)
 */
export const FREE_ROUTER_ID = "openrouter/free";

function headers() {
  return {
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    "Content-Type": "application/json",
    // Optional attribution headers (safe, OpenRouter leaderboard only):
    "HTTP-Referer": process.env.OPENROUTER_APP_URL ?? "http://localhost:3000",
    "X-Title": process.env.OPENROUTER_APP_TITLE ?? "Cold Outreach Generator",
  };
}

type RawModel = {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
};

/**
 * Fetch the live model list and keep only free ones. "Free" = id ends with
 * ":free" OR both prompt and completion pricing parse to 0. The free-router
 * (openrouter/free) is prepended so it's always selectable.
 */
export async function listFreeModels() {
  const res = await fetch(`${BASE}/models`, {
    headers: headers(),
    // models change often; cache briefly at the edge
    next: { revalidate: 300 },
  });
  if (!res.ok) {
    throw new Error(`OpenRouter /models returned ${res.status}`);
  }
  const json = (await res.json()) as { data?: RawModel[] };
  const data = json.data ?? [];

  const isFree = (m: RawModel) => {
    if (m.id?.endsWith(":free")) return true;
    const p = parseFloat(m.pricing?.prompt ?? "x");
    const c = parseFloat(m.pricing?.completion ?? "x");
    return Number.isFinite(p) && Number.isFinite(c) && p === 0 && c === 0;
  };

  const free = data
    .filter(isFree)
    .map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      contextLength: m.context_length ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return [
    {
      id: FREE_ROUTER_ID,
      name: "Free Models Router (auto-picks a free model)",
      contextLength: null as number | null,
    },
    ...free,
  ];
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

async function rawChat(model: string, messages: ChatMessage[]) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ model, messages, temperature: 0.7 }),
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      (json && (json.error?.message || json.error)) ||
      `OpenRouter error ${res.status}`;
    const err = new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    // surface rate-limit (429) so the client can back off
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  const content: string = json?.choices?.[0]?.message?.content ?? "";
  return content.trim();
}

/**
 * Chat completion with a single fallback to the free-router if the chosen
 * model errors (but NOT on 429 — that's a quota issue the client should retry).
 */
export async function chatWithFallback(
  model: string,
  messages: ChatMessage[],
): Promise<{ content: string; modelUsed: string }> {
  try {
    const content = await rawChat(model, messages);
    return { content, modelUsed: model };
  } catch (err) {
    const status = (err as Error & { status?: number }).status;
    if (status === 429) throw err; // let the caller throttle/retry
    if (model === FREE_ROUTER_ID) throw err; // already on fallback
    // try the free auto-router once
    const content = await rawChat(FREE_ROUTER_ID, messages);
    return { content, modelUsed: FREE_ROUTER_ID };
  }
}
