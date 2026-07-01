import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fillBlanks, recipientFirstNames } from "@/lib/prompts";

// Follow-up drafting is a fixed template now — no LLM. It just fills in the
// recipient (the person the original email was to) and the writer's name.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { threadId?: string; writerId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.threadId) {
    return NextResponse.json({ error: "Missing threadId." }, { status: 400 });
  }
  if (!body.writerId) {
    return NextResponse.json({ error: "Pick a writer to draft as." }, { status: 400 });
  }

  const [{ data: thread, error: tErr }, { data: writer, error: wErr }] = await Promise.all([
    supabase.from("email_threads").select("*").eq("id", body.threadId).single(),
    supabase.from("writers").select("*").eq("id", body.writerId).single(),
  ]);
  if (tErr || !thread) {
    return NextResponse.json({ error: "Reminder not found." }, { status: 404 });
  }
  if (wErr || !writer) {
    return NextResponse.json({ error: "Writer not found." }, { status: 400 });
  }

  const draft = fillBlanks(recipientFirstNames(thread.contact_name), writer.name);
  return NextResponse.json({ body: draft, modelUsed: "template" });
}
