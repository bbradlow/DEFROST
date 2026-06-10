"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Writer } from "@/lib/types";

type Draft = {
  name: string;
  email: string;
  title: string;
  signature: string;
};

const emptyDraft: Draft = { name: "", email: "", title: "", signature: "" };

export function WritersAdmin({
  initialWriters,
}: {
  initialWriters: Writer[];
}) {
  const supabase = createClient();
  const [writers, setWriters] = useState<Writer[]>(initialWriters);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function reset() {
    setDraft(emptyDraft);
    setEditingId(null);
    setErr(null);
  }

  async function save() {
    if (!draft.name.trim() || !draft.email.trim()) {
      setErr("Name and email are required.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const ownerId = auth.user?.id;
      if (!ownerId) throw new Error("Session expired — sign in again.");

      const payload = {
        name: draft.name.trim(),
        email: draft.email.trim(),
        title: draft.title.trim() || null,
        signature: draft.signature.trim() || null,
      };

      if (editingId) {
        const { data, error } = await supabase
          .from("writers")
          .update(payload)
          .eq("id", editingId)
          .select()
          .single();
        if (error) throw error;
        setWriters((w) => w.map((x) => (x.id === editingId ? (data as Writer) : x)));
      } else {
        const { data, error } = await supabase
          .from("writers")
          .insert({ ...payload, owner_id: ownerId })
          .select()
          .single();
        if (error) throw error;
        setWriters((w) => [...w, data as Writer]);
      }
      reset();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save writer.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this writer?")) return;
    const prev = writers;
    setWriters((w) => w.filter((x) => x.id !== id)); // optimistic
    const { error } = await supabase.from("writers").delete().eq("id", id);
    if (error) {
      setWriters(prev);
      setErr(error.message);
    }
  }

  function edit(w: Writer) {
    setEditingId(w.id);
    setDraft({
      name: w.name,
      email: w.email,
      title: w.title ?? "",
      signature: w.signature ?? "",
    });
    setErr(null);
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
      {/* List */}
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Writers</h2>
          <span className="eyebrow">{writers.length} on file</span>
        </div>
        <p className="mb-4 max-w-prose text-sm text-ink-faint">
          A writer is the person who actually sends the email. Each generated
          email is written in the selected writer&apos;s voice and signed off by
          them. This list feeds the per-email writer dropdown.
        </p>

        {writers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line bg-panel p-8 text-center text-sm text-ink-faint">
            No writers yet. Add your first sender on the right.
          </div>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel">
            {writers.map((w) => (
              <li key={w.id} className="flex items-start justify-between gap-4 p-4">
                <div className="min-w-0">
                  <p className="font-medium text-ink">
                    {w.name}
                    {w.title ? (
                      <span className="ml-2 text-sm font-normal text-ink-faint">
                        {w.title}
                      </span>
                    ) : null}
                  </p>
                  <p className="truncate font-mono text-xs text-ink-faint">
                    {w.email}
                  </p>
                  {w.signature ? (
                    <pre className="mt-2 whitespace-pre-wrap font-sans text-xs text-ink-soft">
                      {w.signature}
                    </pre>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button className="btn btn-ghost py-1 text-xs" onClick={() => edit(w)}>
                    Edit
                  </button>
                  <button
                    className="btn btn-danger py-1 text-xs"
                    onClick={() => remove(w.id)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Form */}
      <section className="lg:sticky lg:top-20 lg:self-start">
        <div className="rounded-lg border border-line bg-panel p-5 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold">
            {editingId ? "Edit writer" : "Add writer"}
          </h3>

          <label className="field-label mb-1 block">Name</label>
          <input
            className="inp mb-3"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Jordan Lee"
          />

          <label className="field-label mb-1 block">Email</label>
          <input
            className="inp mb-3"
            value={draft.email}
            onChange={(e) => setDraft({ ...draft, email: e.target.value })}
            placeholder="jordan@firm.com"
          />

          <label className="field-label mb-1 block">Title (optional)</label>
          <input
            className="inp mb-3"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="Analyst"
          />

          <label className="field-label mb-1 block">Signature (optional)</label>
          <textarea
            className="inp mb-4 h-24 resize-y"
            value={draft.signature}
            onChange={(e) => setDraft({ ...draft, signature: e.target.value })}
            placeholder={"Jordan Lee\nAnalyst, Firm Capital\n(555) 010-2030"}
          />

          {err && <p className="mb-3 text-sm text-flag">{err}</p>}

          <div className="flex gap-2">
            <button className="btn btn-primary flex-1" disabled={busy} onClick={save}>
              {busy ? "Saving…" : editingId ? "Save changes" : "Add writer"}
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
