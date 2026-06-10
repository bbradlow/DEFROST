import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/TopBar";
import { GeneratorGrid } from "@/components/GeneratorGrid";
import type { Writer } from "@/lib/types";

export default async function Home() {
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
      <TopBar ownerEmail={user.email ?? ""} active="generator" />
      <main className="mx-auto max-w-6xl px-5 py-8">
        <div className="mb-6">
          <p className="eyebrow mb-1">Batch outreach</p>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            Generate emails
          </h1>
          <p className="mt-1 max-w-prose text-sm text-ink-faint">
            One row per email. Pick a writer, add the company and site, let it
            pull likely recipients, then generate. Copy individual emails or the
            whole batch for your analyst.
          </p>
        </div>
        <GeneratorGrid writers={(data ?? []) as Writer[]} />
      </main>
    </>
  );
}
