import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { chatWithFallback } from "@/lib/openrouter";
import { buildFollowupMessages } from "@/lib/prompts";

function daysSince(iso: string): number {
  const ms = Date.now() - Date.parse(iso);
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 86_400_000)) : 0;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { threadId?: string; writerId?: string; model?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.threadId) {
    return NextResponse.json({ error: "Missing threadId." }, { status: 400 });
  }
  if (!body.writerId) {
    return NextResponse.json(
      { error: "Pick a writer to draft as." },
      { status: 400 },
    );
  }

  // Both reads go through RLS, so they're guaranteed to belong to this owner.
  const [{ data: thread, error: tErr }, { data: writer, error: wErr }] =
    await Promise.all([
      supabase.from("email_threads").select("*").eq("id", body.threadId).single(),
      supabase.from("writers").select("*").eq("id", body.writerId).single(),
    ]);

  if (tErr || !thread) {
    return NextResponse.json({ error: "Thread not found." }, { status: 404 });
  }
  if (wErr || !writer) {
    return NextResponse.json({ error: "Writer not found." }, { status: 400 });
  }

  const model = (body.model ?? "openrouter/free").trim();
  const messages = buildFollowupMessages({
    writer,
    contactName: thread.contact_name,
    company: thread.company,
    subject: thread.subject,
    daysSince: daysSince(thread.last_outbound_at),
    snippet: thread.snippet,
  });

  try {
    const { content, modelUsed } = await chatWithFallback(model, messages);
    if (!content) {
      return NextResponse.json(
        { error: "Model returned an empty draft. Try again." },
        { status: 502 },
      );
    }
    return NextResponse.json({ body: content, modelUsed });
  } catch (err) {
    const status = (err as Error & { status?: number }).status;
    const message = err instanceof Error ? err.message : "Drafting failed";
    return NextResponse.json({ error: message }, { status: status === 429 ? 429 : 502 });
  }
}
