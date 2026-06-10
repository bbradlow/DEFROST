/**
 * Turn email text into clickable links for on-screen rendering, rich-text
 * (HTML) clipboard copy, and clean plain-text copy.
 *
 * Recognized, in priority order:
 *   1. Markdown links: [label](https://… or mailto:…) — renders the LABEL as a
 *      clickable link and hides the URL (the normal email experience).
 *   2. Bare email addresses: name@domain.tld -> mailto link.
 *   3. Bare URLs with a scheme or www.: https://…, www.…
 * Bare domains like "acme.com" are intentionally left alone (false positives).
 */

export type LinkPart =
  | { kind: "text"; value: string }
  | { kind: "link"; value: string; href: string };

// Sub-patterns (no capture groups except where noted).
const MD = /\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/; // 2 groups: label, url
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const URL = /(?:https?:\/\/|www\.)[^\s<>()]+/;

// Combined scanner. Group map:
//   m[1] = whole markdown, m[2] = md label, m[3] = md url
//   m[4] = bare email
//   m[5] = bare url
const COMBINED = new RegExp(
  `(${MD.source})|(${EMAIL.source})|(${URL.source})`,
  "g",
);

const TRAILING = /[.,;:!?]+$/;

export function linkifyParts(input: string): LinkPart[] {
  const text = input ?? "";
  const parts: LinkPart[] = [];
  let last = 0;

  for (const m of text.matchAll(COMBINED)) {
    const start = m.index ?? 0;
    const whole = m[0];

    if (start > last) {
      parts.push({ kind: "text", value: text.slice(last, start) });
    }

    if (m[2] !== undefined && m[3] !== undefined) {
      // 1) Markdown link — label is the visible text, url is hidden.
      parts.push({ kind: "link", value: m[2], href: m[3] });
      last = start + whole.length;
      continue;
    }

    // 2) / 3) Bare email or URL: trim trailing punctuation back into the text.
    let token = whole;
    let trailing = "";
    const t = token.match(TRAILING);
    if (t) {
      trailing = t[0];
      token = token.slice(0, -trailing.length);
    }
    if (token.endsWith(")") && !token.includes("(")) {
      trailing = ")" + trailing;
      token = token.slice(0, -1);
    }

    const isEmail = m[4] !== undefined;
    const href = isEmail
      ? `mailto:${token}`
      : token.startsWith("www.")
        ? `https://${token}`
        : token;

    parts.push({ kind: "link", value: token, href });
    if (trailing) parts.push({ kind: "text", value: trailing });
    last = start + whole.length;
  }

  if (last < text.length) {
    parts.push({ kind: "text", value: text.slice(last) });
  }
  return parts;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** True when the link's visible text already is its target (no hidden URL). */
function isAutolink(value: string, href: string): boolean {
  return (
    href === value ||
    href === `https://${value}` || // www. case
    href === `mailto:${value}` // bare email
  );
}

/**
 * HTML fragment with anchors and <br> line breaks. Markdown links become
 * <a href="url">label</a>, so a paste into Gmail/Outlook shows clean,
 * clickable text with the URL hidden.
 */
export function linkifyToHtml(input: string): string {
  return linkifyParts(input)
    .map((p) =>
      p.kind === "link"
        ? `<a href="${escapeHtml(p.href)}">${escapeHtml(p.value)}</a>`
        : escapeHtml(p.value),
    )
    .join("")
    .replace(/\r?\n/g, "<br>");
}

/**
 * Plain-text rendering for the text/plain clipboard flavor. Autolinks stay as
 * the bare URL/email; labelled markdown links become "label (url)" so the
 * destination survives a plain-text paste.
 */
export function linkifyToPlain(input: string): string {
  return linkifyParts(input)
    .map((p) => {
      if (p.kind === "text") return p.value;
      if (isAutolink(p.value, p.href)) return p.value;
      const target = p.href.startsWith("mailto:") ? p.href.slice(7) : p.href;
      return `${p.value} (${target})`;
    })
    .join("");
}
