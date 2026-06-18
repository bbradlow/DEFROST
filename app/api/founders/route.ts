import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { scrapeForRecipients } from "@/lib/scrape";
import { chatWithSearch, chatWithFallback } from "@/lib/openrouter";
import {
  buildEnrichmentMessages,
  buildFounderExtractionMessages,
} from "@/lib/prompts";
import { lookupEmail, rocketreachConfigured } from "@/lib/rocketreach";
import type { FoundersResult } from "@/lib/types";

// Web search + scrape + a model call + RocketReach polling can take a while.
export const maxDuration = 60;

// Founder/website discovery runs on Claude Haiku (with web search) regardless
// of the generation model. Override with FOUNDER_MODEL.
const FOUNDER_MODEL = process.env.FOUNDER_MODEL || "anthropic/claude-haiku-4.5";

type Person = { name: string; role?: string };

function domainOf(url: string): string {
  if (!url) return "";
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function parsePeople(content: string): { website?: string; people: Person[] } {
  try {
    const cleaned = content.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    const website =
      typeof parsed?.website === "string" && parsed.website.trim()
        ? parsed.website.trim()
        : undefined;
    const people: Person[] = Array.isArray(parsed?.recipients)
      ? parsed.recipients
          .filter(
            (r: unknown) =>
              r && typeof (r as { name?: unknown }).name === "string",
          )
          .slice(0, 2)
          .map((r: { name: string; role?: string }) => ({
            name: r.name.trim(),
            role: typeof r.role === "string" ? r.role.trim() : undefined,
          }))
      : [];
    return { website, people };
  } catch {
    return { people: [] };
  }
}

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

  const company = (body.company ?? "").trim();
  const inputWebsite = (body.website ?? "").trim();

  if (!company && !inputWebsite) {
    return NextResponse.json(
      { error: "Provide a company name or a website." },
      { status: 400 },
    );
  }

  // Grounding scrape when we already have a website (best effort).
  let siteContext = "";
  if (inputWebsite) {
    const scrape = await scrapeForRecipients(inputWebsite);
    siteContext = scrape.text;
  }

  let resolvedWebsite = inputWebsite;
  let people: Person[] = [];

  // 1) Research-style discovery: website (if missing) + founders, via search.
  try {
    const content = await chatWithSearch(
      FOUNDER_MODEL,
      buildEnrichmentMessages(company, inputWebsite, siteContext),
    );
    const out = parsePeople(content);
    if (!resolvedWebsite && out.website) resolvedWebsite = out.website;
    people = out.people;
  } catch {
    // search unavailable — fall through to scrape-based extraction below
  }

  // 1b) If we now have a website but never scraped it, grab context for later
  //     generation reuse and as a fallback source.
  if (!siteContext && resolvedWebsite) {
    const scrape = await scrapeForRecipients(resolvedWebsite);
    siteContext = scrape.text;
  }

  // 2) Fallback: extract from scraped text if search produced no people.
  if (people.length === 0 && siteContext) {
    try {
      const { content } = await chatWithFallback(
        FOUNDER_MODEL,
        buildFounderExtractionMessages(company, siteContext),
        0.2,
      );
      people = parsePeople(content).people;
    } catch {
      /* leave empty */
    }
  }

  // 3) Verified emails from RocketReach, preferring the company's own domain.
  const dom = domainOf(resolvedWebsite);
  let recipients = people.map((p) => ({ ...p, email: "" }));
  if (rocketreachConfigured() && people.length) {
    const emails = await Promise.all(
      people.map((p) => lookupEmail(p.name, company, dom)),
    );
    recipients = people.map((p, i) => ({ ...p, email: emails[i] || "" }));
  }

  const foundEmails = recipients.filter((r) => r.email).length;
  const note =
    people.length === 0
      ? "Could not identify recipients. Add a website or enter them manually."
      : !rocketreachConfigured()
        ? "Found names. Add a ROCKETREACH_API_KEY to auto-fill emails."
        : foundEmails === 0
          ? "Found names, but no verified emails matched. Add emails manually."
          : undefined;

  const result: FoundersResult = {
    recipients,
    website: resolvedWebsite || undefined,
    siteContext,
    weak: people.length === 0,
    note,
  };
  return NextResponse.json(result);
}
