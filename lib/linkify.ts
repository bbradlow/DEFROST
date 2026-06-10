/**
 * Turn plain email text into clickable links — both for on-screen rendering
 * and for rich-text (HTML) clipboard copy, so links survive a paste into
 * Gmail / Outlook / etc.
 *
 * We deliberately only linkify *unambiguous* targets:
 *   - explicit URLs with a scheme (https://…, http://…)
 *   - www-prefixed URLs (www.example.com/…)
 *   - email addresses (name@domain.tld)
 * Bare domains like "Acme Inc." are left alone to avoid false positives.
 */

export type LinkPart =
  | { kind: "text"; value: string }
  | { kind: "link"; value: string; href: string };

// Order matters: emails first so we don't half-match them as URLs.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const URL_RE = /(?:https?:\/\/|www\.)[^\s<>()]+/;
const COMBINED = new RegExp(`(${EMAIL_RE.source})|(${URL_RE.source})`, "g");

// Trailing punctuation that's almost never part of the link itself.
const TRAILING = /[.,;:!?]+$/;

/** Split text into ordered parts (plain text + links). */
export function linkifyParts(input: string): LinkPart[] {
  const text = input ?? "";
  const parts: LinkPart[] = [];
  let last = 0;

  for (const match of text.matchAll(COMBINED)) {
    const start = match.index ?? 0;
    let token = match[0];
    let trailing = "";

    // Strip trailing punctuation back into the text stream.
    const t = token.match(TRAILING);
    if (t) {
      trailing = t[0];
      token = token.slice(0, -trailing.length);
    }
    // Balance a trailing ")" only if there's no matching "(" inside.
    if (token.endsWith(")") && !token.includes("(")) {
      trailing = ")" + trailing;
      token = token.slice(0, -1);
    }

    if (start > last) {
      parts.push({ kind: "text", value: text.slice(last, start) });
    }

    const isEmail = !!match[1];
    const href = isEmail
      ? `mailto:${token}`
      : token.startsWith("www.")
        ? `https://${token}`
        : token;

    parts.push({ kind: "link", value: token, href });

    if (trailing) parts.push({ kind: "text", value: trailing });
    last = start + match[0].length;
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

/**
 * Render text to an HTML fragment with anchors and <br> line breaks.
 * Used as the `text/html` flavor when copying to the clipboard.
 */
export function linkifyToHtml(input: string): string {
  return linkifyParts(input)
    .map((p) => {
      if (p.kind === "link") {
        return `<a href="${escapeHtml(p.href)}">${escapeHtml(p.value)}</a>`;
      }
      return escapeHtml(p.value);
    })
    .join("")
    .replace(/\r?\n/g, "<br>");
}
