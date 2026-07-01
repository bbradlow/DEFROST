"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_BASE_PROMPT } from "@/lib/prompts";
import type { StylePrompt } from "@/lib/types";

type Kind = "outreach" | "followup";
type Draft = { name: string; body: string };
const emptyDraft: Draft = { name: "", body: "" };

const COPY: Record<Kind, { title: string; blurb: string; placeholder: string; default?: string }> = {
  outreach: {
    title: "Outreach email prompts",
    blurb:
      "The reusable house voice for cold outreach. Save variations here, then pick one from the dropdown on the Generator tab. Per-row info still layers on top.",
    placeholder: "You write cold outreach emails for…",
    default: DEFAULT_BASE_PROMPT,
  },
  followup: {
    title: "Follow-up email prompts",
    blurb:
      "Extra style/instructions used when drafting follow-ups on the Follow-Up tab. Keep these short — they layer on top of the built-in “short, polite nudge” rules.",
    placeholder: "Keep follow-ups to 2–3 sentences, reference the original ask, no guilt-tripping…",
  },
};

function PromptSection({
  kind,
  prompts,
  onChange,
}: {
  kind: Kind;
  prompts: StylePrompt[];
  onChange: (next: StylePrompt[]) => void;
}) {
  const supabase = createClient();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const copy = COPY[kind];
  const mine = prompts.filter((p) => (p.kind ?? "outreach") === kind);

  function reset() {
    setDraft(emptyDraft);
    setEditingId(null);
    setErr(null);
  }

  async function save() {
    if (!draft.name.trim() || !draft.body.trim()) {
      setErr("Name and prompt body are required.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const ownerId = auth.user?.id;
      if (!ownerId) throw new Error("Session expired — sign in again.");
      const payload = { name: draft.name.trim(), body: draft.body.trim(), kind };

      if (editingId) {
        const { data, error } = await supabase
          .from("style_prompts")
          .update(payload)
          .eq("id", editingId)
          .select()
          .single();
        if (error) throw error;
        onChange(prompts.map((x) => (x.id === editingId ? (data as StylePrompt) : x)));
      } else {
        const { data, error } = await supabase
          .from("style_prompts")
          .insert({ ...payload, owner_id: ownerId })
          .select()
          .single();
        if (error) throw error;
        onChange([...prompts, data as StylePrompt]);
      }
      reset();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save prompt.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this prompt?")) return;
    const prev = prompts;
    onChange(prompts.filter((x) => x.id !== id));
    const { error } = await supabase.from("style_prompts").delete().eq("id", id);
    if (error) {
      onChange(prev);
      setErr(error.message);
    }
  }

  function edit(p: StylePrompt) {
    setEditingId(p.id);
    setDraft({ name: p.name, body: p.body });
    setErr(null);
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold tracking-tight">{copy.title}</h2>
          <span className="eyebrow">{mine.length} on file</span>
        </div>
        <p className="mb-4 max-w-prose text-sm text-ink-faint">{copy.blurb}</p>

        {mine.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line bg-panel p-8 text-center text-sm text-ink-faint">
            No saved prompts yet. Create your first on the right.
          </div>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel">
            {mine.map((p) => (
              <li key={p.id} className="flex items-start justify-between gap-4 p-4">
                <div className="min-w-0">
                  <p className="font-medium text-ink">{p.name}</p>
                  <pre className="mt-1 line-clamp-3 whitespace-pre-wrap font-sans text-xs text-ink-soft">
                    {p.body}
                  </pre>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button className="btn btn-ghost py-1 text-xs" onClick={() => edit(p)}>
                    Edit
                  </button>
                  <button className="btn btn-danger py-1 text-xs" onClick={() => remove(p.id)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="lg:sticky lg:top-20 lg:self-start">
        <div className="rounded-lg border border-line bg-panel p-5 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold">
            {editingId ? "Edit prompt" : "Add prompt"}
          </h3>
          <label className="field-label mb-1 block">Name</label>
          <input
            className="inp mb-3"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder={kind === "followup" ? "Gentle nudge" : "Warm intro — concise"}
          />
          <div className="mb-1 flex items-center justify-between">
            <label className="field-label block">Prompt body</label>
            {copy.default && (
              <button
                type="button"
                className="text-xs text-ink-faint hover:text-ink"
                onClick={() => setDraft((d) => ({ ...d, body: copy.default! }))}
              >
                Start from default
              </button>
            )}
          </div>
          <textarea
            className="inp mb-4 h-64 resize-y font-mono text-xs"
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            placeholder={copy.placeholder}
          />
          {err && <p className="mb-3 text-sm text-flag">{err}</p>}
          <div className="flex gap-2">
            <button className="btn btn-primary flex-1" disabled={busy} onClick={save}>
              {busy ? "Saving…" : editingId ? "Save changes" : "Add prompt"}
            </button>
            {editingId && (
              <button className="btn btn-ghost" onClick={reset}>
                Cancel
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

export function PromptsAdmin({ initialPrompts }: { initialPrompts: StylePrompt[] }) {
  const [prompts, setPrompts] = useState<StylePrompt[]>(initialPrompts);
  return (
    <div className="space-y-12">
      <PromptSection kind="outreach" prompts={prompts} onChange={setPrompts} />
      <div className="border-t border-line" />
      <PromptSection kind="followup" prompts={prompts} onChange={setPrompts} />
    </div>
  );
}
