"use client";

import { useState } from "react";
import type { EmailRow } from "@/lib/types";
import {
  addressLine,
  emailBlock,
  emailBlockHtml,
  buildCopyAll,
  buildCopyAllHtml,
} from "@/lib/format";
import { linkifyParts } from "@/lib/linkify";

/** Write both rich HTML and plain text so pasted links stay clickable. */
async function richCopy(plain: string, html: string): Promise<boolean> {
  try {
    if (
      typeof ClipboardItem !== "undefined" &&
      navigator.clipboard &&
      "write" in navigator.clipboard
    ) {
      const item = new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([plain], { type: "text/plain" }),
      });
      await navigator.clipboard.write([item]);
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

/** Inline renderer that turns URLs/emails into clickable links. */
function LinkedText({ text }: { text: string }) {
  return (
    <>
      {linkifyParts(text).map((p, i) =>
        p.kind === "link" ? (
          <a
            key={i}
            href={p.href}
            target="_blank"
            rel="noopener noreferrer"
            className="break-words text-accent-ink underline underline-offset-2 hover:text-accent"
          >
            {p.value}
          </a>
        ) : (
          <span key={i}>{p.value}</span>
        ),
      )}
    </>
  );
}

function CopyButton({
  plain,
  html,
  label = "Copy",
}: {
  plain: string;
  html: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    const ok = await richCopy(plain, html);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }
  return (
    <button className="btn btn-ghost py-1 text-xs" onClick={copy}>
      {copied ? "Copied ✓" : label}
    </button>
  );
}

/** Header label for the disclosure: name(s), company, website. */
function headerLabel(row: EmailRow): string {
  const names = row.recipients
    .map((r) => r.name.trim())
    .filter(Boolean)
    .join(", ");
  const site = row.website
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
  const parts = [names, row.company.trim(), site].filter(Boolean);
  return parts.join("  ·  ") || "(no details)";
}

function OutputItem({ row, index }: { row: EmailRow; index: number }) {
  const [open, setOpen] = useState(index === 0);
  const header = headerLabel(row);
  const plain = emailBlock(row);
  const html = emailBlockHtml(row);

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
        <CopyButton plain={plain} html={html} />
      </div>
      {open && (
        <div className="border-t border-line px-4 py-3">
          {addressLine(row) ? (
            <p className="mb-3 font-mono text-xs text-ink-faint">
              <LinkedText text={addressLine(row)} />
            </p>
          ) : null}
          <div className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink">
            <LinkedText text={row.body} />
          </div>
        </div>
      )}
    </div>
  );
}

export function OutputAccordion({ rows }: { rows: EmailRow[] }) {
  const done = rows.filter((r) => r.status === "done" && r.body.trim());
  if (done.length === 0) return null;

  const allPlain = buildCopyAll(rows);
  const allHtml = buildCopyAllHtml(rows);

  return (
    <section className="mt-10">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Generated emails</h2>
          <span className="eyebrow">{done.length} ready</span>
        </div>
        <CopyButton plain={allPlain} html={allHtml} label="Copy all" />
      </div>
      <p className="mb-4 max-w-prose text-sm text-ink-faint">
        Each row is labelled by recipient, company, and website. Links in the
        body are clickable and copy as real hyperlinks (paste into Gmail keeps
        them live). &ldquo;Copy all&rdquo; joins every email with three blank
        lines between, ready to hand off.
      </p>
      <div className="space-y-3">
        {done.map((r, i) => (
          <OutputItem key={r.id} row={r} index={i} />
        ))}
      </div>
    </section>
  );
}
