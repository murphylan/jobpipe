import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { processInboxOnce } from "./daemon";
import { readHeartbeatStatus, writeHeartbeat } from "./heartbeat";

const temps: string[] = [];
afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

function fixture(): string {
  const base = mkdtempSync(path.join(tmpdir(), "engine-daemon-"));
  temps.push(base);
  mkdirSync(path.join(base, "data", "inbox"), { recursive: true });
  writeFileSync(path.join(base, "data", "daily-targets.json"), JSON.stringify({ targets: {}, version: 1, updatedAt: "2026-10-31T00:00:00Z" }));
  writeFileSync(path.join(base, "data", "changelog.json"), JSON.stringify({ entries: [], version: 1, updatedAt: "2026-10-31T00:00:00Z" }));
  return base;
}

function inboxFile(base: string, name: string, content: string, old = true): string {
  const full = path.join(base, "data", "inbox", name);
  writeFileSync(full, content);
  if (old) {
    const past = new Date(Date.now() - 10000);
    utimesSync(full, past, past);
  }
  return full;
}

const targetSet = JSON.stringify({ taskId: "target-001", event: "TARGET_SET", createdAt: "2026-11-01T00:00:00Z", payload: { date: "2026-11-01", target: 20 } });

describe("engine daemon (temp dirs only)", () => {
  it("TARGET_SET commits end to end", () => {
    const base = fixture();
    inboxFile(base, "target-001.json", targetSet);
    const results = processInboxOnce(base);
    expect(results).toEqual([{ taskId: "target-001", outcome: "committed", summary: "TARGET_SET 2026-11-01 = 20" }]);
    const targets = JSON.parse(readFileSync(path.join(base, "data", "daily-targets.json"), "utf-8"));
    expect(targets.targets["2026-11-01"]).toBe(20);
    expect(targets.version).toBe(2);
    expect(existsSync(path.join(base, "data", "receipts", "target-001.json"))).toBe(true);
    expect(existsSync(path.join(base, "data", "processed", "target-001.json"))).toBe(true);
    expect(existsSync(path.join(base, "data", "inbox", "target-001.json"))).toBe(false);
    expect(existsSync(path.join(base, "data", "runs", "target-001.json"))).toBe(true);
  });

  it("resubmission of the same taskId is a duplicate, not a second apply", () => {
    const base = fixture();
    inboxFile(base, "target-001.json", targetSet);
    processInboxOnce(base);
    inboxFile(base, "target-001.json", targetSet);
    const results = processInboxOnce(base);
    expect(results[0].outcome).toBe("duplicate");
    const targets = JSON.parse(readFileSync(path.join(base, "data", "daily-targets.json"), "utf-8"));
    expect(targets.version).toBe(2);
  });

  it("invalid JSON is rejected and moved to rejected/", () => {
    const base = fixture();
    inboxFile(base, "bad.json", "{not json");
    const results = processInboxOnce(base);
    expect(results[0].outcome).toBe("rejected");
    expect(existsSync(path.join(base, "data", "rejected", "bad.json"))).toBe(true);
  });

  it("fresh files are skipped, not rejected", () => {
    const base = fixture();
    inboxFile(base, "target-001.json", targetSet, false);
    const results = processInboxOnce(base);
    expect(results[0].outcome).toBe("skipped");
    expect(existsSync(path.join(base, "data", "inbox", "target-001.json"))).toBe(true);
    expect(existsSync(path.join(base, "data", "receipts", "target-001.json"))).toBe(false);
  });

  it("heartbeat: online now, offline after 15 seconds, missing when absent", () => {
    const base = fixture();
    expect(readHeartbeatStatus(base).status).toBe("missing");
    const hb = writeHeartbeat(base, "running");
    expect(readHeartbeatStatus(base, Date.parse(hb.updatedAt)).status).toBe("online");
    expect(readHeartbeatStatus(base, Date.parse(hb.updatedAt) + 20000).status).toBe("offline");
  });
});
