import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/TopBar";
import { PromptsAdmin } from "@/components/PromptsAdmin";
import type { StylePrompt } from "@/lib/types";

export default async function PromptsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("style_prompts")
    .select("*")
    .order("created_at", { ascending: true });

  return (
    <>
      <TopBar ownerEmail={user.email ?? ""} active="prompts" />
      <main className="mx-auto max-w-6xl px-5 py-8">
        <PromptsAdmin initialPrompts={(data ?? []) as StylePrompt[]} />
      </main>
    </>
  );
}
