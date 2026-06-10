import type { EmailRow } from "./types";

/**
 * The address line for an email: comma-separated recipient EMAILS if any are
 * filled in, otherwise fall back to recipient NAMES.
 */
export function addressLine(row: EmailRow): string {
  const emails = row.recipients.map((r) => r.email.trim()).filter(Boolean);
  if (emails.length) return emails.join(", ");
  const names = row.recipients.map((r) => r.name.trim()).filter(Boolean);
  return names.join(", ");
}

/** A single email block: address line, then body directly below. */
export function emailBlock(row: EmailRow): string {
  const addr = addressLine(row);
  return addr ? `${addr}\n${row.body}` : row.body;
}

/**
 * "Copy all" payload: every generated email, separated by exactly three blank
 * lines (four newlines between the end of one body and the next address line).
 */
export function buildCopyAll(rows: EmailRow[]): string {
  return rows
    .filter((r) => r.status === "done" && r.body.trim())
    .map(emailBlock)
    .join("\n\n\n\n");
}
