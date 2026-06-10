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
  architecture?: { output_modalities?: string[] };
};

function perMillion(x: string | undefined): number {
  const n = parseFloat(x ?? "");
  return Number.isFinite(n) ? n * 1_000_000 : NaN;
}

function fmtPrice(perM: number): string {
  if (!Number.isFinite(perM)) return "?";
  if (perM === 0) return "$0";
  if (perM < 0.1) return `$${perM.toFixed(3)}`;
  return `$${perM.toFixed(2)}`;
}

/**
 * Fetch the live model list. Includes both free and paid models (a paid
 * OpenRouter key bills usage against your credit balance). Each entry is
 * labelled with its price per 1M tokens. Non-text models (image/audio/etc.)
 * are filtered out. Free models are listed first; the free auto-router is
 * always prepended as a zero-cost option and remains the error fallback.
 */
export async function listModels() {
  const res = await fetch(`${BASE}/models`, {
    headers: headers(),
    next: { revalidate: 300 },
  });
  if (!res.ok) {
    throw new Error(`OpenRouter /models returned ${res.status}`);
  }
  const json = (await res.json()) as { data?: RawModel[] };
  const data = json.data ?? [];

  // Keep only models that can output text (drops image/audio/embedding models).
  const outputsText = (m: RawModel) => {
    const out = m.architecture?.output_modalities;
    return Array.isArray(out) ? out.includes("text") : true;
  };

  const models = data
    .filter(outputsText)
    .map((m) => {
      const pIn = perMillion(m.pricing?.prompt);
      const pOut = perMillion(m.pricing?.completion);
      const free =
        m.id.endsWith(":free") ||
        (Number.isFinite(pIn) && Number.isFinite(pOut) && pIn === 0 && pOut === 0);
      const priceLabel = free
        ? "Free"
        : Number.isFinite(pIn) && Number.isFinite(pOut)
          ? `${fmtPrice(pIn)}/${fmtPrice(pOut)} per 1M`
          : "Paid";
      return {
        id: m.id,
        name: m.name ?? m.id,
        contextLength: m.context_length ?? null,
        free,
        priceLabel,
      };
    })
    // Free first, then alphabetical by name.
    .sort((a, b) =>
      a.free === b.free ? a.name.localeCompare(b.name) : a.free ? -1 : 1,
    );

  return [
    {
      id: FREE_ROUTER_ID,
      name: "Free Models Router (auto-picks a free model)",
      contextLength: null as number | null,
      free: true,
      priceLabel: "Free",
    },
    ...models,
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
