import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ACTIVITY_LEASE_MS, LEGACY_ACTIVITY_LEASE_MS } from "./activity-lifecycle";
import { listActivity, queryActivityFeed } from "./console";
import { processInboxOnce } from "./daemon";
import { applyAgentActivity } from "./events4";
import { writeReceipt } from "./receipt";
import { GET as activityGet } from "../../app/api/activity/route";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "jobpipe-lifecycle-"));
  dirs.push(dir);
  mkdirSync(path.join(dir, "data/inbox"), { recursive: true });
  return dir;
}
const epoch = Date.parse("2026-11-06T00:00:00Z");
function cs(taskId: string, extra = {}, seconds = 0) {
  return { taskId, event: "AGENT_ACTIVITY", createdAt: new Date(epoch + seconds * 1000).toISOString(),
    payload: { activityId: "activity", kind: "screening", stage: "screening", title: "Fixture", status: "running", ...extra },
    evidence: [{ kind: "screen-record", text: "fixture evidence" }] };
}
const stored = (dir: string) => readFileSync(path.join(dir, "data/activity.json"), "utf8");

describe("Activity runtime lifecycle (isolated fixtures)", () => {
  it("shows the start via daemon and API; duplicate inbox does not append again", async () => {
    const dir = fixture();
    const event = { ...cs("start"), createdAt: new Date().toISOString() };
    const file = path.join(dir, "data/inbox/start.json");
    const submit = () => { writeFileSync(file, JSON.stringify(event)); utimesSync(file, new Date(0), new Date(0)); };
    submit();
    expect(processInboxOnce(dir)[0].outcome).toBe("committed");
    const before = stored(dir);
    expect(queryActivityFeed(dir, {}).running).toHaveLength(1);
    const previousBase = process.env.PIPELINE_DIR;
    try {
      process.env.PIPELINE_DIR = dir;
      const response = await activityGet(new Request("http://fixture/api/activity?status=running"));
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect((await response.json()).activities[0].activityId).toBe("activity");
    } finally {
      if (previousBase === undefined) delete process.env.PIPELINE_DIR;
      else process.env.PIPELINE_DIR = previousBase;
    }
    submit();
    expect(processInboxOnce(dir)[0].outcome).toBe("duplicate");
    expect(stored(dir)).toBe(before);
  });
  it("expires a running signal without changing business files, and renews its lease", () => {
    const dir = fixture();
    expect(applyAgentActivity(dir, cs("start", { runId: "r1", sequence: 1 })).ok).toBe(true);
    const before = stored(dir);
    expect(listActivity(dir, epoch + ACTIVITY_LEASE_MS)[0]).toMatchObject({ status: "interrupted", recordedStatus: "running" });
    const query = queryActivityFeed(dir, { nowMs: epoch + ACTIVITY_LEASE_MS, status: "interrupted" });
    expect(query.activities).toHaveLength(1);
    expect(query.running).toEqual([]);
    expect(query.distribution.interrupted).toBe(1);
    expect(stored(dir)).toBe(before);
    expect(applyAgentActivity(dir, cs("heartbeat", { runId: "r1", sequence: 2 }, 301)).ok).toBe(true);
    expect(listActivity(dir, epoch + 302000)[0].status).toBe("running");
    expect(listActivity(dir, epoch + 302000)[0].startedAt).toBe(cs("start").createdAt);
  });
  it("leaves waiting open across expiration and restart; only an actual event resumes running", () => {
    const dir = fixture();
    expect(applyAgentActivity(dir, cs("wait", { status: "waiting", runId: "r1", sequence: 1 })).ok).toBe(true);
    expect(listActivity(dir, epoch + 86400000)[0].status).toBe("waiting");
    expect(applyAgentActivity(dir, cs("resume", { runId: "r1", sequence: 2 }, 100)).ok).toBe(true);
    expect(listActivity(dir, epoch + 101000)[0].status).toBe("running");
  });
  it.each(["done", "failed"])("closes %s, preserves start, and supplies a finish timestamp", (status) => {
    const dir = fixture();
    expect(applyAgentActivity(dir, cs("start")).ok).toBe(true);
    expect(applyAgentActivity(dir, cs("finish", { status }, 10)).ok).toBe(true);
    const row = listActivity(dir, epoch + 11000)[0];
    expect(row).toMatchObject({ status, startedAt: cs("start").createdAt, finishedAt: cs("finish", {}, 10).createdAt });
    const before = stored(dir);
    expect(applyAgentActivity(dir, cs("late", {}, 11)).ok).toBe(false);
    expect(stored(dir)).toBe(before);
  });
  it("isolates explicit retries from retired sessions, including late done events", () => {
    const dir = fixture();
    expect(applyAgentActivity(dir, cs("start", { runId: "r1", sequence: 1 })).ok).toBe(true);
    expect(applyAgentActivity(dir, cs("fail", { status: "failed", runId: "r1", sequence: 2 }, 10)).ok).toBe(true);
    expect(applyAgentActivity(dir, cs("bad-retry", { runId: "r2", sequence: 1 }, 20)).ok).toBe(false);
    expect(applyAgentActivity(dir, cs("retry", { runId: "r2", sequence: 1, restartOf: "r1" }, 20)).ok).toBe(true);
    expect(applyAgentActivity(dir, cs("late-done", { status: "done", runId: "r1", sequence: 3 }, 30)).ok).toBe(false);
    expect(applyAgentActivity(dir, cs("reuse", { runId: "r1", sequence: 4, restartOf: "r2" }, 40)).ok).toBe(false);
    expect(listActivity(dir, epoch + 21000)[0]).toMatchObject({ runId: "r2", status: "running" });
    expect(JSON.parse(stored(dir)).activities).toHaveLength(3);
  });
  it("rejects out-of-order sequence and timestamps without appending", () => {
    const dir = fixture();
    expect(applyAgentActivity(dir, cs("s", { runId: "r1", sequence: 2 }, 10)).ok).toBe(true);
    const before = stored(dir);
    for (const event of [cs("old", { runId: "r1", sequence: 3 }, 9), cs("seq", { runId: "r1", sequence: 1 }, 11), cs("eq", { runId: "r1", sequence: 2 }, 12)]) {
      expect(applyAgentActivity(dir, event).ok).toBe(false);
      expect(stored(dir)).toBe(before);
    }
  });
  it("supports explicit restart of a legacy run without rewriting it", () => {
    const dir = fixture();
    expect(applyAgentActivity(dir, cs("legacy", { status: "failed" })).ok).toBe(true);
    expect(applyAgentActivity(dir, cs("new", { runId: "r2", sequence: 1, restartOf: "legacy" }, 20)).ok).toBe(true);
    expect(JSON.parse(stored(dir)).activities[0]).not.toHaveProperty("runId");
  });
  it("projects stale legacy running as interrupted even after engine restart, without persisting it", () => {
    const dir = fixture();
    writeFileSync(path.join(dir, "data/activity.json"), JSON.stringify({ version: 1, updatedAt: cs("old").createdAt,
      activities: [{ ...cs("old").payload, taskId: "old", createdAt: cs("old").createdAt, startedAt: cs("old").createdAt, finishedAt: null, refs: [], note: "" }] }));
    const before = stored(dir);
    expect(listActivity(dir, epoch + LEGACY_ACTIVITY_LEASE_MS)[0].status).toBe("interrupted");
    expect(listActivity(dir, epoch + LEGACY_ACTIVITY_LEASE_MS + 1)[0].status).toBe("interrupted");
    expect(stored(dir)).toBe(before);
  });
  it.each(["nonexistent", "rejected", "pending-approval", "AGENT_ACTIVITY", "verified", "committed"])("rejects receipt without matching business records: %s", (variant) => {
    const dir = fixture();
    if (variant !== "nonexistent") writeReceipt(dir, { taskId: "receipt", event: variant === "AGENT_ACTIVITY" ? variant : "APPLICATION_SUBMITTED",
      status: variant === "AGENT_ACTIVITY" ? "committed" : variant as "rejected" | "pending-approval" | "verified" | "committed", createdAt: cs("x").createdAt, summary: "fixture" });
    expect(applyAgentActivity(dir, cs("done", { stage: "apply", status: "done", refs: ["receipt"] })).ok)
      .toBe(false);
  });
  it("rejects invalid runtime metadata before creating activity", () => {
    const dir = fixture();
    for (const extra of [{ runId: "r" }, { runId: "../x", sequence: 1 }, { sequence: 1 }, { runId: "r", sequence: -1 },
      { startedAt: "bad" }, { finishedAt: "bad" }, { leaseExpiresAt: new Date(epoch + ACTIVITY_LEASE_MS + 1).toISOString() }])
      expect(applyAgentActivity(dir, cs("bad", extra)).ok).toBe(false);
    expect(existsSync(path.join(dir, "data/activity.json"))).toBe(false);
  });
  it("keeps compatibility with explicit null finishedAt in existing clients", () => {
    const dir = fixture();
    expect(applyAgentActivity(dir, cs("start", { finishedAt: null })).ok).toBe(true);
    expect(applyAgentActivity(dir, cs("finish", { status: "done", finishedAt: null }, 10)).ok).toBe(true);
    expect(listActivity(dir, epoch + 11000)[0].finishedAt).toBe(cs("finish", {}, 10).createdAt);
  });
});
