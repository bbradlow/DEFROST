import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/TopBar";
import { FollowUpDashboard } from "@/components/FollowUpDashboard";
import { affinityConfigured } from "@/lib/integrations/affinity";
import { calendlyConfigured, isConnected } from "@/lib/integrations/calendly";
import type { EmailThread, StylePrompt, Writer } from "@/lib/types";

export default async function FollowUpPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: threads }, { data: writers }, { data: prompts }] = await Promise.all([
    supabase.from("email_threads").select("*").order("last_outbound_at", { ascending: true }),
    supabase.from("writers").select("*").order("created_at", { ascending: true }),
    supabase.from("style_prompts").select("*").order("created_at", { ascending: true }),
  ]);

  const calendlyConnected = calendlyConfigured() ? await isConnected(user.id) : false;
  const followupPrompts = ((prompts ?? []) as StylePrompt[]).filter(
    (p) => (p.kind ?? "outreach") === "followup",
  );

  return (
    <>
      <TopBar ownerEmail={user.email ?? ""} active="followup" />
      <main className="mx-auto max-w-6xl px-5 py-8">
        <FollowUpDashboard
          initialThreads={(threads ?? []) as EmailThread[]}
          writers={(writers ?? []) as Writer[]}
          followupPrompts={followupPrompts}
          ownerEmail={user.email ?? ""}
          affinityReady={affinityConfigured()}
          calendlyReady={calendlyConfigured()}
          calendlyConnected={calendlyConnected}
        />
      </main>
    </>
  );
}
