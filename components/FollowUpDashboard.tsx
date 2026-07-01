"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { linkifyToHtml, linkifyToPlain } from "@/lib/linkify";
import type { EmailThread, StylePrompt, ThreadStatus, Writer } from "@/lib/types";

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

/** Stark scale: 0d green, 7d solid orange, 14–21d distinctly red, 30d near-black. */
function daysColor(days: number): string {
  const stops: [number, number, number, number][] = [
    [0, 145, 65, 38], // green
    [7, 28, 92, 48], // solid orange
    [14, 2, 82, 46], // red
    [21, 0, 78, 38], // deep red
    [30, 0, 35, 12], // near black
  ];
  const d = Math.max(0, Math.min(days, 30));
  let a = stops[0];
  let b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (d >= stops[i][0] && d <= stops[i + 1][0]) {
      a = stops[i];
      b = stops[i + 1];
      break;
    }
  }
  const span = b[0] - a[0] || 1;
  const t = (d - a[0]) / span;
  const h = Math.round(a[1] + (b[1] - a[1]) * t);
  const s = Math.round(a[2] + (b[2] - a[2]) * t);
  const l = Math.round(a[3] + (b[3] - a[3]) * t);
  return `hsl(${h}, ${s}%, ${l}%)`;
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
  followupPrompts,
  affinityReady,
  calendlyReady,
  calendlyConnected,
}: {
  initialThreads: EmailThread[];
  writers: Writer[];
  followupPrompts: StylePrompt[];
  affinityReady: boolean;
  calendlyReady: boolean;
  calendlyConnected: boolean;
}) {
  const supabase = createClient();
  const [threads, setThreads] = useState<EmailThread[]>(initialThreads);
  const [deletingAll, setDeletingAll] = useState(false);
  const [segment, setSegment] = useState<Segment>("no_answer");
  const [staleDays, setStaleDays] = useState(0);
  const [filterOp, setFilterOp] = useState<">=" | "<=" | "=">(">=");
  const [sortBy, setSortBy] = useState<"oldest" | "recent" | "company_az" | "company_za">("recent");
  const [search, setSearch] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [writerId, setWriterId] = useState<string>(writers[0]?.id ?? "");
  const [promptId, setPromptId] = useState<string>("");
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
      const seg = localStorage.getItem("co:followupSegment") as Segment | null;
      if (seg) setSegment(seg);
      const sd = localStorage.getItem("co:followupStaleDays");
      if (sd !== null && sd !== "") setStaleDays(Math.max(0, Number(sd) || 0));
      const op = localStorage.getItem("co:followupOp") as ">=" | "<=" | "=" | null;
      if (op) setFilterOp(op);
      const sb = localStorage.getItem("co:followupSort") as typeof sortBy | null;
      if (sb) setSortBy(sb);
      const subj = localStorage.getItem("co:followupSubject");
      if (subj) setSubjectFilter(subj);
      const pid = localStorage.getItem("co:followupPromptId");
      if (pid) setPromptId(pid);
    } catch {}
  }, []);

  // persist filter choices so they survive navigating between tabs
  useEffect(() => {
    try {
      localStorage.setItem("co:followupSegment", segment);
      localStorage.setItem("co:followupStaleDays", String(staleDays));
      localStorage.setItem("co:followupOp", filterOp);
      localStorage.setItem("co:followupSort", sortBy);
    } catch {}
  }, [segment, staleDays, filterOp, sortBy]);

  const [syncing, setSyncing] = useState<null | "affinity" | "calendly">(null);
  const [syncDebug, setSyncDebug] = useState<string | null>(null);
  const [affinityDays, setAffinityDays] = useState("30");

  useEffect(() => {
    try {
      const d = localStorage.getItem("co:affinityDays");
      if (d) setAffinityDays(d);
    } catch {}
  }, []);

  // Surface the result of the Calendly OAuth redirect (?calendly=connected|error).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("calendly");
    if (!p) return;
    if (p === "connected") setBanner("Calendly connected.");
    else if (p === "notconfigured") setBanner("Calendly isn't configured on the server yet.");
    else if (p === "error") setBanner("Calendly connection failed — try again.");
    window.history.replaceState({}, "", "/follow-up");
  }, []);

  async function refreshThreads() {
    const { data } = await supabase
      .from("email_threads")
      .select("*")
      .order("last_outbound_at", { ascending: true });
    if (data) setThreads(data as EmailThread[]);
  }

  async function syncAffinity() {
    setSyncing("affinity");
    setBanner(null);
    setSyncDebug(null);
    try {
      const res = await fetch("/api/affinity/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sinceDays: Math.max(1, Math.floor(Number(affinityDays) || 30)) }),
      });
      const data = await res.json();
      if (data.debug) setSyncDebug(data.debug);
      if (!res.ok) throw new Error(data.error ?? "Affinity sync failed");
      await refreshThreads();
      setBanner(`Affinity: added ${data.added ?? 0}, updated ${data.updated ?? 0}.`);
    } catch (e) {
      setBanner(e instanceof Error ? e.message : "Affinity sync failed");
    } finally {
      setSyncing(null);
    }
  }

  async function syncCalendly() {
    setSyncing("calendly");
    setBanner(null);
    setSyncDebug(null);
    try {
      const res = await fetch("/api/calendly/sync", { method: "POST" });
      const data = await res.json();
      if (data.debug) setSyncDebug(data.debug);
      if (!res.ok) throw new Error(data.error ?? "Calendly sync failed");
      await refreshThreads();
      setBanner(`Calendly: ${data.matched ?? 0} meeting(s) matched across ${data.events ?? 0} event(s).`);
    } catch (e) {
      setBanner(e instanceof Error ? e.message : "Calendly sync failed");
    } finally {
      setSyncing(null);
    }
  }

  const counts = useMemo(() => {
    const c = { all: threads.length, no_answer: 0, answered: 0, meeting_set: 0 };
    for (const t of threads) c[t.status] += 1;
    return c;
  }, [threads]);

  const visible = useMemo(() => {
    let list = threads;
    if (segment !== "all") list = list.filter((t) => t.status === segment);

    // company / contact search
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((t) =>
        [t.company, t.contact_name, t.contact_email]
          .filter(Boolean)
          .some((v) => (v as string).toLowerCase().includes(q)),
      );
    }

    // subject filter (autofilled from synced emails)
    if (subjectFilter) {
      list = list.filter((t) => (t.subject ?? "") === subjectFilter);
    }

    // day filter (applies to no-answer rows), with chosen operator
    if (segment === "no_answer" || segment === "all") {
      list = list.filter((t) => {
        if (t.status !== "no_answer") return true;
        const d = daysSince(t.last_outbound_at);
        if (filterOp === ">=") return d >= staleDays;
        if (filterOp === "<=") return d <= staleDays;
        return d === staleDays;
      });
    }

    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sortBy) {
        case "recent":
          return daysSince(a.last_outbound_at) - daysSince(b.last_outbound_at);
        case "oldest":
          return daysSince(b.last_outbound_at) - daysSince(a.last_outbound_at);
        case "company_az":
          return (a.company ?? a.contact_name).localeCompare(b.company ?? b.contact_name);
        case "company_za":
          return (b.company ?? b.contact_name).localeCompare(a.company ?? a.contact_name);
        default:
          return 0;
      }
    });
    return sorted;
  }, [threads, segment, staleDays, filterOp, sortBy, search, subjectFilter]);

  // Distinct subjects present in synced threads, to populate the subject filter.
  const subjectOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of threads) {
      const s = (t.subject ?? "").trim();
      if (s) set.add(s);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [threads]);

  useEffect(() => {
    if (subjectFilter && !subjectOptions.includes(subjectFilter)) {
      setSubjectFilter("");
      try { localStorage.removeItem("co:followupSubject"); } catch {}
    }
  }, [subjectOptions, subjectFilter]);

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

  async function deleteAll() {
    if (threads.length === 0) return;
    if (
      !confirm(
        `Delete all ${threads.length} follow-up reminder${threads.length === 1 ? "" : "s"}? This cannot be undone.`,
      )
    )
      return;
    setDeletingAll(true);
    setBanner(null);
    const prev = threads;
    setThreads([]);
    const { data: auth } = await supabase.auth.getUser();
    const ownerId = auth.user?.id;
    const { error } = await supabase
      .from("email_threads")
      .delete()
      .eq("owner_id", ownerId ?? "");
    if (error) {
      setThreads(prev);
      setBanner(error.message);
    }
    setDeletingAll(false);
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
        body: JSON.stringify({ threadId: id, writerId, model, promptId: promptId || undefined }),
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
          <h1 className="text-2xl font-semibold tracking-tight">Follow-up reminders</h1>
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
          <div>
            <label className="field-label mb-1 block">Template</label>
            <select
              className="inp"
              value={promptId}
              onChange={(e) => {
                setPromptId(e.target.value);
                try { localStorage.setItem("co:followupPromptId", e.target.value); } catch {}
              }}
            >
              <option value="">Default</option>
              {followupPrompts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-ghost" onClick={() => setShowAdd((s) => !s)}>
            {showAdd ? "Close" : "+ Add thread"}
          </button>
          <button
            className="btn btn-danger"
            disabled={threads.length === 0 || deletingAll}
            onClick={deleteAll}
            title="Delete every follow-up reminder"
          >
            {deletingAll ? "Deleting…" : "Delete all"}
          </button>
        </div>
      </div>

      {/* Sources */}
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-line bg-panel px-4 py-3">
        <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">
          Sources
        </span>

        {/* Affinity group */}
        <div className="flex items-center gap-2">
          <button
            className="btn btn-ghost py-1 text-xs"
            disabled={!affinityReady || syncing !== null}
            onClick={syncAffinity}
            title={affinityReady ? "Pull the emails you've sent (and replies) from Affinity" : "Set AFFINITY_API_KEY on the server"}
          >
            {syncing === "affinity" ? "Syncing Affinity…" : "Sync from Affinity"}
          </button>
          {affinityReady && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-paper px-2 py-1 text-[11px] text-ink-faint">
              <span>last</span>
              <input
                type="number"
                min={1}
                className="inp h-6 w-12 px-1 py-0 text-center text-[11px]"
                value={affinityDays}
                onChange={(e) => {
                  setAffinityDays(e.target.value);
                  try { localStorage.setItem("co:affinityDays", e.target.value); } catch {}
                }}
                title="How many days back to scan. Shorter = fuller coverage on a high-volume firm feed."
              />
              <span>days</span>
            </span>
          )}
        </div>

        <span className="h-5 w-px bg-line" aria-hidden />

        {/* Calendly */}
        {!calendlyReady ? (
          <span className="text-xs text-ink-faint">Calendly: not configured</span>
        ) : calendlyConnected ? (
          <button
            className="btn btn-ghost py-1 text-xs"
            disabled={syncing !== null}
            onClick={syncCalendly}
            title="Match scheduled meetings to your threads"
          >
            {syncing === "calendly" ? "Syncing Calendly…" : "Sync meetings (Calendly)"}
          </button>
        ) : (
          <a className="btn btn-ghost py-1 text-xs" href="/api/calendly/connect">
            Connect Calendly
          </a>
        )}

        {!affinityReady && (
          <span className="text-xs text-ink-faint">Affinity: set AFFINITY_API_KEY to enable.</span>
        )}
      </div>

      {syncDebug && (
        <details className="mb-4">
          <summary className="cursor-pointer text-[11px] text-ink-faint hover:text-ink">
            Last sync diagnostics
          </summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-line bg-paper p-2 font-mono text-[10px] leading-relaxed text-ink-soft">
            {syncDebug}
          </pre>
        </details>
      )}

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

      {/* Segment tabs as a segmented control */}
      <div className="mb-3 inline-flex flex-wrap gap-1 rounded-lg border border-line bg-panel p-1">
        {segTab("all", "All", counts.all)}
        {segTab("no_answer", "No answer", counts.no_answer)}
        {segTab("answered", "Answered", counts.answered)}
        {segTab("meeting_set", "Meeting set", counts.meeting_set)}
      </div>

      {/* Search · sort · filter toolbar */}
      <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-3">
        <input
          className="inp h-9 w-64 text-sm"
          placeholder="Search company or contact…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <label className="inline-flex items-center gap-2 text-sm text-ink-soft">
          <span className="text-ink-faint">Sort</span>
          <select
            className="inp h-9 w-40 text-sm"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          >
            <option value="recent">Most recent first</option>
            <option value="oldest">Least recent first</option>
            <option value="company_az">Company A–Z</option>
            <option value="company_za">Company Z–A</option>
          </select>
        </label>

        <label className="inline-flex items-center gap-2 text-sm text-ink-soft">
          <span className="text-ink-faint">Subject</span>
          <select
            className="inp h-9 w-52 text-sm"
            value={subjectFilter}
            onChange={(e) => {
              setSubjectFilter(e.target.value);
              try { localStorage.setItem("co:followupSubject", e.target.value); } catch {}
            }}
            disabled={subjectOptions.length === 0}
            title={subjectOptions.length === 0 ? "Sync from Affinity to populate subjects" : "Filter by email subject"}
          >
            <option value="">All subjects{subjectOptions.length ? ` (${subjectOptions.length})` : ""}</option>
            {subjectOptions.map((s) => (
              <option key={s} value={s}>
                {s.length > 60 ? s.slice(0, 57) + "…" : s}
              </option>
            ))}
          </select>
        </label>

        {(segment === "no_answer" || segment === "all") && (
          <div className="ml-auto inline-flex items-center gap-2 text-sm text-ink-soft">
            <span className="text-ink-faint">No response</span>
            <span className="inline-flex h-9 overflow-hidden rounded-md border border-line">
              {(["\u2265", "\u2264", "="] as const).map((sym, i) => {
                const op = (["\u003e=", "\u003c=", "="] as const)[i];
                return (
                  <button
                    key={op}
                    onClick={() => setFilterOp(op)}
                    className={`w-9 text-base leading-none ${
                      filterOp === op
                        ? "bg-accent text-white"
                        : "bg-panel text-ink-soft hover:bg-accent-soft"
                    }`}
                  >
                    {sym}
                  </button>
                );
              })}
            </span>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              className="inp h-9 w-14 text-center"
              value={staleDays === 0 ? "" : staleDays}
              placeholder="0"
              onChange={(e) => {
                const v = e.target.value;
                setStaleDays(v === "" ? 0 : Math.max(0, Math.floor(Number(v)) || 0));
              }}
            />
            <span className="text-ink-faint">days</span>
          </div>
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
                      {t.contact_name}
                      {t.contact_email && (
                        <span className="font-normal text-ink-faint"> · {t.contact_email}</span>
                      )}
                    </p>
                    {(t.company || t.subject) && (
                      <p className="text-sm text-ink-soft">
                        {[t.company, t.subject].filter(Boolean).join(" — ")}
                      </p>
                    )}
                    <p className="mt-0.5 text-xs text-ink-faint">
                      {t.last_inbound_at ? "Replied" : "Awaiting reply"}
                      {t.meeting_at ? " · meeting on file" : ""}
                      {t.source !== "manual" ? ` · via ${t.source}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold text-white"
                      style={{ backgroundColor: daysColor(d) }}
                      title={`Last emailed ${d} day${d === 1 ? "" : "s"} ago`}
                    >
                      {d}d{t.status === "no_answer" ? " · no reply" : ""}
                    </span>
                    <span className={`inline-flex items-center gap-1.5 font-mono text-[11px] ${meta.text}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden />
                      {meta.label}
                    </span>
                  </div>
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
