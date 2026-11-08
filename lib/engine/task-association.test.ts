import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readTaskState } from "./task-state";
import { listActivity, queryActivityFeed } from "./console";
import { applyAgentActivity, applyAgentWaiting, applyWaitingAnswer } from "./events4";
import { hasApplicationProof } from "./application-proof";
import { writeReceipt } from "./receipt";
import { loadFullSnapshotData } from "../datafiles";
import { pendingTasks } from "../task-state";
import { chicagoToday } from "../ledger";
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const now = Date.parse("2026-11-06T10:00:00Z");
const stamp = new Date(now).toISOString();
function write(base: string, name: string, value: unknown) { writeFileSync(path.join(base, "data", name), JSON.stringify(value)); }
function job(id = "j", status = "approved") { return { id, status, company: "Fixture", role: "Engineer", channel: "Indeed", location: "Remote", remote: "remote", salaryPosted: null, salaryAnswer: null, matchPoints: [], redFlags: [], conclusion: "apply" }; }
function setup() {
  const base = mkdtempSync(path.join(tmpdir(), "jobpipe-association-")); dirs.push(base);
  mkdirSync(path.join(base, "data/mirror"), { recursive: true });
  write(base, "jobs.json", { version: 1, updatedAt: stamp, jobs: [job()] });
  write(base, "applications.json", { version: 1, updatedAt: stamp, applications: [] });
  write(base, "resume-versions.json", { version: 1, updatedAt: stamp, versions: [], selected: {} });
  return base;
}
function cs(taskId: string, overrides = {}, offset = 0) {
  return { taskId, event: "AGENT_ACTIVITY", createdAt: new Date(now + offset).toISOString(), payload: { activityId: "act", jobId: "j", kind: "applying", stage: "apply", title: "Fixture", status: "running", ...overrides }, evidence: [{ kind: "screen-record", text: "fixture" }] };
}
function proof(base: string) {
  const app = { id: "app", jobId: "j", ledgerRowId: "1", resumeVersion: "v1", source: "Indeed", collectedAt: stamp, appliedAt: stamp, employerConfirmed: true, stage: "applied", nextAction: null, nextActionDue: null, interviewAt: null, notes: "", version: 1, updatedAt: stamp };
  write(base, "jobs.json", { version: 2, updatedAt: stamp, jobs: [job("j", "applied")] });
  write(base, "applications.json", { version: 2, updatedAt: stamp, applications: [app] });
  writeFileSync(path.join(base, "data/mirror/ledger.csv"), `id,date_submitted,company,role,req_url,channel,score,role_family,resume_version,employment_type,submission_status,evidence,stage,last_contact_date,recruiter,next_action,next_action_date,jd_snapshot_path,notes\n1,${chicagoToday(new Date(stamp))},Fixture,Engineer,,Indeed,,,v1,,confirmed,proof,applied,,,,,,\n`);
  writeReceipt(base, { taskId: "submission", event: "APPLICATION_SUBMITTED", status: "committed", createdAt: stamp, summary: "fixture", ops: { jobId: "j", applicationId: "app", ledgerId: 1 } });
  return app;
}
describe("Today / Activity association and business proof", () => {
  it("exposes real pending work without inventing any activity event", () => {
    const base = setup();
    const today = loadFullSnapshotData(base).taskState;
    const activity = queryActivityFeed(base, { nowMs: now });
    expect(today.tasks[0].businessStage).toBe("tailoring");
    expect(pendingTasks(today.tasks)).toEqual(activity.tasks);
    expect(activity.activities).toEqual([]);
    expect(activity.tasks[0].runtime.status).toBe("idle");
    expect(activity.tasks[0].href).toBe("/jobs-applications?jobId=j");
  });
  it("shares tailored readiness and keeps actual business stage separate from running stage", () => {
    const base = setup();
    write(base, "resume-versions.json", { version: 1, updatedAt: stamp, versions: [{ version: "v1", jobId: "j", file: "test.pdf", createdAt: stamp, note: "" }], selected: {} });
    expect(applyAgentActivity(base, cs("start")).ok).toBe(true);
    expect(listActivity(base, now)[0]).toMatchObject({ jobId: "j", businessStage: "apply", status: "running" });
    expect(readTaskState(base, now).tasks[0]).toMatchObject({ businessStage: "apply", runtime: { status: "running", source: "activity" } });
  });
  it("never reassigns an existing activity to another job", () => {
    const base = setup(); expect(applyAgentActivity(base, cs("start")).ok).toBe(true);
    expect(applyAgentActivity(base, cs("move", { jobId: "different" }, 1000)).ok).toBe(false);
  });
  it("keeps user answers waiting until a real running event arrives", () => {
    const base = setup(); expect(applyAgentActivity(base, cs("start")).ok).toBe(true);
    expect(applyAgentWaiting(base, { taskId: "question", event: "AGENT_WAITING", createdAt: stamp, payload: { waitingId: "w", sourceActivityId: "act", question: "Approve?" } }).ok).toBe(true);
    expect(listActivity(base, now)[0].status).toBe("waiting");
    expect(applyWaitingAnswer(base, "w", "answer", "yes", new Date(now + 2000).toISOString()).ok).toBe(true);
    expect(readTaskState(base, now + 3000).tasks[0].runtime).toMatchObject({ status: "waiting", detail: "已答复，等待 Agent 续跑信号" });
    expect(listActivity(base, now + 3000)[0].status).toBe("waiting");
    expect(applyAgentActivity(base, cs("resume", {}, 4000)).ok).toBe(true);
    expect(readTaskState(base, now + 5000).tasks[0].runtime.status).toBe("running");
  });
  it("does not use a stale legacy working badge to claim current work", () => {
    const base = setup();
    write(base, "muse-live.json", { version: 1, updatedAt: "2000-01-01T00:00:00Z", live: { j: { state: "working", detail: "old", updatedAt: "2000-01-01T00:00:00Z" } } });
    expect(readTaskState(base, now).tasks[0].runtime).toMatchObject({ status: "interrupted", source: "live-signal" });
    expect(listActivity(base, now)).toEqual([]);
  });
  it("labels historical activity as unlinked, preserving original bytes", () => {
    const base = setup(); const event = cs("generic", { jobId: undefined, stage: "screening" });
    expect(applyAgentActivity(base, event).ok).toBe(true);
    const before = readFileSync(path.join(base, "data/activity.json"), "utf8");
    expect(listActivity(base, now)[0].businessStage).toBeNull();
    expect(readFileSync(path.join(base, "data/activity.json"), "utf8")).toBe(before);
  });
  it("accepts completed submission only with matching job, application, receipt and confirmed ledger", () => {
    const base = setup(); proof(base);
    expect(hasApplicationProof(base, "j", ["submission"])).toBe(true);
    expect(applyAgentActivity(base, cs("finish", { status: "done", refs: ["submission"] })).ok).toBe(true);
    expect(listActivity(base, now)[0]).toMatchObject({ status: "done", jobId: "j", businessStage: "confirmed" });
  });
  it("accepts historical date-only appliedAt as a Chicago calendar day", () => {
    const base = setup(); const app = proof(base);
    app.appliedAt = chicagoToday(new Date(stamp));
    write(base, "applications.json", { version: 2, updatedAt: stamp, applications: [app] });
    expect(hasApplicationProof(base, "j", ["submission"])).toBe(true);
  });
  it("retains a submitted application with missing confirmed ledger as review work", () => {
    const base = setup(); proof(base);
    writeFileSync(path.join(base, "data/mirror/ledger.csv"), "");
    expect(readTaskState(base, now).tasks[0]).toMatchObject({ businessStage: "review", unfinished: true });
    expect(queryActivityFeed(base, { nowMs: now }).tasks).toHaveLength(1);
  });
  it("reports malformed input without throwing or introducing sample work", () => {
    const base = setup();
    write(base, "jobs.json", { jobs: [null] });
    write(base, "muse-live.json", null);
    mkdirSync(path.join(base, "data/sample"));
    write(base, "sample/jobs.json", { jobs: [job("sample")] });
    const state = readTaskState(base, now);
    expect(state.tasks).toEqual([]);
    expect(state.issues).toHaveLength(2);
  });
  it.each(["wrong-job", "wrong-row", "unconfirmed", "missing-app", "missing-ledger", "wrong-resume"])("rejects inconsistent proof: %s", (scenario) => {
    const base = setup(); const app = proof(base);
    if (scenario === "wrong-job") app.jobId = "other";
    if (scenario === "wrong-row") app.ledgerRowId = "2";
    if (scenario === "unconfirmed") app.employerConfirmed = false;
    if (scenario === "wrong-resume") app.resumeVersion = "wrong";
    write(base, "applications.json", { version: 2, updatedAt: stamp, applications: scenario === "missing-app" ? [] : [app] });
    if (scenario === "missing-ledger") writeFileSync(path.join(base, "data/mirror/ledger.csv"), "");
    expect(hasApplicationProof(base, "j", ["submission"])).toBe(false);
    expect(applyAgentActivity(base, cs("finish", { status: "done", refs: ["submission"] })).ok).toBe(false);
  });
});
