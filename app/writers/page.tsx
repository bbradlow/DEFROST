import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/TopBar";
import { WritersAdmin } from "@/components/WritersAdmin";
import type { Writer } from "@/lib/types";

export default async function WritersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("writers")
    .select("*")
    .order("created_at", { ascending: true });

  return (
    <>
      <TopBar ownerEmail={user.email ?? ""} active="writers" />
      <main className="mx-auto max-w-6xl px-5 py-8">
        <WritersAdmin initialWriters={(data ?? []) as Writer[]} />
      </main>
    </>
  );
}
