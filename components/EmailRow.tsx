"use client";

import type { EmailRow as Row, Recipient, Writer } from "@/lib/types";

function StatusPill({ row }: { row: Row }) {
  const map: Record<
    Row["status"],
    { label: string; text: string; dot: string | null }
  > = {
    idle: { label: "Ready", text: "text-ink-faint", dot: null },
    finding: { label: "Finding recipients…", text: "text-accent", dot: "bg-accent" },
    generating: { label: "Generating…", text: "text-accent", dot: "bg-accent" },
    done: { label: "Generated", text: "text-ink-soft", dot: "bg-success" },
    error: { label: "Error", text: "text-flag", dot: "bg-flag" },
  };
  const s = map[row.status];
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-[11px] ${s.text}`}>
      {s.dot && <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden />}
      {s.label}
    </span>
  );
}

export function EmailRow({
  row,
  index,
  writers,
  onPatch,
  onRemove,
  onFindRecipients,
  onGenerate,
  disabled,
}: {
  row: Row;
  index: number;
  writers: Writer[];
  onPatch: (patch: Partial<Row>) => void;
  onRemove: () => void;
  onFindRecipients: () => void;
  onGenerate: () => void;
  disabled: boolean;
}) {
  function setRecipient(i: number, patch: Partial<Recipient>) {
    const next = [...row.recipients];
    next[i] = { ...next[i], ...patch };
    onPatch({ recipients: next });
  }
  function addRecipient() {
    if (row.recipients.length >= 2) return;
    onPatch({ recipients: [...row.recipients, { name: "", email: "" }] });
  }
  function removeRecipient(i: number) {
    onPatch({ recipients: row.recipients.filter((_, j) => j !== i) });
  }

  const busy = row.status === "finding" || row.status === "generating";

  return (
    <div
      className={`rounded-lg border bg-panel p-4 shadow-sm transition-colors ${
        row.csvIssue ? "border-flag/40" : "border-line"
      }`}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="eyebrow">Email {String(index + 1).padStart(2, "0")}</span>
        <div className="flex items-center gap-3">
          <StatusPill row={row} />
          <button
            className="text-xs text-ink-faint hover:text-flag"
            onClick={onRemove}
            title="Remove row"
          >
            Remove
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {/* Writer */}
        <div>
          <label className="field-label mb-1 block">Writer (sender)</label>
          <select
            className="inp"
            value={row.writerId ?? ""}
            onChange={(e) => onPatch({ writerId: e.target.value || null, csvIssue: undefined })}
          >
            <option value="">— select writer —</option>
            {writers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
                {w.title ? ` · ${w.title}` : ""}
              </option>
            ))}
          </select>
        </div>

        {/* Company */}
        <div>
          <label className="field-label mb-1 block">Company</label>
          <input
            className="inp"
            value={row.company}
            onChange={(e) => onPatch({ company: e.target.value })}
            placeholder="Acme Inc."
          />
        </div>

        {/* Website */}
        <div className="md:col-span-2">
          <label className="field-label mb-1 block">Website</label>
          <input
            className="inp"
            value={row.website}
            onChange={(e) =>
              // editing the URL invalidates any cached site context
              onPatch({ website: e.target.value, siteContext: undefined })
            }
            placeholder="acme.com"
          />
        </div>

        {/* Recipients */}
        <div className="md:col-span-2">
          <div className="mb-1 flex items-center justify-between">
            <label className="field-label">Recipients / founders</label>
            <button
              type="button"
              className="text-[11px] text-accent hover:text-accent-ink disabled:opacity-40"
              onClick={onFindRecipients}
              disabled={disabled || busy || !row.website.trim()}
            >
              {row.status === "finding" ? "Finding…" : "↻ Auto-fill from website"}
            </button>
          </div>

          {row.recipients.length === 0 && (
            <p className="mb-2 text-xs text-ink-faint">
              None yet — add manually or auto-fill from the website (names only;
              fill emails after generating).
            </p>
          )}

          <div className="space-y-2">
            {row.recipients.map((r, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className="inp flex-1"
                  value={r.name}
                  onChange={(e) => setRecipient(i, { name: e.target.value })}
                  placeholder="Name"
                />
                <input
                  className="inp flex-1"
                  value={r.email}
                  onChange={(e) => setRecipient(i, { email: e.target.value })}
                  placeholder="email (add later)"
                />
                <button
                  className="btn btn-ghost px-2 text-xs"
                  onClick={() => removeRecipient(i)}
                  title="Remove recipient"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          {row.recipients.length < 2 && (
            <button
              type="button"
              className="mt-2 text-[11px] text-accent hover:text-accent-ink"
              onClick={addRecipient}
            >
              + Add recipient
            </button>
          )}

          {row.extractionWeak && (
            <p className="mt-2 text-xs text-flag">
              Weak extraction from this site — verify recipients manually.
            </p>
          )}
        </div>

        {/* Additional info */}
        <div className="md:col-span-2">
          <label className="field-label mb-1 block">
            Additional info — what the email should say (structure &amp; angle)
          </label>
          <textarea
            className="inp h-24 resize-y"
            value={row.additionalInfo}
            onChange={(e) => onPatch({ additionalInfo: e.target.value })}
            placeholder="e.g. We invest in infra startups at Series A. Reference their recent launch. Ask for a 20-min intro call. Keep it warm but brief."
          />
        </div>
      </div>

      {row.csvIssue && <p className="mt-3 text-xs text-flag">{row.csvIssue}</p>}
      {row.status === "error" && row.error && (
        <p className="mt-3 text-xs text-flag">Generation error: {row.error}</p>
      )}

      <div className="mt-3 flex justify-end">
        <button
          className="btn btn-primary py-1 text-xs"
          onClick={onGenerate}
          disabled={disabled || busy || !row.writerId}
          title={!row.writerId ? "Pick a writer first" : undefined}
        >
          {row.status === "generating"
            ? "Generating…"
            : row.status === "done"
              ? "↻ Regenerate"
              : "Generate"}
        </button>
      </div>
    </div>
  );
}
