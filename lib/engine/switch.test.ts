import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { switchEvent, switchBackEvent, isSwitched, listSwitches, getSwitchHistory } from "./switch";
import type { ShadowReport } from "./shadow";

const temps: string[] = [];
afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

function fixture(): string {
  const base = mkdtempSync(path.join(tmpdir(), "engine-switch-"));
  temps.push(base);
  mkdirSync(path.join(base, "data", "runs"), { recursive: true });
  return base;
}

function writeShadowReports(base: string, event: string, count: number): void {
  for (let i = 1; i <= count; i++) {
    const day = String(i).padStart(2, "0");
    const report: ShadowReport = {
      taskId: `${event}-${day}`,
      event,
      comparedAt: `2026-11-${day}T10:00:00Z`,
      differences: [],
      expansion: null,
    };
    writeFileSync(path.join(base, "data", "runs", `shadow-${event}-${day}.json`), JSON.stringify(report));
  }
}

describe("engine per-event cutover (FR-9)", () => {
  it("refuses to switch without shadow reports", () => {
    const base = fixture();
    const r = switchEvent(base, "APPLICATION_SUBMITTED", "user", "test");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("no shadow reports");
    expect(isSwitched(base, "APPLICATION_SUBMITTED")).toBe(false);
  });

  it("refuses to switch when M-7 not met", () => {
    const base = fixture();
    writeShadowReports(base, "APPLICATION_SUBMITTED", 5); // Need 20.
    const r = switchEvent(base, "APPLICATION_SUBMITTED", "user", "test");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("M-7 not met");
    expect(isSwitched(base, "APPLICATION_SUBMITTED")).toBe(false);
  });

  it("switches when M-7 is met", () => {
    const base = fixture();
    writeShadowReports(base, "APPLICATION_SUBMITTED", 20);
    const r = switchEvent(base, "APPLICATION_SUBMITTED", "user", "M-7 met, cutover");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.record.event).toBe("APPLICATION_SUBMITTED");
    expect(r.record.switched).toBe(true);
    expect(r.record.m7ConsecutiveZeroDiffs).toBe(20);
    expect(isSwitched(base, "APPLICATION_SUBMITTED")).toBe(true);
  });

  it("refuses to switch an already-switched event", () => {
    const base = fixture();
    writeShadowReports(base, "APPLICATION_SUBMITTED", 20);
    expect(switchEvent(base, "APPLICATION_SUBMITTED", "user", "first").ok).toBe(true);
    const r2 = switchEvent(base, "APPLICATION_SUBMITTED", "user", "second");
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toContain("already switched");
  });

  it("switch-back reverses the cutover individually", () => {
    const base = fixture();
    writeShadowReports(base, "APPLICATION_SUBMITTED", 20);
    expect(switchEvent(base, "APPLICATION_SUBMITTED", "user", "cutover").ok).toBe(true);
    expect(isSwitched(base, "APPLICATION_SUBMITTED")).toBe(true);
    const back = switchBackEvent(base, "APPLICATION_SUBMITTED", "user", "rollback test");
    expect(back.ok).toBe(true);
    expect(isSwitched(base, "APPLICATION_SUBMITTED")).toBe(false);
  });

  it("refuses switch-back when not switched", () => {
    const base = fixture();
    const r = switchBackEvent(base, "APPLICATION_SUBMITTED", "user", "test");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("not currently switched");
  });

  it("listSwitches and history track all events", () => {
    const base = fixture();
    writeShadowReports(base, "APPLICATION_SUBMITTED", 20);
    writeShadowReports(base, "PROFILE_CHANGED", 10);
    expect(switchEvent(base, "APPLICATION_SUBMITTED", "user", "cutover").ok).toBe(true);
    expect(switchEvent(base, "PROFILE_CHANGED", "user", "cutover").ok).toBe(true);
    const list = listSwitches(base);
    expect(list).toHaveLength(2);
    const history = getSwitchHistory(base);
    expect(history).toHaveLength(2);
    // Switch one back; history grows.
    expect(switchBackEvent(base, "PROFILE_CHANGED", "user", "rollback").ok).toBe(true);
    expect(getSwitchHistory(base)).toHaveLength(3);
    expect(isSwitched(base, "APPLICATION_SUBMITTED")).toBe(true);
    expect(isSwitched(base, "PROFILE_CHANGED")).toBe(false);
  });
});
