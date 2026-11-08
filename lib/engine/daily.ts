import { atomicWriteFileSync as writeFileSync } from "./storage.ts";
// FR-10: Daily auto-recalculation (P1).
// daily.json is derived from the ledger, not hand-maintained.
// - Recalculated by Chicago date (America/Chicago).
// - Only TODAY is recalculated; historical days are frozen.
// - apply count = ledger rows with date_submitted=today AND submission_status='confirmed'.
// - Replaying the same event does not double-count (derived from ledger, not incremented).
//
// The daemon calls recalculateDaily() after a committed Run. The apply.ts incremental
// update is retained as a fast path, but recalculateDaily() is the source of truth
// and corrects any drift.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseLedger, chicagoToday } from "../ledger.ts";
import { deriveDailyCounts } from "./daily-counts.ts";
import { dailyFileSchema } from "./schema.ts";
import { canonicalJson } from "./serialize.ts";

export type DailyDay = {
  discovery: number;
  screening: number;
  tailoring: number;
  review: number;
  apply: number;
};

export type DailyFile = {
  version: number;
  updatedAt: string;
  days: Record<string, DailyDay>;
};

const EMPTY_DAY: DailyDay = { discovery: 0, screening: 0, tailoring: 0, review: 0, apply: 0 };

/**
 * Recalculate today's counts from the ledger.
 * Only the `today` entry is touched; all other days are frozen.
 * @returns the updated DailyFile, or null if ledger is unreadable.
 */
export function recalculateDaily(baseDir: string, today?: string): DailyFile | null {
  const day = today ?? chicagoToday();
  const ledgerPath = path.join(baseDir, "data", "mirror", "ledger.csv");
  if (!existsSync(ledgerPath)) return null;

  const ledgerText = readFileSync(ledgerPath, "utf-8");

  const rows = parseLedger(ledgerText);
  // FR-10: apply = confirmed submissions on this date.
  const applyCount = rows.filter(
    (r) => r.date_submitted === day && r.submission_status === "confirmed"
  ).length;

  // Business throughput comes from committed runs, never current backlog.
  const counts = deriveDailyCounts(baseDir)[day] ?? EMPTY_DAY;
  const dailyPath = path.join(baseDir, "data", "daily.json");
  let daily: DailyFile;
  if (existsSync(dailyPath)) {
    try {
      daily = JSON.parse(readFileSync(dailyPath, "utf-8")) as DailyFile;
      if (!dailyFileSchema.safeParse(daily).success) throw new Error("invalid daily schema");
    } catch {
      throw new Error("daily.json: corrupt; refusing to replace history");
    }
  } else {
    daily = { version: 0, updatedAt: "", days: {} };
  }

  // Freeze history: only touch today's entry.
  // 2026-11-05: only write when counts actually changed (was: unconditional
  // version bump every poll, burning version numbers).
  const prev = daily.days[day] ?? { ...EMPTY_DAY };
  const next = {
    discovery: counts.discovery,
    screening: counts.screening,
    tailoring: counts.tailoring,
    review: counts.review,
    apply: applyCount,
  };
  if (
    prev.discovery === next.discovery &&
    prev.screening === next.screening &&
    prev.tailoring === next.tailoring &&
    prev.review === next.review &&
    prev.apply === next.apply
  ) {
    return daily; // no change, no write, no version bump
  }
  daily.days[day] = next;
  daily.version = (daily.version ?? 0) + 1;
  daily.updatedAt = new Date().toISOString();

  writeFileSync(dailyPath, canonicalJson(daily), "utf-8");
  return daily;
}

/**
 * Verify that daily.json's apply count matches the ledger for a given date.
 * Used by FR-10 acceptance: "与台账确认数一致".
 */
export function verifyDailyMatchesLedger(baseDir: string, date?: string): { ok: boolean; dailyApply?: number; ledgerConfirmed?: number; error?: string } {
  const day = date ?? chicagoToday();
  const ledgerPath = path.join(baseDir, "data", "mirror", "ledger.csv");
  const dailyPath = path.join(baseDir, "data", "daily.json");
  if (!existsSync(ledgerPath)) return { ok: false, error: "ledger.csv missing" };
  if (!existsSync(dailyPath)) return { ok: false, error: "daily.json missing" };
  try {
    const rows = parseLedger(readFileSync(ledgerPath, "utf-8"));
    const ledgerConfirmed = rows.filter(
      (r) => r.date_submitted === day && r.submission_status === "confirmed"
    ).length;
    const daily = JSON.parse(readFileSync(dailyPath, "utf-8")) as DailyFile;
    const dailyApply = daily.days[day]?.apply;
    if (dailyApply === undefined) return { ok: false, error: `daily.json has no entry for ${day}` };
    return { ok: dailyApply === ledgerConfirmed, dailyApply, ledgerConfirmed };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
