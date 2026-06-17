import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { scrapeForRecipients } from "@/lib/scrape";
import { chatWithFallback } from "@/lib/openrouter";
import { buildFounderExtractionMessages } from "@/lib/prompts";
import { lookupEmail, rocketreachConfigured } from "@/lib/rocketreach";
import type { FoundersResult } from "@/lib/types";

// Scraping several pages + a model call + RocketReach polling can take a while.
export const maxDuration = 60;

// Founder/exec name extraction runs on Claude Haiku for reliable sourcing,
// regardless of which model the user picked for email generation. Override
// with FOUNDER_MODEL if you want a different one.
const FOUNDER_MODEL = process.env.FOUNDER_MODEL || "anthropic/claude-haiku-4.5";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { website?: string; company?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const website = (body.website ?? "").trim();
  const company = (body.company ?? "").trim();

  if (!website) {
    return NextResponse.json(
      { error: "A website URL is required to find recipients." },
      { status: 400 },
    );
  }

  // 1) Fetch homepage + leadership pages and extract readable text.
  const scrape = await scrapeForRecipients(website);
  const siteContext = scrape.text;

  if (!scrape.ok || scrape.weak) {
    const result: FoundersResult = {
      recipients: [],
      siteContext,
      weak: true,
      note: scrape.note ?? "Extracted little usable text. Add recipients manually.",
    };
    return NextResponse.json(result);
  }

  // 2) Ask Claude Haiku for the top 2 likely recipients as strict JSON.
  try {
    const messages = buildFounderExtractionMessages(company, siteContext);
    const { content } = await chatWithFallback(FOUNDER_MODEL, messages, 0.2);

    let people: { name: string; role?: string }[] = [];
    try {
      const cleaned = content.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed?.recipients)) {
        people = parsed.recipients
          .filter(
            (r: unknown) =>
              r && typeof (r as { name?: unknown }).name === "string",
          )
          .slice(0, 2)
          .map((r: { name: string; role?: string }) => ({
            name: r.name.trim(),
            role: typeof r.role === "string" ? r.role.trim() : undefined,
          }));
      }
    } catch {
      people = [];
    }

    // 3) Pull verified emails from RocketReach (parallel, best-effort).
    let recipients = people.map((p) => ({ ...p, email: "" }));
    if (rocketreachConfigured() && people.length) {
      const emails = await Promise.all(
        people.map((p) => lookupEmail(p.name, company)),
      );
      recipients = people.map((p, i) => ({ ...p, email: emails[i] || "" }));
    }

    const foundEmails = recipients.filter((r) => r.email).length;
    const note =
      people.length === 0
        ? "Could not confidently identify recipients. Add them manually."
        : !rocketreachConfigured()
          ? "Found names. Add a ROCKETREACH_API_KEY to auto-fill emails."
          : foundEmails === 0
            ? "Found names, but no verified emails matched. Add emails manually."
            : undefined;

    const result: FoundersResult = {
      recipients,
      siteContext,
      weak: people.length === 0,
      note,
    };
    return NextResponse.json(result);
  } catch (err) {
    const status = (err as Error & { status?: number }).status ?? 502;
    const message = err instanceof Error ? err.message : "Extraction failed";
    const result: FoundersResult & { error: string } = {
      recipients: [],
      siteContext,
      weak: true,
      note: "Recipient extraction failed; you can still generate and add recipients manually.",
      error: message,
    };
    return NextResponse.json(result, { status: status === 429 ? 429 : 200 });
  }
}
