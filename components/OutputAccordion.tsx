"use client";

import { useState } from "react";
import type { EmailRow } from "@/lib/types";
import { addressLine, buildCopyAll } from "@/lib/format";

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }
  return (
    <button className="btn btn-ghost py-1 text-xs" onClick={copy}>
      {copied ? "Copied ✓" : label}
    </button>
  );
}

function OutputItem({ row, index }: { row: EmailRow; index: number }) {
  const [open, setOpen] = useState(index === 0);
  const header = addressLine(row) || "(no recipient)";
  const blockText = `${addressLine(row) ? `${addressLine(row)}\n` : ""}${row.body}`;

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-panel">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <button
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          onClick={() => setOpen((o) => !o)}
        >
          <span
            className={`shrink-0 text-ink-faint transition-transform ${open ? "rotate-90" : ""}`}
            aria-hidden
          >
            ›
          </span>
          <span className="truncate font-mono text-xs text-ink-soft">{header}</span>
        </button>
        <CopyButton text={blockText} />
      </div>
      {open && (
        <div className="border-t border-line px-4 py-3">
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink">
            {row.body}
          </pre>
        </div>
      )}
    </div>
  );
}

export function OutputAccordion({ rows }: { rows: EmailRow[] }) {
  const done = rows.filter((r) => r.status === "done" && r.body.trim());
  if (done.length === 0) return null;

  const all = buildCopyAll(rows);

  return (
    <section className="mt-10">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Generated emails</h2>
          <span className="eyebrow">{done.length} ready</span>
        </div>
        <CopyButton text={all} label="Copy all" />
      </div>
      <p className="mb-4 max-w-prose text-sm text-ink-faint">
        Each block is the recipient address line (emails if filled, otherwise
        names) followed by the body. &ldquo;Copy all&rdquo; joins them with three
        blank lines between, ready to paste to your analyst.
      </p>
      <div className="space-y-3">
        {done.map((r, i) => (
          <OutputItem key={r.id} row={r} index={i} />
        ))}
      </div>
    </section>
  );
}
