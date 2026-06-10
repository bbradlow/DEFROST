import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { scrapeWebsite } from "@/lib/scrape";
import { chatWithFallback } from "@/lib/openrouter";
import { buildFounderExtractionMessages } from "@/lib/prompts";
import type { FoundersResult } from "@/lib/types";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { website?: string; company?: string; model?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const website = (body.website ?? "").trim();
  const company = (body.company ?? "").trim();
  const model = (body.model ?? "openrouter/free").trim();

  if (!website) {
    return NextResponse.json(
      { error: "A website URL is required to find recipients." },
      { status: 400 },
    );
  }

  // 1) Fetch + extract readable text (best effort).
  const scrape = await scrapeWebsite(website);
  const siteContext = scrape.text;

  if (!scrape.ok || scrape.weak) {
    const result: FoundersResult = {
      recipients: [],
      siteContext,
      weak: true,
      note:
        scrape.note ??
        "Extracted little usable text. Add recipients manually.",
    };
    return NextResponse.json(result);
  }

  // 2) Ask the model for the top 2 likely recipients as strict JSON.
  try {
    const messages = buildFounderExtractionMessages(company, siteContext);
    const { content } = await chatWithFallback(model, messages);

    let recipients: { name: string; role?: string }[] = [];
    try {
      // be lenient: strip fences if the model added them
      const cleaned = content.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed?.recipients)) {
        recipients = parsed.recipients
          .filter((r: unknown) => r && typeof (r as { name?: unknown }).name === "string")
          .slice(0, 2)
          .map((r: { name: string; role?: string }) => ({
            name: r.name.trim(),
            role: typeof r.role === "string" ? r.role.trim() : undefined,
          }));
      }
    } catch {
      recipients = [];
    }

    const result: FoundersResult = {
      recipients,
      siteContext,
      weak: recipients.length === 0,
      note:
        recipients.length === 0
          ? "Could not confidently identify recipients. Add them manually."
          : undefined,
    };
    return NextResponse.json(result);
  } catch (err) {
    const status = (err as Error & { status?: number }).status ?? 502;
    const message = err instanceof Error ? err.message : "Extraction failed";
    // Still return the site context so generation can reuse it.
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
