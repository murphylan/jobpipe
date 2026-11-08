import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyAgentActivity, applyAgentWaiting, applyDeletion, applyWaitingAnswer } from "./events4";
import type { GenericChangeSet } from "./events";

const temps: string[] = [];
afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

function fixture(): string {
  const base = mkdtempSync(path.join(tmpdir(), "engine-events4-"));
  temps.push(base);
  mkdirSync(path.join(base, "data", "inbox"), { recursive: true });
  writeFileSync(path.join(base, "data", "changelog.json"), JSON.stringify({ entries: [], version: 1, updatedAt: "2026-11-01T00:00:00Z" }));
  return base;
}

function activityCs(taskId: string, overrides: Record<string, unknown> = {}, evidence: GenericChangeSet["evidence"] = []): GenericChangeSet {
  return {
    taskId,
    event: "AGENT_ACTIVITY",
    createdAt: "2026-11-02T10:00:00Z",
    payload: { activityId: "act-001", kind: "screening", stage: "screening", title: "LinkedIn screening round", status: "running", ...overrides },
    evidence,
  };
}

function waitingCs(taskId: string, overrides: Record<string, unknown> = {}): GenericChangeSet {
  return {
    taskId,
    event: "AGENT_WAITING",
    createdAt: "2026-11-02T10:00:00Z",
    payload: { waitingId: "w-001", question: "Which option?", context: ["tried A"], ...overrides },
  };
}

function readJson(base: string, rel: string): { activities?: { activityId: string; status: string; stage?: string }[]; items?: { waitingId: string; status: string; kind?: string; answer?: string | null; answeredAt?: string | null }[]; entries?: { action: string }[]; version: number } {
  return JSON.parse(readFileSync(path.join(base, "data", rel), "utf-8"));
}

describe("engine stage 5 events (temp dirs only)", () => {
  it("AGENT_ACTIVITY running appends and bumps versions", () => {
    const base = fixture();
    const r = applyAgentActivity(base, activityCs("act-task-001"));
    expect(r.ok).toBe(true);
    const data = readJson(base, "activity.json");
    expect(data.activities).toHaveLength(1);
    expect(data.activities![0].status).toBe("running");
    expect(data.activities![0].stage).toBe("screening");
    expect(data.version).toBe(1);
    const changelog = readJson(base, "changelog.json");
    expect(changelog.entries).toHaveLength(1);
    expect(changelog.entries![0].action).toBe("agent-activity");
  });

  it("AGENT_ACTIVITY done without evidence is rejected and writes nothing", () => {
    const base = fixture();
    const r = applyAgentActivity(base, activityCs("act-task-002", { status: "done" }));
    expect(r.ok).toBe(false);
    expect(existsSync(path.join(base, "data", "activity.json"))).toBe(false);
  });

  it("AGENT_ACTIVITY done with evidence commits; same activityId appends a second entry", () => {
    const base = fixture();
    expect(applyAgentActivity(base, activityCs("act-task-003")).ok).toBe(true);
    const done = activityCs("act-task-004", { status: "done", finishedAt: "2026-11-02T11:00:00Z" }, [{ kind: "screen-record", text: "screen-2026-11-02.md" }]);
    expect(applyAgentActivity(base, done).ok).toBe(true);
    const data = JSON.parse(readFileSync(path.join(base, "data", "activity.json"), "utf-8"));
    expect(data.activities).toHaveLength(2);
    expect(data.activities[1].status).toBe("done");
    expect(data.activities[1].evidence).toEqual([{ kind: "screen-record", text: "screen-2026-11-02.md" }]);
    expect(data.version).toBe(2);
  });

  it("AGENT_ACTIVITY guards reject bad kind, stage, status, title, note, and unsafe id", () => {
    const base = fixture();
    expect(applyAgentActivity(base, activityCs("a1", { kind: "nope" })).ok).toBe(false);
    expect(applyAgentActivity(base, activityCs("a2", { stage: "nope" })).ok).toBe(false);
    expect(applyAgentActivity(base, activityCs("a3", { stage: undefined })).ok).toBe(false);
    expect(applyAgentActivity(base, activityCs("a4", { status: "nope" })).ok).toBe(false);
    expect(applyAgentActivity(base, activityCs("a5", { title: "  " })).ok).toBe(false);
    expect(applyAgentActivity(base, activityCs("a6", { note: "x".repeat(301) })).ok).toBe(false);
    expect(applyAgentActivity(base, activityCs("a7", { activityId: "../evil" })).ok).toBe(false);
    expect(existsSync(path.join(base, "data", "activity.json"))).toBe(false);
  });

  it("AGENT_WAITING appends an open item; a duplicate waitingId is rejected", () => {
    const base = fixture();
    expect(applyAgentWaiting(base, waitingCs("w-task-001")).ok).toBe(true);
    expect(applyAgentWaiting(base, waitingCs("w-task-002")).ok).toBe(false);
    const data = readJson(base, "waiting.json");
    expect(data.items).toHaveLength(1);
    expect(data.items![0].status).toBe("open");
    expect(data.items![0].kind).toBe("question");
  });

  it("applyWaitingAnswer flips open -> answered and records the answer", () => {
    const base = fixture();
    expect(applyAgentWaiting(base, waitingCs("w-task-003")).ok).toBe(true);
    const r = applyWaitingAnswer(base, "w-001", "answer", "Option B", "2026-11-02T12:00:00Z");
    expect(r.ok).toBe(true);
    const data = readJson(base, "waiting.json");
    expect(data.items![0].status).toBe("answered");
    expect(data.items![0].answer).toBe("Option B");
    expect(data.items![0].answeredAt).toBe("2026-11-02T12:00:00Z");
    expect(applyWaitingAnswer(base, "w-001", "answer", "again", "2026-11-02T13:00:00Z").ok).toBe(false);
  });

  it("applyWaitingAnswer guards: missing item, empty answer, bad action, park with no answer", () => {
    const base = fixture();
    expect(applyWaitingAnswer(base, "w-nope", "answer", "x", "2026-11-02T12:00:00Z").ok).toBe(false);
    expect(applyAgentWaiting(base, waitingCs("w-task-004")).ok).toBe(true);
    expect(applyWaitingAnswer(base, "w-001", "answer", "   ", "2026-11-02T12:00:00Z").ok).toBe(false);
    expect(applyWaitingAnswer(base, "w-001", "drop", "", "2026-11-02T12:00:00Z").ok).toBe(false);
    expect(applyWaitingAnswer(base, "w-001", "park", "", "2026-11-02T12:00:00Z").ok).toBe(true);
    const data = readJson(base, "waiting.json");
    expect(data.items![0].status).toBe("parked");
  });

  it("applyDeletion removes a done activity's entries and logs activity-deleted", () => {
    const base = fixture();
    expect(applyAgentActivity(base, activityCs("act-task-010")).ok).toBe(true);
    const done = activityCs("act-task-011", { status: "done" }, [{ kind: "screen-record", text: "s.md" }]);
    expect(applyAgentActivity(base, done).ok).toBe(true);
    const r = applyDeletion(base, "activity", "act-001", "2026-11-02T12:00:00Z");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.summary).toBe("ACTIVITY_DELETED act-001");
    expect(readJson(base, "activity.json").activities).toHaveLength(0);
    const changelog = readJson(base, "changelog.json");
    expect(changelog.entries![changelog.entries!.length - 1].action).toBe("activity-deleted");
  });

  it("applyDeletion guards: running activity, open waiting, missing target, bad scope/id", () => {
    const base = fixture();
    expect(applyAgentActivity(base, activityCs("act-task-020")).ok).toBe(true);
    expect(applyDeletion(base, "activity", "act-001", "2026-11-02T12:00:00Z").ok).toBe(false);
    expect(applyAgentWaiting(base, waitingCs("w-task-020")).ok).toBe(true);
    expect(applyDeletion(base, "waiting", "w-001", "2026-11-02T12:00:00Z").ok).toBe(false);
    expect(applyDeletion(base, "activity", "act-nope", "2026-11-02T12:00:00Z").ok).toBe(false);
    expect(applyDeletion(base, "nope", "act-001", "2026-11-02T12:00:00Z").ok).toBe(false);
    expect(applyDeletion(base, "activity", "../evil", "2026-11-02T12:00:00Z").ok).toBe(false);
    expect(readJson(base, "activity.json").activities).toHaveLength(1);
  });

  it("applyDeletion removes a waiting activity orphaned by a terminal job, but not one whose job is live", () => {
    const base = fixture();
    const job = (id: string, status: string, conclusion: string) => ({ id, company: "Example", role: "Engineer", channel: "test", location: "Remote", remote: "remote", salaryPosted: null, salaryAnswer: null, matchPoints: [], redFlags: [], conclusion, status });
    writeFileSync(path.join(base, "data", "jobs.json"), JSON.stringify({ jobs: [
      job("job-dropped", "dropped", "drop"),
      job("job-live", "approved", "apply"),
    ], version: 1, updatedAt: "2026-11-01T00:00:00Z" }));
    expect(applyAgentActivity(base, activityCs("act-task-040", { jobId: "job-dropped" })).ok).toBe(true);
    expect(applyAgentActivity(base, activityCs("act-task-041", { jobId: "job-dropped", status: "waiting" })).ok).toBe(true);
    const r = applyDeletion(base, "activity", "act-001", "2026-11-02T12:00:00Z");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.summary).toBe("ACTIVITY_DELETED act-001");
    expect(readJson(base, "activity.json").activities).toHaveLength(0);
    const changelog = readJson(base, "changelog.json");
    expect(changelog.entries![changelog.entries!.length - 1].action).toBe("activity-deleted");
    expect(applyAgentActivity(base, activityCs("act-task-042", { activityId: "act-002", jobId: "job-live", status: "waiting" })).ok).toBe(true);
    expect(applyDeletion(base, "activity", "act-002", "2026-11-02T12:30:00Z").ok).toBe(false);
    expect(readJson(base, "activity.json").activities).toHaveLength(1);
  });

  it("applyDeletion removes an answered waiting item and logs waiting-deleted", () => {
    const base = fixture();
    expect(applyAgentWaiting(base, waitingCs("w-task-030")).ok).toBe(true);
    expect(applyWaitingAnswer(base, "w-001", "answer", "Option B", "2026-11-02T12:00:00Z").ok).toBe(true);
    const r = applyDeletion(base, "waiting", "w-001", "2026-11-02T13:00:00Z");
    expect(r.ok).toBe(true);
    expect(readJson(base, "waiting.json").items).toHaveLength(0);
    const changelog = readJson(base, "changelog.json");
    expect(changelog.entries![changelog.entries!.length - 1].action).toBe("waiting-deleted");
  });
});

it("persists explicit batch scope and inherits it across activity updates", () => {
  const base = fixture();
  expect(applyAgentActivity(base, activityCs("batch-start", { scope: "batch" })).ok).toBe(true);
  expect(applyAgentActivity(base, activityCs("batch-progress", { note: "Next step" })).ok).toBe(true);
  const rows = JSON.parse(readFileSync(path.join(base, "data/activity.json"), "utf8")).activities;
  expect(rows.map((row: { scope: string }) => row.scope)).toEqual(["batch", "batch"]);
  expect(applyAgentActivity(base, activityCs("batch-change", { scope: "job", jobId: "other" })).ok).toBe(false);
});
it("rejects contradictory scopes and prevents batch scope from bypassing per-job application tracking", () => {
  const base = fixture();
  for (const payload of [{ scope: "unknown" }, { scope: "job" }, { scope: "batch", jobId: "j" }, { scope: "batch", stage: "apply", kind: "applying" }]) {
    expect(applyAgentActivity(base, activityCs("invalid-scope", payload)).ok).toBe(false);
  }
});
