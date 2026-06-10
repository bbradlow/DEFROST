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
