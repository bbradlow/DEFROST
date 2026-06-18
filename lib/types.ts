export type Writer = {
  id: string;
  owner_id: string;
  name: string;
  email: string;
  title: string | null;
  signature: string | null;
  calendly: string | null;
  created_at: string;
};

export type StylePrompt = {
  id: string;
  owner_id: string;
  name: string;
  body: string;
  created_at: string;
};

export type Recipient = {
  name: string;
  email: string; // filled in after generation; may be blank
};

export type RowStatus =
  | "idle"
  | "finding"
  | "generating"
  | "done"
  | "error";

export type EmailRow = {
  id: string;
  writerId: string | null;
  company: string;
  website: string;
  recipients: Recipient[];
  additionalInfo: string;
  // generation/runtime state (not persisted)
  status: RowStatus;
  body: string;
  error?: string;
  extractionWeak?: boolean;
  csvIssue?: string;
  // cached readable text from the website so we don't re-fetch when generating
  siteContext?: string;
};

export type ModelOption = {
  id: string;
  name: string;
  contextLength: number | null;
  free: boolean;
  priceLabel: string; // "Free" or e.g. "$0.50/$1.50 per 1M"
};

// Shape returned by /api/founders
export type FoundersResult = {
  recipients: { name: string; role?: string; email?: string }[];
  website?: string;
  siteContext: string;
  weak: boolean;
  note?: string;
};

export function newRow(partial: Partial<EmailRow> = {}): EmailRow {
  return {
    id:
      globalThis.crypto?.randomUUID?.() ??
      `row_${Math.random().toString(36).slice(2)}`,
    writerId: null,
    company: "",
    website: "",
    recipients: [],
    additionalInfo: "",
    status: "idle",
    body: "",
    ...partial,
  };
}
