"use client";

import { useEffect, useRef, useState } from "react";
import {
  newRow,
  type EmailRow as Row,
  type FreeModel,
  type Writer,
  type FoundersResult,
} from "@/lib/types";
import { DEFAULT_BASE_PROMPT } from "@/lib/prompts";
import { parseCsv } from "@/lib/csv";
import { EmailRow } from "@/components/EmailRow";
import { OutputAccordion } from "@/components/OutputAccordion";

// Free models cap ~20 req/min. ~3.5s between calls keeps us safely under.
const THROTTLE_MS = 3500;
const RATE_LIMIT_BACKOFF_MS = 9000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function GeneratorGrid({ writers }: { writers: Writer[] }) {
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [models, setModels] = useState<FreeModel[]>([]);
  const [model, setModel] = useState<string>("openrouter/free");
  const [modelsErr, setModelsErr] = useState<string | null>(null);
  const [modelsLoading, setModelsLoading] = useState(true);

  const [basePrompt, setBasePrompt] = useState(DEFAULT_BASE_PROMPT);
  const [showPrompt, setShowPrompt] = useState(false);

  const [bulkWriterId, setBulkWriterId] = useState<string>("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  // Keep a ref to the latest rows so throttled loops read fresh data.
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  // Load the live free-model list once.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/models");
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed to load models");
        const list: FreeModel[] = json.models ?? [];
        setModels(list);
        // Default selection: keep the free router (always present, index 0).
        if (list.length && !list.some((m) => m.id === model)) {
          setModel(list[0].id);
        }
      } catch (e) {
        setModelsErr(e instanceof Error ? e.message : "Failed to load models");
      } finally {
        setModelsLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function patchRow(id: string, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((rs) => [...rs, newRow()]);
  }

  function removeRow(id: string) {
    setRows((rs) => (rs.length === 1 ? [newRow()] : rs.filter((r) => r.id !== id)));
  }

  function applyWriterToAll() {
    if (!bulkWriterId) return;
    setRows((rs) => rs.map((r) => ({ ...r, writerId: bulkWriterId, csvIssue: undefined })));
  }

  // ---- Recipient extraction ------------------------------------------------
  async function findRecipients(id: string): Promise<void> {
    const row = rowsRef.current.find((r) => r.id === id);
    if (!row || !row.website.trim()) return;
    patchRow(id, { status: "finding", error: undefined });
    try {
      const res = await fetch("/api/founders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ website: row.website, company: row.company, model }),
      });
      const data: FoundersResult & { error?: string } = await res.json();
      if (res.status === 429) {
        patchRow(id, { status: "idle" });
        throw new Error("RATE_LIMIT");
      }
      const recipients =
        data.recipients?.slice(0, 2).map((r) => ({ name: r.name, email: "" })) ?? [];
      patchRow(id, {
        status: "idle",
        recipients: recipients.length ? recipients : row.recipients,
        siteContext: data.siteContext || row.siteContext,
        extractionWeak: data.weak,
      });
    } catch (e) {
      if (e instanceof Error && e.message === "RATE_LIMIT") throw e;
      patchRow(id, { status: "idle", extractionWeak: true });
    }
  }

  // ---- Generation ----------------------------------------------------------
  async function generateOne(id: string): Promise<void> {
    const row = rowsRef.current.find((r) => r.id === id);
    if (!row || !row.writerId) return;
    patchRow(id, { status: "generating", error: undefined });
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          writerId: row.writerId,
          company: row.company,
          website: row.website,
          recipients: row.recipients,
          additionalInfo: row.additionalInfo,
          model,
          basePrompt,
          siteContext: row.siteContext,
        }),
      });
      const data = await res.json();
      if (res.status === 429) {
        patchRow(id, { status: "idle" });
        throw new Error("RATE_LIMIT");
      }
      if (!res.ok) throw new Error(data.error ?? "Generation failed");
      patchRow(id, { status: "done", body: data.body });
    } catch (e) {
      if (e instanceof Error && e.message === "RATE_LIMIT") throw e;
      patchRow(id, {
        status: "error",
        error: e instanceof Error ? e.message : "Generation failed",
      });
    }
  }

  // Keep a ref to the latest rows so throttled loops read fresh data.
  // (rowsRef is declared near the top of the component.)

  /** Run a worker over the given row ids sequentially, throttled, with one
   *  rate-limit backoff+retry per row. */
  async function runThrottled(
    ids: string[],
    worker: (id: string) => Promise<void>,
  ) {
    setProgress({ done: 0, total: ids.length });
    setBanner(null);
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      try {
        await worker(id);
      } catch (e) {
        if (e instanceof Error && e.message === "RATE_LIMIT") {
          setBanner("Hit the free-tier rate limit — backing off, then retrying…");
          await sleep(RATE_LIMIT_BACKOFF_MS);
          try {
            await worker(id);
          } catch {
            patchRow(id, {
              status: "error",
              error: "Rate limited. Retry this row manually in a moment.",
            });
          }
          setBanner(null);
        }
      }
      setProgress({ done: i + 1, total: ids.length });
      if (i < ids.length - 1) await sleep(THROTTLE_MS);
    }
    setProgress(null);
  }

  async function generateAll() {
    const withWriter = rows.filter((r) => r.writerId);
    const without = rows.length - withWriter.length;
    if (withWriter.length === 0) {
      setBanner("No rows have a writer selected. Pick writers (or use “set one for all”).");
      return;
    }
    if (without > 0) {
      setBanner(`Skipping ${without} row(s) with no writer selected.`);
    }
    await runThrottled(withWriter.map((r) => r.id), generateOne);
  }

  async function findAllRecipients() {
    const targets = rows.filter((r) => r.website.trim() && r.recipients.length === 0);
    if (targets.length === 0) {
      setBanner("No rows need recipients (all blank-recipient rows are missing a website).");
      return;
    }
    await runThrottled(targets.map((r) => r.id), findRecipients);
  }

  // ---- CSV import ----------------------------------------------------------
  async function onCsvFile(file: File) {
    const text = await file.text();
    const { rows: parsed, error } = parseCsv(text, writers);
    if (error) {
      setBanner(error);
      return;
    }
    if (parsed.length === 0) {
      setBanner("CSV had no data rows.");
      return;
    }
    const flagged = parsed.filter((r) => r.csvIssue).length;
    setRows(parsed);
    setBanner(
      `Imported ${parsed.length} row(s)` +
        (flagged ? ` — ${flagged} need a writer picked manually.` : ". Review, then generate."),
    );
    if (fileRef.current) fileRef.current.value = "";
  }

  const busy = progress !== null;
  const noWriters = writers.length === 0;

  return (
    <div>
      {/* Controls bar */}
      <div className="mb-6 rounded-lg border border-line bg-panel p-4 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2">
          {/* Model */}
          <div>
            <label className="field-label mb-1 block">Model (free only)</label>
            <select
              className="inp"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={modelsLoading}
            >
              {modelsLoading && <option>Loading models…</option>}
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.contextLength ? ` (${Math.round(m.contextLength / 1000)}k ctx)` : ""}
                </option>
              ))}
            </select>
            {modelsErr ? (
              <p className="mt-1 text-xs text-flag">{modelsErr}</p>
            ) : (
              <p className="mt-1 text-xs text-ink-faint">
                Live list, filtered to free models. Falls back to the free router
                if a model errors.
              </p>
            )}
          </div>

          {/* Set one writer for all */}
          <div>
            <label className="field-label mb-1 block">Set one writer for all</label>
            <div className="flex gap-2">
              <select
                className="inp"
                value={bulkWriterId}
                onChange={(e) => setBulkWriterId(e.target.value)}
                disabled={noWriters}
              >
                <option value="">— choose writer —</option>
                {writers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                    {w.title ? ` · ${w.title}` : ""}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-ghost whitespace-nowrap"
                onClick={applyWriterToAll}
                disabled={!bulkWriterId}
              >
                Apply to all
              </button>
            </div>
            {noWriters && (
              <p className="mt-1 text-xs text-flag">
                Add a writer first on the{" "}
                <a className="underline" href="/writers">
                  Writers
                </a>{" "}
                page.
              </p>
            )}
          </div>
        </div>

        {/* Base prompt (editable) */}
        <div className="mt-4">
          <button
            className="eyebrow hover:text-ink-soft"
            onClick={() => setShowPrompt((s) => !s)}
          >
            {showPrompt ? "▾" : "▸"} Base style prompt (editable)
          </button>
          {showPrompt && (
            <>
              <textarea
                className="inp mt-2 h-44 resize-y font-mono text-xs"
                value={basePrompt}
                onChange={(e) => setBasePrompt(e.target.value)}
              />
              <div className="mt-1 flex items-center justify-between">
                <p className="text-xs text-ink-faint">
                  Defines the house voice. Per-row “additional info” layers on top.
                </p>
                <button
                  className="text-xs text-ink-faint hover:text-ink"
                  onClick={() => setBasePrompt(DEFAULT_BASE_PROMPT)}
                >
                  Reset to default
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Action bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button className="btn btn-ghost" onClick={addRow} disabled={busy}>
          + Add row
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          Import CSV
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onCsvFile(f);
          }}
        />
        <button
          className="btn btn-ghost"
          onClick={findAllRecipients}
          disabled={busy || noWriters}
        >
          Auto-fill recipients (all)
        </button>
        <div className="flex-1" />
        <button
          className="btn btn-primary"
          onClick={generateAll}
          disabled={busy || noWriters}
        >
          {busy ? "Working…" : "Generate all"}
        </button>
      </div>

      {/* Progress / banner */}
      {progress && (
        <div className="mb-4 rounded border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-accent-ink">
          Processing {progress.done} of {progress.total}… (throttled for free-tier
          limits)
        </div>
      )}
      {banner && !progress && (
        <div className="mb-4 rounded border border-line bg-white px-3 py-2 text-sm text-ink-soft">
          {banner}
        </div>
      )}

      {/* Helper note about CSV schema */}
      <p className="mb-4 font-mono text-[11px] text-ink-faint">
        CSV header: writer, company, website, recipients, additional_info
      </p>

      {/* Rows */}
      <div className="space-y-3">
        {rows.map((row, i) => (
          <EmailRow
            key={row.id}
            row={row}
            index={i}
            writers={writers}
            disabled={busy}
            onPatch={(patch) => patchRow(row.id, patch)}
            onRemove={() => removeRow(row.id)}
            onFindRecipients={() => {
              void findRecipients(row.id).catch(() => {
                setBanner("Rate limited — wait a moment and try again.");
              });
            }}
            onGenerate={() => {
              void generateOne(row.id).catch(() => {
                setBanner("Rate limited — wait a moment and try again.");
              });
            }}
          />
        ))}
      </div>

      {/* Output */}
      <OutputAccordion rows={rows} />
    </div>
  );
}
