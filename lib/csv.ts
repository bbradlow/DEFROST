import Papa from "papaparse";
import { newRow, type EmailRow, type Writer } from "./types";

const REQUIRED_HEADERS = [
  "writer",
  "company",
  "website",
  "recipients",
  "additional_info",
];

export type CsvParseResult = {
  rows: EmailRow[];
  error?: string;
};

function matchWriter(value: string, writers: Writer[]): Writer | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  return (
    writers.find((w) => w.email.toLowerCase() === v) ??
    writers.find((w) => w.name.toLowerCase() === v) ??
    null
  );
}

export function parseCsv(text: string, writers: Writer[]): CsvParseResult {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  if (parsed.errors.length) {
    return { rows: [], error: parsed.errors[0].message };
  }

  const headers = parsed.meta.fields?.map((f) => f.toLowerCase()) ?? [];
  const missing = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length) {
    return {
      rows: [],
      error: `CSV is missing required column(s): ${missing.join(", ")}. Expected header: ${REQUIRED_HEADERS.join(", ")}`,
    };
  }

  const rows: EmailRow[] = parsed.data.map((raw) => {
    const writerVal = (raw.writer ?? "").trim();
    const matched = matchWriter(writerVal, writers);

    const recipientNames = (raw.recipients ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 2);

    return newRow({
      writerId: matched?.id ?? null,
      company: (raw.company ?? "").trim(),
      website: (raw.website ?? "").trim(),
      additionalInfo: (raw.additional_info ?? "").trim(),
      recipients: recipientNames.map((name) => ({ name, email: "" })),
      csvIssue:
        writerVal && !matched
          ? `No writer matches "${writerVal}" — pick one manually.`
          : undefined,
    });
  });

  return { rows };
}
