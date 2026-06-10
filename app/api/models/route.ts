import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listFreeModels } from "@/lib/openrouter";

export async function GET() {
  // Gate behind auth — only signed-in owners can hit OpenRouter through us.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const models = await listFreeModels();
    return NextResponse.json({ models });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load models";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
