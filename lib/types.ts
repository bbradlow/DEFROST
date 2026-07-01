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
  kind: "outreach" | "followup";
  created_at: string;
};

export type ThreadStatus = "no_answer" | "answered" | "meeting_set";

export type EmailThread = {
  id: string;
  owner_id: string;
  contact_name: string;
  contact_email: string | null;
  company: string | null;
  subject: string | null;
  remind_at?: string | null;
  last_outbound_at: string; // ISO
  last_inbound_at: string | null;
  meeting_at: string | null;
  status: ThreadStatus;
  snippet: string | null; // context for drafting the follow-up
  source: string; // 'manual' | 'outlook' | 'affinity'
  thread_url: string | null;
  source_ref?: string | null;
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
  // diagnostics from the last recipient-finding run
  findNote?: string;
  findDebug?: string;
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
  debug?: string; // human-readable stage-by-stage trace
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
