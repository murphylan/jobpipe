import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listPending, listRuns, loadEngineStatus, readRunDetail, writeDecision } from "./console.ts";
import { writeReceipt } from "./receipt.ts";

let base: string;

function dataPath(...parts: string[]): string {
  return path.join(base, "data", ...parts);
}

beforeEach(() => {
  base = mkdtempSync(path.join(tmpdir(), "jobpipe-console-"));
  mkdirSync(dataPath("runs"), { recursive: true });
  mkdirSync(dataPath("receipts"), { recursive: true });
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

function writeRun(taskId: string, event: string, status: string, finishedAt: string): void {
  writeFileSync(
    dataPath("runs", `${taskId}.json`),
    JSON.stringify({ taskId, event, status, summary: `${event} ${status}`, finishedAt }),
    "utf-8",
  );
}

describe("engine console data layer (temp dirs only)", () => {
  it("lists runs newest first and skips corrupt files", () => {
    writeRun("a-001", "DISCOVERED", "committed", "2026-11-01T01:00:00Z");
    writeRun("b-002", "SCREENED", "committed", "2026-11-01T03:00:00Z");
    writeFileSync(dataPath("runs", "bad.json"), "{not json", "utf-8");
    const runs = listRuns(base);
    expect(runs.map((r) => r.taskId)).toEqual(["b-002", "a-001"]);
  });

  it("lists only pending-approval receipts", () => {
    writeReceipt(base, { taskId: "p-001", event: "PROFILE_CHANGED", status: "pending-approval", createdAt: "2026-11-01T01:00:00Z", summary: "held" });
    writeReceipt(base, { taskId: "c-001", event: "TARGET_SET", status: "committed", createdAt: "2026-11-01T02:00:00Z", summary: "done" });
    expect(listPending(base).map((r) => r.taskId)).toEqual(["p-001"]);
  });

  it("reads a run detail with receipt json and md", () => {
    writeRun("d-001", "TARGET_SET", "committed", "2026-11-01T01:00:00Z");
    writeReceipt(base, { taskId: "d-001", event: "TARGET_SET", status: "committed", createdAt: "2026-11-01T01:00:00Z", summary: "done" });
    const detail = readRunDetail(base, "d-001");
    expect(detail.run?.status).toBe("committed");
    expect(detail.receipt?.status).toBe("committed");
    expect(detail.receiptMd).toContain("# Receipt d-001");
    const missing = readRunDetail(base, "nope");
    expect(missing.run).toBeNull();
    expect(missing.receipt).toBeNull();
    expect(readRunDetail(base, "../evil").run).toBeNull();
  });

  it("writes a decision only for a pending receipt with a quote", () => {
    writeReceipt(base, { taskId: "p-001", event: "PROFILE_CHANGED", status: "pending-approval", createdAt: "2026-11-01T01:00:00Z", summary: "held" });
    expect(writeDecision(base, { taskId: "p-001", approved: true, quote: "" })).toEqual({ ok: false, reason: "quote-required" });
    expect(writeDecision(base, { taskId: "../evil", approved: true, quote: "yes" })).toEqual({ ok: false, reason: "invalid-taskId" });
    expect(writeDecision(base, { taskId: "ghost", approved: true, quote: "yes" })).toEqual({ ok: false, reason: "receipt-not-found" });
    const ok = writeDecision(base, { taskId: "p-001", approved: true, quote: "yes, change it" });
    expect(ok).toEqual({ ok: true, taskId: "p-001" });
    const saved = JSON.parse(readFileSync(dataPath("inbox", "decisions", "p-001.json"), "utf-8")) as Record<string, unknown>;
    expect(saved.approved).toBe(true);
    expect(saved.quote).toBe("yes, change it");
    expect(writeDecision(base, { taskId: "p-001", approved: false, quote: "" })).toEqual({ ok: false, reason: "already-decided" });
  });

  it("refuses a decision for a non-pending receipt", () => {
    writeReceipt(base, { taskId: "c-001", event: "TARGET_SET", status: "committed", createdAt: "2026-11-01T01:00:00Z", summary: "done" });
    expect(writeDecision(base, { taskId: "c-001", approved: false, quote: "" })).toEqual({ ok: false, reason: "not-pending" });
    expect(existsSync(dataPath("inbox", "decisions", "c-001.json"))).toBe(false);
  });

  it("loads engine status without throwing on an empty data dir", () => {
    const status = loadEngineStatus(base);
    expect(status.heartbeat.status).toBe("missing");
    expect(status.external.stateMissing).toBe(true);
    expect(status.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(status.todayRow).toBeNull();
  });
});
