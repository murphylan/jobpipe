import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { readHeartbeatStatus, writeHeartbeat } from "./heartbeat";
import { runDaemonLoop } from "./run-daemon";
import { processInboxOnce } from "./daemon";
const dirs: string[] = []; const stops: (() => void)[] = [];
afterEach(() => { stops.splice(0).forEach(stop => stop()); vi.useRealTimers(); dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); });
function fixture() { const base = mkdtempSync(path.join(tmpdir(), "jobpipe-heartbeat-")); dirs.push(base); mkdirSync(path.join(base, "data/engine"), { recursive: true }); return base; }
it.each(["invalid", null, "", "2099-01-01T00:00:00Z"])("invalid/future heartbeat %j never reports online or NaN age", updatedAt => {
  const base = fixture(); writeFileSync(path.join(base, "data/engine/heartbeat.json"), JSON.stringify({ updatedAt, status: "running", pid: 1 }));
  const heartbeat = readHeartbeatStatus(base, Date.parse("2026-11-06T12:00:00Z")); expect(heartbeat.status).toBe("offline"); expect(Number.isNaN(heartbeat.ageMs)).toBe(false);
});
it("distinguishes fresh running, idle stop, error, expired and unreadable heartbeats", () => {
  const base = fixture(); const running = writeHeartbeat(base); const now = Date.parse(running.updatedAt);
  expect(readHeartbeatStatus(base, now).status).toBe("online"); expect(readHeartbeatStatus(base, now + 15001).status).toBe("offline");
  writeHeartbeat(base, "idle"); expect(readHeartbeatStatus(base).status).toBe("offline");
  writeHeartbeat(base, "error", "disk failure"); expect(readHeartbeatStatus(base)).toMatchObject({ status: "offline", error: "disk failure" });
  writeFileSync(path.join(base, "data/engine/heartbeat.json"), "{"); expect(readHeartbeatStatus(base).status).toBe("offline");
});
it("loop heartbeat keeps a failed poll visible until actual recovery and stop releases resources", async () => {
  vi.useFakeTimers(); const base = fixture(); mkdirSync(path.join(base, "data/.journal")); writeFileSync(path.join(base, "data/.journal/orphan.json"), "{");
  const sigint = process.listenerCount("SIGINT"), sigterm = process.listenerCount("SIGTERM");
  const daemon = runDaemonLoop(base, { pollMs: 10000, heartbeatMs: 1000 }); stops.push(daemon.stop);
  expect(readHeartbeatStatus(base).error).toBeTruthy(); await vi.advanceTimersByTimeAsync(5000); expect(readHeartbeatStatus(base).status).toBe("offline");
  rmSync(path.join(base, "data/.journal/orphan.json")); await vi.advanceTimersByTimeAsync(5000);
  expect(readHeartbeatStatus(base).status).toBe("online"); expect(readHeartbeatStatus(base).error).toBeUndefined();
  daemon.stop(); expect(readHeartbeatStatus(base).status).toBe("offline"); expect(existsSync(path.join(base, "data/.engine.lock"))).toBe(false);
  expect(process.listenerCount("SIGINT")).toBe(sigint); expect(process.listenerCount("SIGTERM")).toBe(sigterm);
});
it("derived-write failure preserves a committed Receipt and journal, reports error, then replays without a second mutation", () => {
  const base = fixture(); mkdirSync(path.join(base, "data/inbox")); mkdirSync(path.join(base, "data/mirror"));
  writeFileSync(path.join(base, "data/mirror/ledger.csv"), "id,date_submitted,company,role,req_url,channel,score,role_family,resume_version,employment_type,submission_status,evidence,stage,last_contact_date,recruiter,next_action,next_action_date,jd_snapshot_path,notes\n");
  writeFileSync(path.join(base, "data/daily.json"), "{broken");
  writeFileSync(path.join(base, "data/inbox/target.json"), JSON.stringify({ taskId: "target", event: "TARGET_SET", createdAt: "2026-11-06T12:00:00Z", payload: { date: "2026-11-06", target: 3 } }));
  expect(() => processInboxOnce(base, { nowMs: Date.now() + 2000 })).toThrow("corrupt");
  expect(readHeartbeatStatus(base).status).toBe("offline"); expect(readHeartbeatStatus(base).error).toContain("corrupt");
  const receipt = readFileSync(path.join(base, "data/receipts/target.json"), "utf8"); expect(JSON.parse(receipt).status).toBe("committed");
  expect(readFileSync(path.join(base, "data/daily.json"), "utf8")).toBe("{broken");
  const target = readFileSync(path.join(base, "data/daily-targets.json"), "utf8");
  writeFileSync(path.join(base, "data/daily.json"), JSON.stringify({ version: 1, updatedAt: "", days: {} }));
  expect(processInboxOnce(base, { nowMs: Date.now() + 2000, continuous: true })[0].outcome).toBe("duplicate");
  expect(readFileSync(path.join(base, "data/daily-targets.json"), "utf8")).toBe(target);
  expect(readFileSync(path.join(base, "data/receipts/target.json"), "utf8")).toBe(receipt);
  expect(readHeartbeatStatus(base).status).toBe("online");
});
