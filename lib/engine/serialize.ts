// Stage 1 canonical serialization (Doc-00 section 9, first cut).
// - JSON: 2-space indent, key order preserved exactly as given,
//   exactly one trailing newline. This function never sorts keys:
//   real jobs.json puts jobs first and version/updatedAt last, and
//   reordering would create a needless diff on every write.
// - CSV: RFC 4180 quoting, header length asserted, every row must
//   match the header length. New ledger rows are always written
//   with all 19 columns, even though existing rows on disk have 18
//   (see schema.ts known drift); serialization never rewrites old
//   rows on its own.
import { COLS } from "../ledger.ts";

export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

export function csvField(field: string): string {
  if (/[",\r\n]/.test(field)) return `"${field.replace(/"/g, '""')}"`;
  return field;
}

export function serializeLedgerCsv(rows: readonly (readonly string[])[]): string {
  const header = COLS as readonly string[];
  for (const row of rows) {
    if (row.length !== header.length) {
      throw new Error(
        `ledger row has ${row.length} fields, expected ${header.length}; refusing to write a short row`,
      );
    }
  }
  const lines = [header, ...rows].map((row) => row.map(csvField).join(","));
  return lines.join("\n") + "\n";
}
