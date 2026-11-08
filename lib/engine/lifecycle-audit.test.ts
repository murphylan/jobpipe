// Batch 1 characterization only: these assertions reproduce current defects,
// not the acceptance contract. Replace them with corrected expectations in
// the owning repair batch; all mutations stay in disposable fixtures.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { POST as knowledgePost } from "../../app/api/knowledge/route";
import { loadFullSnapshotData } from "../datafiles";
import { listActivity } from "./console";
import { applyAgentActivity } from "./events4";
import { readHeartbeatStatus } from "./heartbeat";
import { processMuseLiveInboxOnce } from "./muse-live";

const dirs: string[] = [];
const previousBase = process.env.PIPELINE_DIR;
afterEach(() => {
  if (previousBase === undefined) delete process.env.PIPELINE_DIR;
  else process.env.PIPELINE_DIR = previousBase;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const base = mkdtempSync(path.join(tmpdir(), "jobpipe-lifecycle-audit-"));
  dirs.push(base);
  mkdirSync(path.join(base, "data/inbox/muse-live"), { recursive: true });
  return base;
}
function write(base: string, file: string, value: unknown) {
  writeFileSync(path.join(base, "data", file), JSON.stringify(value));
}
function activity(base: string, taskId: string, status: string, extra = {}) {
  return applyAgentActivity(base, {
    taskId, event: "AGENT_ACTIVITY", createdAt: "2026-11-05T10:00:00Z",
    payload: { activityId: "a", kind: "applying", stage: "apply", title: "Audit fixture", status, ...extra },
    evidence: [{ kind: "browser-report", text: "fixture evidence" }],
  });
}
describe("Batch 1 findings (Batch 2 repaired assertions; remaining defects explicitly named)", () => {
  it("A01 repaired: activity rejects a nonexistent business receipt", () => {
    const base = fixture();
    expect(activity(base, "done", "done", { refs: ["nonexistent"], jobId: "job-a" }).ok).toBe(false);
    expect(existsSync(path.join(base, "data/activity.json"))).toBe(false);
  });
  it("A02 repaired: a late running event cannot resurrect a completed activity", () => {
    const base = fixture();
    expect(activity(base, "done", "done", { stage: "screening" }).ok).toBe(true);
    expect(activity(base, "late-running", "running").ok).toBe(false);
    expect(listActivity(base)[0].status).toBe("done");
  });
  it("A03 repaired: failed promotion preserves staging", () => {
    const base = fixture();
    const file = path.join(base, "data/inbox/muse-live/job-a.json");
    write(base, "inbox/muse-live/job-a.json", { jobId: "job-a", state: "working" });
    utimesSync(file, new Date(0), new Date(0));
    // A directory at the temp destination deterministically injects a write failure.
    mkdirSync(path.join(base, "data/muse-live.json.tmp"));
    expect(() => processMuseLiveInboxOnce(base)).toThrow();
    expect(existsSync(file)).toBe(true);
    expect(existsSync(path.join(base, "data/muse-live.json"))).toBe(false);
  });
  it("A04 repaired: malformed staging is quarantined with a diagnostic", () => {
    const base = fixture();
    const file = path.join(base, "data/inbox/muse-live/bad.json");
    write(base, "inbox/muse-live/bad.json", null);
    // Use invalid JSON rather than null (null currently throws before quarantine).
    writeFileSync(file, "{");
    utimesSync(file, new Date(0), new Date(0));
    expect(processMuseLiveInboxOnce(base)).toEqual([]);
    expect(existsSync(file)).toBe(false);
    expect(readdirSync(path.join(base, "data/rejected/muse-live"))).toHaveLength(2);
  });
  it("A05 repaired: stale Today signals project interrupted without fabricating Activity", () => {
    const base = fixture();
    write(base, "muse-live.json", { version: 1, updatedAt: "2000-01-01T00:00:00Z", live: {
      "job-a": { state: "working", detail: "old", updatedAt: "2000-01-01T00:00:00Z" },
    } });
    write(base, "jobs.json", { version: 1, updatedAt: "", jobs: [{ id: "job-a", company: "Fixture", role: "Engineer", status: "approved" }] });
    expect(loadFullSnapshotData(base).taskState.tasks[0].runtime.status).toBe("interrupted");
    expect(listActivity(base)).toEqual([]);
  });
  it("A06 repaired: knowledge POST only queues an inbox event", async () => {
    const base = fixture();
    process.env.PIPELINE_DIR = base;
    const res = await knowledgePost(new Request("http://fixture/api/knowledge", {
      method: "POST", body: JSON.stringify({ title: "Fixture", body: "Audit only" }),
    }));
    expect(res.status).toBe(202);
    expect(existsSync(path.join(base, "data/knowledge.json"))).toBe(false);
    expect(readdirSync(path.join(base, "data/inbox")).filter(f => f.endsWith(".json"))).toHaveLength(1);
    expect(existsSync(path.join(base, "data/receipts"))).toBe(false);
  });
  it("A07 repaired: snapshot reports missing applications without sample mixing", () => {
    const base = fixture();
    mkdirSync(path.join(base, "data/sample"));
    write(base, "jobs.json", { version: 1, updatedAt: "", jobs: [] });
    write(base, "sample/applications.json", { version: 1, updatedAt: "", applications: [{ id: "sample-app" }] });
    const snapshot = loadFullSnapshotData(base);
    expect(snapshot.jobsSource).toBe("real");
    expect(snapshot.applications.applications).toEqual([]);
    expect(snapshot.applicationsSource).toBe("missing");
  });
  it("A08 repaired: invalid heartbeat timestamps are offline", () => {
    const base = fixture();
    mkdirSync(path.join(base, "data/engine"));
    write(base, "engine/heartbeat.json", { updatedAt: "invalid", status: "running", pid: 1 });
    expect(readHeartbeatStatus(base).status).toBe("offline");
  });
});
