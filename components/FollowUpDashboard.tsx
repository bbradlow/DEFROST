"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { linkifyToHtml, linkifyToPlain } from "@/lib/linkify";
import type { EmailThread, ThreadStatus, Writer } from "@/lib/types";

type Segment = "all" | ThreadStatus;

const STATUS_META: Record<ThreadStatus, { label: string; dot: string; text: string }> = {
  no_answer: { label: "No answer", dot: "bg-ink-faint", text: "text-ink-soft" },
  answered: { label: "Answered", dot: "bg-accent", text: "text-accent" },
  meeting_set: { label: "Meeting set", dot: "bg-success", text: "text-success-ink" },
};

function daysSince(iso: string): number {
  const ms = Date.now() - Date.parse(iso);
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 86_400_000)) : 0;
}

function todayInput(): string {
  return new Date().toISOString().slice(0, 10);
}

async function richCopy(plain: string, html: string): Promise<boolean> {
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard && "write" in navigator.clipboard) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ]);
      return true;
    }
    await navigator.clipboard.writeText(plain);
    return true;
  } catch {
    try {
      await navigator.clipboard.writeText(plain);
      return true;
    } catch {
      return false;
    }
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn btn-ghost py-1 text-xs"
      onClick={async () => {
        const ok = await richCopy(linkifyToPlain(text), linkifyToHtml(text));
        if (ok) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }
      }}
    >
      {copied ? "Copied ✓" : "Copy follow-up"}
    </button>
  );
}

const emptyAdd = {
  contact_name: "",
  contact_email: "",
  company: "",
  subject: "",
  last_outbound_at: todayInput(),
  status: "no_answer" as ThreadStatus,
  snippet: "",
};

export function FollowUpDashboard({
  initialThreads,
  writers,
}: {
  initialThreads: EmailThread[];
  writers: Writer[];
}) {
  const supabase = createClient();
  const [threads, setThreads] = useState<EmailThread[]>(initialThreads);
  const [segment, setSegment] = useState<Segment>("no_answer");
  const [staleDays, setStaleDays] = useState(5);
  const [writerId, setWriterId] = useState<string>(writers[0]?.id ?? "");
  const [model, setModel] = useState("openrouter/free");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [draftingId, setDraftingId] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [add, setAdd] = useState({ ...emptyAdd });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    try {
      const dm = localStorage.getItem("co:defaultModel");
      if (dm) setModel(dm);
    } catch {}
  }, []);

  const counts = useMemo(() => {
    const c = { all: threads.length, no_answer: 0, answered: 0, meeting_set: 0 };
    for (const t of threads) c[t.status] += 1;
    return c;
  }, [threads]);

  const visible = useMemo(() => {
    let list = threads;
    if (segment !== "all") list = list.filter((t) => t.status === segment);
    if (segment === "no_answer" || segment === "all") {
      list = list.filter((t) =>
        t.status === "no_answer" ? daysSince(t.last_outbound_at) >= staleDays : true,
      );
    }
    return [...list].sort(
      (a, b) => daysSince(b.last_outbound_at) - daysSince(a.last_outbound_at),
    );
  }, [threads, segment, staleDays]);

  async function setStatus(id: string, status: ThreadStatus) {
    const prev = threads;
    setThreads((ts) => ts.map((t) => (t.id === id ? { ...t, status } : t)));
    const patch: Partial<EmailThread> = { status };
    if (status === "meeting_set") patch.meeting_at = new Date().toISOString();
    if (status === "answered") patch.last_inbound_at = new Date().toISOString();
    const { error } = await supabase.from("email_threads").update(patch).eq("id", id);
    if (error) {
      setThreads(prev);
      setBanner(error.message);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this thread?")) return;
    const prev = threads;
    setThreads((ts) => ts.filter((t) => t.id !== id));
    const { error } = await supabase.from("email_threads").delete().eq("id", id);
    if (error) {
      setThreads(prev);
      setBanner(error.message);
    }
  }

  async function draft(id: string) {
    if (!writerId) {
      setBanner("Pick a writer to draft as (top right).");
      return;
    }
    setDraftingId(id);
    setBanner(null);
    try {
      const res = await fetch("/api/followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: id, writerId, model }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Drafting failed");
      setDrafts((d) => ({ ...d, [id]: data.body }));
    } catch (e) {
      setBanner(e instanceof Error ? e.message : "Drafting failed");
    } finally {
      setDraftingId(null);
    }
  }

  async function addThread() {
    if (!add.contact_name.trim() || !add.contact_email.trim()) {
      setBanner("Contact name and email are required.");
      return;
    }
    setSaving(true);
    setBanner(null);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const ownerId = auth.user?.id;
      if (!ownerId) throw new Error("Session expired — sign in again.");
      const payload = {
        owner_id: ownerId,
        contact_name: add.contact_name.trim(),
        contact_email: add.contact_email.trim(),
        company: add.company.trim() || null,
        subject: add.subject.trim() || null,
        last_outbound_at: new Date(add.last_outbound_at || todayInput()).toISOString(),
        status: add.status,
        snippet: add.snippet.trim() || null,
        source: "manual",
      };
      const { data, error } = await supabase
        .from("email_threads")
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      setThreads((ts) => [...ts, data as EmailThread]);
      setAdd({ ...emptyAdd });
      setShowAdd(false);
    } catch (e) {
      setBanner(e instanceof Error ? e.message : "Could not add thread.");
    } finally {
      setSaving(false);
    }
  }

  const segTab = (key: Segment, label: string, count: number) => (
    <button
      key={key}
      onClick={() => setSegment(key)}
      className={`rounded px-3 py-1.5 text-sm transition-colors ${
        segment === key
          ? "bg-accent text-white"
          : "bg-panel text-ink-soft hover:bg-accent-soft"
      }`}
    >
      {label} <span className="opacity-70">({count})</span>
    </button>
  );

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow mb-1">Pipeline</p>
          <h1 className="text-2xl font-semibold tracking-tight">Follow-Up</h1>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="field-label mb-1 block">Draft as</label>
            <select
              className="inp"
              value={writerId}
              onChange={(e) => setWriterId(e.target.value)}
            >
              {writers.length === 0 && <option value="">No writers yet</option>}
              {writers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-ghost" onClick={() => setShowAdd((s) => !s)}>
            {showAdd ? "Close" : "+ Add thread"}
          </button>
        </div>
      </div>

      {/* Integrations status */}
      <div className="mb-5 flex flex-wrap gap-2 text-xs">
        {["Outlook", "Affinity", "Calendly"].map((name) => (
          <span
            key={name}
            className="inline-flex items-center gap-1.5 rounded border border-line bg-panel px-2.5 py-1 text-ink-faint"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-ink-faint/50" aria-hidden />
            {name}: not connected
          </span>
        ))}
        <span className="self-center text-ink-faint">
          Connectors populate this list automatically once wired up. For now, add threads manually.
        </span>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="mb-5 grid gap-3 rounded-lg border border-line bg-panel p-4 sm:grid-cols-2">
          <input className="inp" placeholder="Contact name" value={add.contact_name}
            onChange={(e) => setAdd({ ...add, contact_name: e.target.value })} />
          <input className="inp" placeholder="Contact email" value={add.contact_email}
            onChange={(e) => setAdd({ ...add, contact_email: e.target.value })} />
          <input className="inp" placeholder="Company" value={add.company}
            onChange={(e) => setAdd({ ...add, company: e.target.value })} />
          <input className="inp" placeholder="Original subject" value={add.subject}
            onChange={(e) => setAdd({ ...add, subject: e.target.value })} />
          <div>
            <label className="field-label mb-1 block">Last emailed</label>
            <input type="date" className="inp" value={add.last_outbound_at}
              onChange={(e) => setAdd({ ...add, last_outbound_at: e.target.value })} />
          </div>
          <div>
            <label className="field-label mb-1 block">Status</label>
            <select className="inp" value={add.status}
              onChange={(e) => setAdd({ ...add, status: e.target.value as ThreadStatus })}>
              <option value="no_answer">No answer</option>
              <option value="answered">Answered</option>
              <option value="meeting_set">Meeting set</option>
            </select>
          </div>
          <textarea className="inp sm:col-span-2 h-20 resize-y"
            placeholder="What the original email was about (used to draft the follow-up)"
            value={add.snippet}
            onChange={(e) => setAdd({ ...add, snippet: e.target.value })} />
          <div className="sm:col-span-2">
            <button className="btn btn-primary" disabled={saving} onClick={addThread}>
              {saving ? "Saving…" : "Add thread"}
            </button>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {segTab("all", "All", counts.all)}
        {segTab("no_answer", "No answer", counts.no_answer)}
        {segTab("answered", "Answered", counts.answered)}
        {segTab("meeting_set", "Meeting set", counts.meeting_set)}
        {(segment === "no_answer" || segment === "all") && (
          <span className="ml-auto inline-flex items-center gap-2 text-sm text-ink-soft">
            No response in ≥
            <input
              type="number"
              min={0}
              className="inp w-16 py-1 text-center"
              value={staleDays}
              onChange={(e) => setStaleDays(Math.max(0, Number(e.target.value) || 0))}
            />
            days
          </span>
        )}
      </div>

      {banner && <p className="mb-3 text-sm text-flag">{banner}</p>}

      {/* Threads */}
      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-panel p-10 text-center text-sm text-ink-faint">
          No threads here yet. Add one above (or connect Outlook/Affinity later).
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((t) => {
            const meta = STATUS_META[t.status];
            const d = daysSince(t.last_outbound_at);
            return (
              <div key={t.id} className="rounded-lg border border-line bg-panel p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">
                      {t.contact_name}{" "}
                      <span className="font-normal text-ink-faint">· {t.contact_email}</span>
                    </p>
                    <p className="text-sm text-ink-soft">
                      {t.company ? `${t.company} — ` : ""}
                      {t.subject || <span className="text-ink-faint">(no subject)</span>}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-faint">
                      Last emailed {d} day{d === 1 ? "" : "s"} ago
                      {t.last_inbound_at ? " · replied" : ""}
                      {t.meeting_at ? " · meeting on file" : ""}
                    </p>
                  </div>
                  <span className={`inline-flex shrink-0 items-center gap-1.5 font-mono text-[11px] ${meta.text}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden />
                    {meta.label}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  <button
                    className="btn btn-primary py-1 text-xs"
                    disabled={draftingId === t.id}
                    onClick={() => draft(t.id)}
                  >
                    {draftingId === t.id ? "Drafting…" : "Draft follow-up"}
                  </button>
                  {t.status !== "answered" && (
                    <button className="btn btn-ghost py-1 text-xs" onClick={() => setStatus(t.id, "answered")}>
                      Mark answered
                    </button>
                  )}
                  {t.status !== "meeting_set" && (
                    <button className="btn btn-ghost py-1 text-xs" onClick={() => setStatus(t.id, "meeting_set")}>
                      Mark meeting set
                    </button>
                  )}
                  {t.status !== "no_answer" && (
                    <button className="btn btn-ghost py-1 text-xs" onClick={() => setStatus(t.id, "no_answer")}>
                      Mark no answer
                    </button>
                  )}
                  <button className="btn btn-danger py-1 text-xs" onClick={() => remove(t.id)}>
                    Delete
                  </button>
                </div>

                {drafts[t.id] && (
                  <div className="mt-3 rounded-md border border-line bg-paper p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="eyebrow">Draft</span>
                      <CopyButton text={drafts[t.id]} />
                    </div>
                    <textarea
                      className="inp h-40 resize-y whitespace-pre-wrap text-sm"
                      value={drafts[t.id]}
                      onChange={(e) => setDrafts((dr) => ({ ...dr, [t.id]: e.target.value }))}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
