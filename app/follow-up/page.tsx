import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/TopBar";
import { FollowUpDashboard } from "@/components/FollowUpDashboard";
import type { EmailThread, Writer } from "@/lib/types";

export default async function FollowUpPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: threads }, { data: writers }] = await Promise.all([
    supabase
      .from("email_threads")
      .select("*")
      .order("last_outbound_at", { ascending: true }),
    supabase.from("writers").select("*").order("created_at", { ascending: true }),
  ]);

  return (
    <>
      <TopBar ownerEmail={user.email ?? ""} active="followup" />
      <main className="mx-auto max-w-6xl px-5 py-8">
        <FollowUpDashboard
          initialThreads={(threads ?? []) as EmailThread[]}
          writers={(writers ?? []) as Writer[]}
        />
      </main>
    </>
  );
}
