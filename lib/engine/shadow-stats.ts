// FR-9: Shadow reconciliation statistics (P1).
// Tracks M-7: shadow comparison differences per event.
// - APPLICATION_SUBMITTED: 20 consecutive zero-difference runs required.
// - Other events: 10 consecutive zero-difference runs each.
//
// Reports are stored at data/runs/shadow-<taskId>.json by the CLI.
// This module scans them and computes the consecutive zero-difference streak.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ShadowReport } from "./shadow.ts";

export type EventShadowStats = {
  event: string;
  totalReports: number;
  zeroDiffReports: number;
  /** Consecutive zero-difference reports, most recent first. */
  consecutiveZeroDiff: number;
  /** Required consecutive zero-diffs for cutover (20 for APPLICATION_SUBMITTED, 10 for others). */
  required: number;
  /** Whether M-7 is met for this event. */
  met: boolean;
  lastReportAt?: string;
};

export type ShadowStats = {
  events: EventShadowStats[];
  /** Overall M-7 status: true if all tracked events meet their requirement. */
  allMet: boolean;
  computedAt: string;
};

function requiredForEvent(event: string): number {
  return event === "APPLICATION_SUBMITTED" ? 20 : 10;
}

/**
 * Scan data/runs/shadow-*.json and compute per-event statistics.
 * Reports are sorted by comparedAt descending; consecutiveZeroDiff counts
 * from the most recent backwards until a non-zero-diff report is found.
 */
export function computeShadowStats(baseDir: string): ShadowStats {
  const runsDir = path.join(baseDir, "data", "runs");
  const byEvent = new Map<string, ShadowReport[]>();

  if (existsSync(runsDir)) {
    const files = readdirSync(runsDir).filter((f) => f.startsWith("shadow-") && f.endsWith(".json"));
    for (const f of files) {
      try {
        const report = JSON.parse(readFileSync(path.join(runsDir, f), "utf-8")) as ShadowReport;
        if (!report.event) continue;
        const list = byEvent.get(report.event) ?? [];
        list.push(report);
        byEvent.set(report.event, list);
      } catch {
        // Skip unreadable reports.
      }
    }
  }

  const events: EventShadowStats[] = [];
  for (const [event, reports] of byEvent) {
    // Sort by comparedAt descending (most recent first).
    reports.sort((a, b) => (b.comparedAt ?? "").localeCompare(a.comparedAt ?? ""));
    const totalReports = reports.length;
    const zeroDiffReports = reports.filter((r) => r.differences.length === 0).length;
    // Consecutive zero-diffs from most recent.
    let consecutiveZeroDiff = 0;
    for (const r of reports) {
      if (r.differences.length === 0) consecutiveZeroDiff++;
      else break;
    }
    const required = requiredForEvent(event);
    const met = consecutiveZeroDiff >= required;
    events.push({
      event,
      totalReports,
      zeroDiffReports,
      consecutiveZeroDiff,
      required,
      met,
      lastReportAt: reports[0]?.comparedAt,
    });
  }

  // Sort by event name for stable output.
  events.sort((a, b) => a.event.localeCompare(b.event));
  const allMet = events.length > 0 && events.every((e) => e.met);
  return { events, allMet, computedAt: new Date().toISOString() };
}

/**
 * Check if a specific event has met the M-7 requirement.
 */
export function isEventReadyForCutover(baseDir: string, event: string): boolean {
  const stats = computeShadowStats(baseDir);
  const e = stats.events.find((x) => x.event === event);
  if (!e) return false;
  return e.met;
}
