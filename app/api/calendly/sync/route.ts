import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getValidToken,
  usersMe,
  listScheduledEvents,
  listInvitees,
} from "@/lib/integrations/calendly";

export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const token = await getValidToken(user.id);
  if (!token) {
    return NextResponse.json({ error: "Calendly not connected." }, { status: 400 });
  }

  const steps: string[] = [];
  const trace = (s: string) => {
    steps.push(s);
    console.log(`[calendly] ${user.email}: ${s}`);
  };

  try {
    const me = await usersMe(token);
    const minStart = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const events = await listScheduledEvents(token, me.resource.uri, minStart);
    trace(`events: ${events.length} since ${minStart.slice(0, 10)}`);

    const { data: threads } = await supabase
      .from("email_threads")
      .select("id, contact_email, status");
    const byEmail = new Map(
      (threads ?? [])
        .filter((t) => t.contact_email)
        .map((t) => [t.contact_email!.toLowerCase(), t]),
    );

    let matched = 0;
    for (const ev of events) {
      const invitees = await listInvitees(token, ev.uri);
      for (const inv of invitees) {
        const t = byEmail.get((inv.email ?? "").toLowerCase());
        if (t && t.status !== "meeting_set") {
          const { error } = await supabase
            .from("email_threads")
            .update({ status: "meeting_set", meeting_at: ev.start_time })
            .eq("id", t.id);
          if (!error) matched += 1;
        }
      }
    }
    trace(`matched ${matched} thread(s) to a scheduled meeting`);
    return NextResponse.json({ matched, events: events.length, debug: steps.join("\n") });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Calendly sync failed";
    trace(`ERROR ${msg}`);
    return NextResponse.json({ error: msg, debug: steps.join("\n") }, { status: 502 });
  }
}
