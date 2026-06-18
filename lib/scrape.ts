/**
 * Best-effort website fetch + readable-text extraction. Runs server-side only.
 *
 * We do a plain HTTP fetch (no headless browser), so JS-heavy single-page apps
 * may return very little usable text. Callers should treat a short result as a
 * weak signal and let the user fill recipients in manually.
 */

function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let url = trimmed;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const parsed = new URL(url);
    // Block obvious SSRF targets (localhost / private ranges by hostname).
    const host = parsed.hostname;
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host.endsWith(".local") ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function stripHtml(html: string): string {
  return (
    html
      // remove non-content elements wholesale
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      // turn block boundaries into spaces
      .replace(/<\/(p|div|li|h[1-6]|section|article|br)>/gi, " \n")
      .replace(/<[^>]+>/g, " ")
      // decode a few common entities
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
      .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
      // collapse whitespace
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n\s*\n+/g, "\n\n")
      .trim()
  );
}

export type ScrapeResult = {
  ok: boolean;
  text: string;
  weak: boolean;
  note?: string;
};

export async function scrapeWebsite(rawUrl: string): Promise<ScrapeResult> {
  const url = normalizeUrl(rawUrl);
  if (!url) {
    return { ok: false, text: "", weak: true, note: "Invalid or blocked URL." };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);

    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; ColdOutreachGen/1.0; +https://openrouter.ai)",
        Accept: "text/html,application/xhtml+xml",
      },
    }).finally(() => clearTimeout(timeout));

    if (!res.ok) {
      return {
        ok: false,
        text: "",
        weak: true,
        note: `Site returned HTTP ${res.status}.`,
      };
    }

    const ctype = res.headers.get("content-type") ?? "";
    if (!ctype.includes("html") && !ctype.includes("text")) {
      return {
        ok: false,
        text: "",
        weak: true,
        note: "Site did not return HTML.",
      };
    }

    const html = await res.text();
    const text = stripHtml(html);
    const weak = text.length < 400;
    return {
      ok: true,
      text,
      weak,
      note: weak
        ? "Extracted very little text (likely a JS-heavy site). Add recipients manually."
        : undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "fetch failed";
    return { ok: false, text: "", weak: true, note: `Could not fetch site: ${msg}` };
  }
}

// ---------------------------------------------------------------------------
// Richer scrape for recipient discovery: homepage + common "people" pages.
// ---------------------------------------------------------------------------

const PEOPLE_PATHS = ["/about", "/team", "/leadership", "/company"];

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; ColdOutreachGen/1.0; +https://openrouter.ai)",
        Accept: "text/html,application/xhtml+xml",
      },
    }).finally(() => clearTimeout(t));
    if (!res.ok) return "";
    const ctype = res.headers.get("content-type") ?? "";
    if (!ctype.includes("html") && !ctype.includes("text")) return "";
    return stripHtml(await res.text());
  } catch {
    return "";
  }
}

/**
 * Fetch the homepage plus a few common leadership pages (about/team/...) and
 * concatenate the readable text, capped. Gives the model more to work with
 * when identifying founders/execs. Best effort — missing pages are skipped.
 */
export async function scrapeForRecipients(rawUrl: string): Promise<ScrapeResult> {
  const url = normalizeUrl(rawUrl);
  if (!url) {
    return { ok: false, text: "", weak: true, note: "Invalid or blocked URL." };
  }

  const origin = new URL(url).origin;
  const targets = [url, ...PEOPLE_PATHS.map((p) => origin + p)];

  const texts = await Promise.all(
    targets.map((u, i) => fetchText(u, i === 0 ? 12_000 : 5_000)),
  );

  const text = texts.filter(Boolean).join("\n\n").slice(0, 12_000).trim();
  const weak = text.length < 400;
  return {
    ok: text.length > 0,
    text,
    weak,
    note: weak
      ? "Extracted very little text (likely a JS-heavy site). Add recipients manually."
      : undefined,
  };
}
