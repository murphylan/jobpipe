import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseCsv } from "../csv.ts";

const RUN_EVENT_TO_FIELD: Record<string, string> = {
  DISCOVERED: "discovery",
  SCREENED: "screening",
  TAILORED: "tailoring",
  USER_DECIDED: "review",
};

function chicagoDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

export function deriveDailyCounts(baseDir: string): Record<string, Record<string, number>> {
  const days: Record<string, Record<string, number>> = {};
  const ensure = (date: string): Record<string, number> => {
    if (!days[date]) days[date] = { discovery: 0, screening: 0, tailoring: 0, review: 0, apply: 0 };
    return days[date];
  };
  const runsDir = path.join(baseDir, "data", "runs");
  if (existsSync(runsDir)) {
    for (const file of readdirSync(runsDir).filter((f) => f.endsWith(".json")).sort()) {
      try {
        const run = JSON.parse(readFileSync(path.join(runsDir, file), "utf-8")) as { event?: unknown; status?: unknown; finishedAt?: unknown };
        if (run.status !== "committed") continue;
        const field = typeof run.event === "string" ? RUN_EVENT_TO_FIELD[run.event] : undefined;
        if (!field || typeof run.finishedAt !== "string") continue;
        ensure(chicagoDate(run.finishedAt))[field] += 1;
      } catch {
        continue;
      }
    }
  }
  const ledgerPath = path.join(baseDir, "data", "mirror", "ledger.csv");
  if (existsSync(ledgerPath)) {
    const rows = parseCsv(readFileSync(ledgerPath, "utf-8"));
    for (const row of rows.slice(1)) {
      if (row[10] !== "confirmed") continue;
      if (!row[1]) continue;
      ensure(row[1]).apply += 1;
    }
  }
  return days;
}
