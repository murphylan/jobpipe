import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeShadowStats, isEventReadyForCutover } from "./shadow-stats";
import type { ShadowReport } from "./shadow";

const temps: string[] = [];
afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

function fixture(): string {
  const base = mkdtempSync(path.join(tmpdir(), "engine-shadow-stats-"));
  temps.push(base);
  mkdirSync(path.join(base, "data", "runs"), { recursive: true });
  return base;
}

function writeReport(base: string, taskId: string, event: string, differences: string[], comparedAt: string): void {
  const report: ShadowReport = { taskId, event, comparedAt, differences, expansion: null };
  writeFileSync(path.join(base, "data", "runs", `shadow-${taskId}.json`), JSON.stringify(report));
}

describe("engine shadow stats (FR-9, M-7)", () => {
  it("returns empty when no reports exist", () => {
    const base = fixture();
    const stats = computeShadowStats(base);
    expect(stats.events).toEqual([]);
    expect(stats.allMet).toBe(false);
  });

  it("counts consecutive zero-diffs for APPLICATION_SUBMITTED (requires 20)", () => {
    const base = fixture();
    // 5 consecutive zero-diffs.
    for (let i = 1; i <= 5; i++) {
      writeReport(base, `t-${i}`, "APPLICATION_SUBMITTED", [], `2026-11-0${i}T10:00:00Z`);
    }
    const stats = computeShadowStats(base);
    expect(stats.events).toHaveLength(1);
    const e = stats.events[0];
    expect(e.event).toBe("APPLICATION_SUBMITTED");
    expect(e.totalReports).toBe(5);
    expect(e.consecutiveZeroDiff).toBe(5);
    expect(e.required).toBe(20);
    expect(e.met).toBe(false);
    expect(isEventReadyForCutover(base, "APPLICATION_SUBMITTED")).toBe(false);
  });

  it("marks met when 20 consecutive zero-diffs reached", () => {
    const base = fixture();
    for (let i = 1; i <= 20; i++) {
      const day = String(i).padStart(2, "0");
      writeReport(base, `t-${day}`, "APPLICATION_SUBMITTED", [], `2026-11-${day}T10:00:00Z`);
    }
    const stats = computeShadowStats(base);
    const e = stats.events[0];
    expect(e.consecutiveZeroDiff).toBe(20);
    expect(e.met).toBe(true);
    expect(isEventReadyForCutover(base, "APPLICATION_SUBMITTED")).toBe(true);
  });

  it("resets consecutive count on non-zero diff", () => {
    const base = fixture();
    // 3 zero-diffs, then 1 with diff, then 2 zero-diffs.
    writeReport(base, "t-1", "APPLICATION_SUBMITTED", [], "2026-11-01T10:00:00Z");
    writeReport(base, "t-2", "APPLICATION_SUBMITTED", [], "2026-11-02T10:00:00Z");
    writeReport(base, "t-3", "APPLICATION_SUBMITTED", [], "2026-11-03T10:00:00Z");
    writeReport(base, "t-4", "APPLICATION_SUBMITTED", ["job status differs"], "2026-11-04T10:00:00Z");
    writeReport(base, "t-5", "APPLICATION_SUBMITTED", [], "2026-11-05T10:00:00Z");
    writeReport(base, "t-6", "APPLICATION_SUBMITTED", [], "2026-11-06T10:00:00Z");
    const stats = computeShadowStats(base);
    const e = stats.events[0];
    expect(e.totalReports).toBe(6);
    expect(e.zeroDiffReports).toBe(5);
    // Most recent 2 are zero-diff, then a break.
    expect(e.consecutiveZeroDiff).toBe(2);
    expect(e.met).toBe(false);
  });

  it("other events require 10 consecutive zero-diffs", () => {
    const base = fixture();
    for (let i = 1; i <= 10; i++) {
      const day = String(i).padStart(2, "0");
      writeReport(base, `p-${day}`, "PROFILE_CHANGED", [], `2026-11-${day}T10:00:00Z`);
    }
    const stats = computeShadowStats(base);
    const e = stats.events.find((x) => x.event === "PROFILE_CHANGED")!;
    expect(e.required).toBe(10);
    expect(e.consecutiveZeroDiff).toBe(10);
    expect(e.met).toBe(true);
  });

  it("allMet requires all events to meet", () => {
    const base = fixture();
    // APPLICATION_SUBMITTED: 20/20 met.
    for (let i = 1; i <= 20; i++) {
      const day = String(i).padStart(2, "0");
      writeReport(base, `a-${day}`, "APPLICATION_SUBMITTED", [], `2026-11-${day}T10:00:00Z`);
    }
    // PROFILE_CHANGED: only 5/10, not met.
    for (let i = 1; i <= 5; i++) {
      writeReport(base, `p-${i}`, "PROFILE_CHANGED", [], `2026-11-0${i}T11:00:00Z`);
    }
    const stats = computeShadowStats(base);
    expect(stats.allMet).toBe(false);
  });
});
