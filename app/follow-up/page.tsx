import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/TopBar";
import { FollowUpDashboard } from "@/components/FollowUpDashboard";
import { affinityConfigured } from "@/lib/integrations/affinity";
import type { EmailThread, Writer } from "@/lib/types";

// Always render fresh from the DB (never a cached/stale render), so reminders
// persist correctly across client-side navigation.
export const dynamic = "force-dynamic";

export default async function FollowUpPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: threads }, { data: writers }] = await Promise.all([
    supabase.from("email_threads").select("*").order("last_outbound_at", { ascending: true }),
    supabase.from("writers").select("*").order("created_at", { ascending: true }),
  ]);

  return (
    <>
      <TopBar ownerEmail={user.email ?? ""} active="followup" />
      <main className="mx-auto max-w-6xl px-5 py-8">
        <FollowUpDashboard
          initialThreads={(threads ?? []) as EmailThread[]}
          writers={(writers ?? []) as Writer[]}
          ownerEmail={user.email ?? ""}
          affinityReady={affinityConfigured()}
        />
      </main>
    </>
  );
}
