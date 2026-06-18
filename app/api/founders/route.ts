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

export const maxDuration = 60;

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

  // Stage-by-stage trace, returned to the client and logged server-side.
  const steps: string[] = [];
  const trace = (s: string) => {
    steps.push(s);
    console.log(`[founders] ${company || inputWebsite}: ${s}`);
  };
  trace(`input company="${company}" website="${inputWebsite}"`);

  // Grounding scrape when we already have a website.
  let siteContext = "";
  if (inputWebsite) {
    const scrape = await scrapeForRecipients(inputWebsite);
    siteContext = scrape.text;
    trace(
      `scrape(${inputWebsite}): ok=${scrape.ok} chars=${scrape.text.length}${
        scrape.note ? ` note="${scrape.note}"` : ""
      }`,
    );
  } else {
    trace("scrape: skipped (no website yet)");
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
    const snippet = content.slice(0, 160).replace(/\s+/g, " ");
    trace(
      `search(${FOUNDER_MODEL}): ok website=${out.website ?? "-"} people=${
        out.people.length
      } raw="${snippet}${content.length > 160 ? "…" : ""}"`,
    );
  } catch (e) {
    const status = (e as Error & { status?: number }).status;
    const msg = e instanceof Error ? e.message : String(e);
    trace(`search(${FOUNDER_MODEL}): ERROR${status ? ` ${status}` : ""} ${msg}`);
  }

  // 1b) Scrape a discovered website if we didn't already.
  if (!siteContext && resolvedWebsite) {
    const scrape = await scrapeForRecipients(resolvedWebsite);
    siteContext = scrape.text;
    trace(`scrape(discovered ${resolvedWebsite}): chars=${scrape.text.length}`);
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
      trace(`scrape-fallback: people=${people.length}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      trace(`scrape-fallback: ERROR ${msg}`);
    }
  } else if (people.length === 0) {
    trace("scrape-fallback: skipped (no site text)");
  }

  // 3) Verified emails from RocketReach, preferring the company's own domain.
  const dom = domainOf(resolvedWebsite);
  let recipients = people.map((p) => ({ ...p, email: "" }));
  if (!rocketreachConfigured()) {
    trace("rocketreach: NOT configured (set ROCKETREACH_API_KEY)");
  } else if (people.length) {
    const emails = await Promise.all(
      people.map((p) => lookupEmail(p.name, company, dom)),
    );
    recipients = people.map((p, i) => ({ ...p, email: emails[i] || "" }));
    trace(
      `rocketreach(domain=${dom || "-"}): ${recipients
        .map((r) => `${r.name}=${r.email ? "found" : "none"}`)
        .join(", ")}`,
    );
  } else {
    trace("rocketreach: skipped (no people)");
  }

  const foundEmails = recipients.filter((r) => r.email).length;
  const note =
    people.length === 0
      ? "Could not identify recipients — see diagnostics."
      : !rocketreachConfigured()
        ? "Found names. Add a ROCKETREACH_API_KEY to auto-fill emails."
        : foundEmails === 0
          ? "Found names, but no verified emails matched."
          : undefined;

  const result: FoundersResult = {
    recipients,
    website: resolvedWebsite || undefined,
    siteContext,
    weak: people.length === 0,
    note,
    debug: steps.join("\n"),
  };
  return NextResponse.json(result);
}
