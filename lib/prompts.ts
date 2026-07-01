import type { Recipient, Writer } from "./types";

/**
 * DEFAULT base voice for every cold email. This is the tunable "house style".
 * The UI exposes it in a textarea so you can edit it per session; this constant
 * is just the starting point. Flagged in the README so you can change it.
 */
export const DEFAULT_BASE_PROMPT = `You write cold outreach emails for a B2B/investor context.

Voice and rules:
- Concise: 90–150 words. Every sentence earns its place.
- Specific and personalized: reference something real about the recipient's
  company drawn from the provided context. No generic flattery.
- Plain, direct, human. No corporate filler, no hype, no exclamation marks,
  no em-dash-stuffed run-ons.
- One clear ask near the end (usually a short call or reply), low-friction.
- Open with a line that shows you did the homework, not "I hope this finds you well".
- Do NOT invent facts, metrics, funding rounds, or quotes. If the context is
  thin, stay high-level rather than fabricating specifics.
- Output the EMAIL BODY ONLY. No subject line. No "Subject:" prefix.
- End with a sign-off using the sender's name (and title if given).`;

function clean(s?: string | null) {
  return (s ?? "").trim();
}

/** Ensure a URL has a scheme so it renders as a clickable link. */
function ensureScheme(url: string): string {
  if (!url) return url;
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/** Builds the system message: base style + how to sign off as this writer. */
export function buildSystemPrompt(basePrompt: string, writer: Writer): string {
  const lines = [
    basePrompt.trim(),
    "",
    "You are writing as this sender. Adopt their voice and sign off as them:",
    `- Name: ${clean(writer.name)}`,
  ];
  if (clean(writer.title)) lines.push(`- Title: ${clean(writer.title)}`);
  if (clean(writer.signature)) {
    lines.push(
      "- Use this exact signature block at the very end, verbatim:",
      clean(writer.signature),
    );
  } else {
    lines.push(
      `- Close with a short sign-off followed by "${clean(writer.name)}"${
        clean(writer.title) ? ` and the title "${clean(writer.title)}"` : ""
      }.`,
    );
  }

  if (clean(writer.calendly)) {
    const url = ensureScheme(clean(writer.calendly));
    lines.push(
      "",
      "Call to action — scheduling link:",
      `- End the email by inviting the recipient to book a short call, and include this exact scheduling link: my Calendly (${url})`,
      "- Use that URL verbatim. Do not alter, shorten, or replace it, and do not invent a different scheduling link.",
    );
  }

  return lines.join("\n");
}

/** Builds the user message describing this specific email to write. */
export function buildUserPrompt(opts: {
  company: string;
  website: string;
  recipients: Recipient[];
  additionalInfo: string;
  siteContext?: string;
}): string {
  const names = opts.recipients
    .map((r) => clean(r.name))
    .filter(Boolean);

  const parts: string[] = [];
  parts.push(`Company being emailed: ${clean(opts.company) || "(unknown)"}`);
  if (clean(opts.website)) parts.push(`Website: ${clean(opts.website)}`);
  if (names.length) {
    parts.push(`Address the email to: ${names.join(" and ")}.`);
  } else {
    parts.push(
      "No specific recipient name is known — use a brief, professional greeting.",
    );
  }

  parts.push("");
  parts.push(
    "INSTRUCTIONS FOR THIS EMAIL (this defines the structure and what to say — follow it closely):",
  );
  parts.push(clean(opts.additionalInfo) || "(none provided — use the base style and the website context for an angle.)");

  if (clean(opts.siteContext)) {
    parts.push("");
    parts.push(
      "Context extracted from the company's website (use for personalization; do not quote at length, do not fabricate beyond it):",
    );
    parts.push('"""');
    parts.push(clean(opts.siteContext).slice(0, 6000));
    parts.push('"""');
  }

  parts.push("");
  parts.push("Write the email body now. Body only, no subject line.");
  return parts.join("\n");
}

/** Prompt for extracting likely recipients from website text. */
/**
 * Research-style discovery: find the company's official website (if unknown)
 * and its most senior outreach targets, using web search. Strict JSON out.
 */
export function buildEnrichmentMessages(
  company: string,
  website?: string,
  siteText?: string,
) {
  const system =
    "You are a research assistant. For a given company, find its official website and " +
    "the most senior people to address cold outreach to (prefer founder/CEO, else the most " +
    "senior leader you can verify). Use web search for accurate, current info. " +
    "Return STRICT JSON only — no prose, no markdown fences.";

  const known = clean(website) ? `Known website: ${clean(website)}\n` : "";
  const ctx = siteText
    ? `\n\nWebsite text that may help:\n"""\n${siteText.slice(0, 6000)}\n"""`
    : "";

  const user = `Company: ${clean(company) || "(unknown)"}
${known}
Find:
1) The company's official website homepage URL (https://...). If a known website is given above, prefer it.
2) Up to 2 of the most senior people for cold outreach (prefer founder/CEO).

Return JSON in exactly this shape:
{"website":"https://...","recipients":[{"name":"Full Name","role":"Their role"}]}

Only include real, verifiable people. If you cannot verify someone, include fewer (or an empty array). Do NOT invent names.${ctx}`;

  return [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];
}

/**
 * Build messages for a short, polite follow-up to a prospect who hasn't
 * replied. Written in the writer's voice, optionally including their Calendly.
 */
export function buildFollowupMessages(args: {
  writer: Writer;
  contactName: string;
  company?: string | null;
  subject?: string | null;
  daysSince: number;
  snippet?: string | null;
  extraInstructions?: string | null;
}) {
  const { writer, contactName, company, subject, daysSince, snippet, extraInstructions } = args;

  const lines = [
    "You are writing a brief, polite follow-up email to a prospect who has not replied to an earlier outreach email.",
    "Rules:",
    "- Keep it short: 2–4 sentences. Warm, low-pressure, never pushy or guilt-tripping.",
    "- Do NOT reintroduce yourself at length; this is a nudge, not a new pitch.",
    "- Add one small new reason to reply or a gentle, specific prompt.",
    "- Do not over-apologize for following up.",
    "- Body only — no subject line.",
    "",
    "Write as this sender and sign off as them:",
    `- Name: ${clean(writer.name)}`,
  ];
  if (clean(writer.title)) lines.push(`- Title: ${clean(writer.title)}`);
  if (clean(writer.signature)) {
    lines.push("- Use this exact signature block at the very end, verbatim:", clean(writer.signature));
  } else {
    lines.push(`- Close with a short sign-off followed by "${clean(writer.name)}".`);
  }
  if (clean(writer.calendly)) {
    const url = ensureScheme(clean(writer.calendly));
    lines.push(`- Offer to book time, written as a clickable link: my Calendly (${url}). Use this URL verbatim.`);
  }

  if (clean(extraInstructions)) {
    lines.push("", "Additional style guidance for this follow-up:", clean(extraInstructions));
  }

  const ctx = [
    `Contact: ${clean(contactName)}${clean(company) ? ` at ${clean(company)}` : ""}`,
    clean(subject) ? `Original subject: ${clean(subject)}` : "",
    `Days since my last email: ${daysSince}`,
    "They have not replied.",
    clean(snippet) ? `What the original was about / notes: ${clean(snippet)}` : "",
    "",
    "Write the follow-up email body now.",
  ]
    .filter(Boolean)
    .join("\n");

  return [
    { role: "system" as const, content: lines.join("\n") },
    { role: "user" as const, content: ctx },
  ];
}

export function buildFounderExtractionMessages(
  company: string,
  siteText: string,
) {
  const system =
    "You identify the most likely email recipients for cold outreach to a company: " +
    "founders, CEO/CTO/COO, or the most relevant senior leadership. " +
    "Return STRICT JSON only — no prose, no markdown fences.";

  const user = `Company: ${clean(company) || "(unknown)"}

From the website text below, identify up to 2 most likely outreach recipients (prefer founders / C-suite). Return JSON in exactly this shape:
{"recipients":[{"name":"Full Name","role":"Their role"}]}

If you cannot find any real person's name, return {"recipients":[]}. Do NOT invent names.

WEBSITE TEXT:
"""
${siteText.slice(0, 8000)}
"""`;

  return [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];
}

// ---- Built-in "just fill in the blanks" follow-up template --------------------
// A fixed, deterministic follow-up: no Calendly link, no model embellishment.
// Selected via the Template dropdown; handled directly (no LLM call).
export const FILL_BLANKS_TEMPLATE_ID = "__fillblanks__";

export const FILL_BLANKS_TEMPLATE = `Hi {Recipient},

Just wanted to follow up here, please let me know if you have the time to chat in the coming weeks!

Best,
{Writer}`;

/** Turn "Alice Smith, Bob Jones" into "Alice and Bob" for the greeting. */
export function recipientFirstNames(contactName: string): string {
  const firsts = (contactName ?? "")
    .split(",")
    .map((s) => s.trim().split(/\s+/)[0])
    .filter(Boolean);
  if (firsts.length === 0) return (contactName ?? "").trim();
  if (firsts.length === 1) return firsts[0];
  if (firsts.length === 2) return `${firsts[0]} and ${firsts[1]}`;
  return `${firsts.slice(0, -1).join(", ")}, and ${firsts[firsts.length - 1]}`;
}

export function fillBlanks(recipient: string, writer: string): string {
  return FILL_BLANKS_TEMPLATE.replace(/\{Recipient\}/g, recipient).replace(/\{Writer\}/g, writer);
}
