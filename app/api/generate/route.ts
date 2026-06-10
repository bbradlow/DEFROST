import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { scrapeWebsite } from "@/lib/scrape";
import { chatWithFallback } from "@/lib/openrouter";
import {
  buildSystemPrompt,
  buildUserPrompt,
  DEFAULT_BASE_PROMPT,
} from "@/lib/prompts";
import type { Recipient } from "@/lib/types";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: {
    writerId?: string;
    company?: string;
    website?: string;
    recipients?: Recipient[];
    additionalInfo?: string;
    model?: string;
    basePrompt?: string;
    siteContext?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const model = (body.model ?? "openrouter/free").trim();
  const basePrompt = (body.basePrompt ?? DEFAULT_BASE_PROMPT).trim();

  if (!body.writerId) {
    return NextResponse.json(
      { error: "Pick a writer for this email first." },
      { status: 400 },
    );
  }

  // Look up the writer THROUGH RLS — guarantees the writer belongs to this
  // owner. No service role needed; the session client is scoped by RLS.
  const { data: writer, error: writerErr } = await supabase
    .from("writers")
    .select("*")
    .eq("id", body.writerId)
    .single();

  if (writerErr || !writer) {
    return NextResponse.json(
      { error: "Writer not found (or not yours)." },
      { status: 400 },
    );
  }

  // Reuse provided site context; otherwise fetch the site now for personalization.
  let siteContext = (body.siteContext ?? "").trim();
  if (!siteContext && body.website?.trim()) {
    const scrape = await scrapeWebsite(body.website);
    if (scrape.ok) siteContext = scrape.text;
  }

  const system = buildSystemPrompt(basePrompt, writer);
  const userPrompt = buildUserPrompt({
    company: body.company ?? "",
    website: body.website ?? "",
    recipients: body.recipients ?? [],
    additionalInfo: body.additionalInfo ?? "",
    siteContext,
  });

  try {
    const { content, modelUsed } = await chatWithFallback(model, [
      { role: "system", content: system },
      { role: "user", content: userPrompt },
    ]);

    if (!content) {
      return NextResponse.json(
        { error: "Model returned an empty response. Try regenerating." },
        { status: 502 },
      );
    }

    return NextResponse.json({ body: content, modelUsed });
  } catch (err) {
    const status = (err as Error & { status?: number }).status;
    const message = err instanceof Error ? err.message : "Generation failed";
    // 429 -> tell the client to back off and retry
    return NextResponse.json({ error: message }, { status: status === 429 ? 429 : 502 });
  }
}
