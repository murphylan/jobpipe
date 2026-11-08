import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listActivity, listWaiting, queryActivityFeed, writeDeletion, writeWaitingAnswer } from "./console";

const temps: string[] = [];
afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

function fixture(): string {
  const base = mkdtempSync(path.join(tmpdir(), "engine-activity-console-"));
  temps.push(base);
  mkdirSync(path.join(base, "data", "inbox", "decisions"), { recursive: true });
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const activity = (activityId: string, kind: string, stage: string | undefined, status: string, createdAt: string) => ({
    activityId, kind, ...(stage === undefined ? {} : { stage }), title: `title ${activityId} ${status}`, status, startedAt: createdAt, finishedAt: null, refs: [], note: "", taskId: "t", createdAt,
  });
  writeFileSync(path.join(base, "data", "activity.json"), JSON.stringify({
    activities: [
      activity("a-old", "screening", "screening", "running", iso(now - 2 * 3600e3)),
      activity("a-old", "screening", "screening", "done", iso(now - 3600e3)),
      activity("a-new", "applying", "apply", "running", iso(now)),
      activity("a-legacy", "screening", undefined, "done", iso(now - 3 * 3600e3)),
    ],
    version: 4, updatedAt: iso(now),
  }));
  const item = (waitingId: string, status: string, createdAt: string, sourceActivityId: string | null) => ({
    waitingId, question: `question ${waitingId}`, context: [], kind: "question", status, createdAt, sourceActivityId, answer: null, answeredAt: null, taskId: "t",
  });
  writeFileSync(path.join(base, "data", "waiting.json"), JSON.stringify({
    items: [
      item("w-old-open", "open", "2026-11-02T09:00:00Z", null),
      item("w-answered", "answered", "2026-11-02T12:00:00Z", null),
      item("w-new-open", "open", "2026-11-02T11:00:00Z", "a-new"),
    ],
    version: 3, updatedAt: "2026-11-02T12:00:00Z",
  }));
  return base;
}

describe("activity console readers and waiting-answer write (temp dirs only)", () => {
  it("listActivity takes the latest entry per activityId, newest first, and normalizes missing stage to null", () => {
    const base = fixture();
    const list = listActivity(base);
    expect(list.map((a) => a.activityId)).toEqual(["a-new", "a-old", "a-legacy"]);
    expect(list.find((a) => a.activityId === "a-old")!.status).toBe("done");
    expect(list.find((a) => a.activityId === "a-old")!.stage).toBe("screening");
    expect(list.find((a) => a.activityId === "a-legacy")!.stage).toBe(null);
  });

  it("listWaiting puts open first, newest first within each status, and enriches source stage", () => {
    const base = fixture();
    const list = listWaiting(base);
    expect(list.map((i) => i.waitingId)).toEqual(["w-new-open", "w-old-open", "w-answered"]);
    expect(list.find((i) => i.waitingId === "w-new-open")!.sourceStage).toBe("apply");
    expect(list.find((i) => i.waitingId === "w-old-open")!.sourceStage).toBe(null);
  });

  it("missing files yield empty lists, never a throw", () => {
    const base = mkdtempSync(path.join(tmpdir(), "engine-activity-console-empty-"));
    temps.push(base);
    expect(listActivity(base)).toEqual([]);
    expect(listWaiting(base)).toEqual([]);
    expect(queryActivityFeed(base, {}).total).toBe(0);
  });

  it("queryActivityFeed filters by stage (legacy entries resolve through the kind mapping)", () => {
    const base = fixture();
    expect(queryActivityFeed(base, { stage: "apply" }).activities.map((a) => a.activityId)).toEqual(["a-new"]);
    expect(queryActivityFeed(base, { stage: "screening" }).activities.map((a) => a.activityId)).toEqual(["a-old", "a-legacy"]);
    expect(queryActivityFeed(base, { stage: "nope" }).total).toBe(3);
  });

  it("queryActivityFeed filters by status and sorts by status and kind", () => {
    const base = fixture();
    expect(queryActivityFeed(base, { status: "running" }).activities.map((a) => a.activityId)).toEqual(["a-new"]);
    expect(queryActivityFeed(base, { status: "done" }).activities.map((a) => a.activityId)).toEqual(["a-old", "a-legacy"]);
    expect(queryActivityFeed(base, { sort: "status" }).activities.map((a) => a.activityId)).toEqual(["a-new", "a-old", "a-legacy"]);
    expect(queryActivityFeed(base, { sort: "kind" }).activities.map((a) => a.activityId)).toEqual(["a-new", "a-old", "a-legacy"]);
    expect(queryActivityFeed(base, { sort: "created-asc" }).activities.map((a) => a.activityId)).toEqual(["a-legacy", "a-old", "a-new"]);
  });

  it("queryActivityFeed pages and counts distribution over the full stage-filtered list", () => {
    const base = fixture();
    const page = queryActivityFeed(base, { page: 1, pageSize: 2 });
    expect(page.activities).toHaveLength(2);
    expect(page.total).toBe(3);
    expect(page.distribution).toEqual({ running: 1, waiting: 0, done: 2, failed: 0, interrupted: 0 });
    const staged = queryActivityFeed(base, { stage: "screening" });
    expect(staged.distribution).toEqual({ running: 0, waiting: 0, done: 2, failed: 0, interrupted: 0 });
    expect(staged.total).toBe(2);
  });

  it("queryActivityFeed overview counts the dynamic entry as today and all open waiting items", () => {
    const base = fixture();
    const q = queryActivityFeed(base, {});
    expect(q.overview.openWaiting).toBe(2);
    expect(q.overview.totalToday).toBeGreaterThanOrEqual(1);
    expect(q.overview.runningToday).toBeGreaterThanOrEqual(1);
    expect(q.stageCounts.apply).toBeGreaterThanOrEqual(1);
  });

  it("writeWaitingAnswer guards reject traversal, bad action, missing, closed, duplicate, empty answer", () => {
    const base = fixture();
    expect(writeWaitingAnswer(base, { waitingId: "../evil", action: "answer", answer: "x" }).ok).toBe(false);
    expect(writeWaitingAnswer(base, { waitingId: "w-new-open", action: "drop", answer: "" }).ok).toBe(false);
    expect(writeWaitingAnswer(base, { waitingId: "w-nope", action: "answer", answer: "x" }).ok).toBe(false);
    expect(writeWaitingAnswer(base, { waitingId: "w-answered", action: "answer", answer: "x" }).ok).toBe(false);
    expect(writeWaitingAnswer(base, { waitingId: "w-new-open", action: "answer", answer: "   " }).ok).toBe(false);
    writeFileSync(path.join(base, "data", "inbox", "decisions", "decision-waiting-w-old-open.json"), "{}");
    expect(writeWaitingAnswer(base, { waitingId: "w-old-open", action: "answer", answer: "x" }).ok).toBe(false);
    expect(existsSync(path.join(base, "data", "waiting.json"))).toBe(true);
  });

  it("writeWaitingAnswer writes a decision file and nothing else", () => {
    const base = fixture();
    const r = writeWaitingAnswer(base, { waitingId: "w-new-open", action: "answer", answer: "Option B" });
    expect(r).toEqual({ ok: true, waitingId: "w-new-open" });
    const dest = path.join(base, "data", "inbox", "decisions", "decision-waiting-w-new-open.json");
    expect(existsSync(dest)).toBe(true);
    const body = JSON.parse(readFileSync(dest, "utf-8"));
    expect(body.waitingId).toBe("w-new-open");
    expect(body.action).toBe("answer");
    expect(body.answer).toBe("Option B");
    expect(typeof body.decidedAt).toBe("string");
    const items = JSON.parse(readFileSync(path.join(base, "data", "waiting.json"), "utf-8")).items;
    expect(items.find((i: { waitingId: string }) => i.waitingId === "w-new-open").status).toBe("open");
  });

  it("writeDeletion guards reject bad scope, traversal, missing, unfinished, unclosed, duplicate", () => {
    const base = fixture();
    expect(writeDeletion(base, { scope: "nope", id: "a-old" }).ok).toBe(false);
    expect(writeDeletion(base, { scope: "activity", id: "../evil" }).ok).toBe(false);
    expect(writeDeletion(base, { scope: "activity", id: "a-nope" }).ok).toBe(false);
    expect(writeDeletion(base, { scope: "activity", id: "a-new" }).ok).toBe(false);
    expect(writeDeletion(base, { scope: "waiting", id: "w-new-open" }).ok).toBe(false);
    writeFileSync(path.join(base, "data", "inbox", "decisions", "decision-delete-activity-a-old.json"), "{}");
    expect(writeDeletion(base, { scope: "activity", id: "a-old" }).ok).toBe(false);
    expect(JSON.parse(readFileSync(path.join(base, "data", "activity.json"), "utf-8")).activities).toHaveLength(4);
  });

  it("writeDeletion writes a decision file and nothing else", () => {
    const base = fixture();
    const r = writeDeletion(base, { scope: "activity", id: "a-old" });
    expect(r).toEqual({ ok: true, scope: "activity", id: "a-old" });
    const dest = path.join(base, "data", "inbox", "decisions", "decision-delete-activity-a-old.json");
    expect(existsSync(dest)).toBe(true);
    const body = JSON.parse(readFileSync(dest, "utf-8"));
    expect(body.scope).toBe("activity");
    expect(body.id).toBe("a-old");
    expect(typeof body.decidedAt).toBe("string");
    expect(JSON.parse(readFileSync(path.join(base, "data", "activity.json"), "utf-8")).activities).toHaveLength(4);
    const rw = writeDeletion(base, { scope: "waiting", id: "w-answered" });
    expect(rw.ok).toBe(true);
    expect(JSON.parse(readFileSync(path.join(base, "data", "waiting.json"), "utf-8")).items).toHaveLength(3);
  });

  it("writeDeletion allows a waiting activity orphaned by a terminal job, still rejects a live-job one", () => {
    const base = fixture();
    const actPath = path.join(base, "data", "activity.json");
    const data = JSON.parse(readFileSync(actPath, "utf-8"));
    const now = new Date().toISOString();
    const extra = (activityId: string, jobId: string) => ({ activityId, kind: "applying", stage: "apply", title: `title ${activityId}`, status: "waiting", jobId, startedAt: now, finishedAt: null, refs: [], note: "", taskId: "t", createdAt: now });
    data.activities.push(extra("a-orphan", "job-dropped"), extra("a-live", "job-live"));
    writeFileSync(actPath, JSON.stringify(data));
    const job = (id: string, status: string, conclusion: string) => ({ id, company: "Example", role: "Engineer", channel: "test", location: "Remote", remote: "remote", salaryPosted: null, salaryAnswer: null, matchPoints: [], redFlags: [], conclusion, status });
    writeFileSync(path.join(base, "data", "jobs.json"), JSON.stringify({ jobs: [
      job("job-dropped", "dropped", "drop"),
      job("job-live", "approved", "apply"),
    ], version: 1, updatedAt: now }));
    expect(writeDeletion(base, { scope: "activity", id: "a-orphan" })).toEqual({ ok: true, scope: "activity", id: "a-orphan" });
    expect(writeDeletion(base, { scope: "activity", id: "a-live" }).ok).toBe(false);
  });

  it("queryActivityFeed exposes running entries and pending inbox files", () => {
    const base = fixture();
    const inbox = path.join(base, "data", "inbox");
    writeFileSync(path.join(inbox, "task-b.json"), JSON.stringify({ taskId: "task-b", event: "AGENT_ACTIVITY" }));
    writeFileSync(path.join(inbox, "task-a.json"), JSON.stringify({ taskId: "task-a", event: "SCREENED" }));
    writeFileSync(path.join(inbox, "task-bad.json"), "{not json");
    const q = queryActivityFeed(base, {});
    expect(q.running.map((a) => a.activityId)).toEqual(["a-new"]);
    expect(q.pendingInbox.count).toBe(3);
    expect(q.pendingInbox.items.map((i) => i.taskId).sort()).toEqual(["task-a", "task-b", "task-bad"]);
    expect(q.pendingInbox.items.find((i) => i.taskId === "task-b")!.event).toBe("AGENT_ACTIVITY");
    expect(q.pendingInbox.items.find((i) => i.taskId === "task-bad")!.event).toBe("unknown");
    expect(typeof q.pendingInbox.items[0]!.submittedAt).toBe("string");
    const bare = mkdtempSync(path.join(tmpdir(), "engine-activity-console-bare-"));
    temps.push(bare);
    const empty = queryActivityFeed(bare, {});
    expect(empty.running).toEqual([]);
    expect(empty.pendingInbox).toEqual({ count: 0, items: [] });
  });
});

it("unfinished pagination filters before slicing, clamps vanished pages and preserves completed history", () => {
  const base = fixture();
  const q = queryActivityFeed(base, { status: "unfinished", page: 50, pageSize: 1, selectedId: "a-old" });
  expect(q.total).toBe(1); expect(q.page).toBe(1); expect(q.activities[0].activityId).toBe("a-new");
  expect(q.selectedActivity?.activityId).toBe("a-old"); expect(q.selectedActivity?.status).toBe("done");
  expect(queryActivityFeed(base, { status: "done" }).total).toBe(2);
  const file = path.join(base, "data/activity.json");
  const data = JSON.parse(readFileSync(file, "utf8")); data.activities.push({ ...data.activities.find((a: { activityId: string }) => a.activityId === "a-new"), status: "done", finishedAt: new Date().toISOString() });
  writeFileSync(file, JSON.stringify(data));
  const after = queryActivityFeed(base, { status: "unfinished", selectedId: "a-new" });
  expect(after.total).toBe(0); expect(after.activities).toEqual([]); expect(after.selectedActivity?.status).toBe("done");
});

it("shows real recent business processing and flags missing Agent progress without inventing running activities", async () => {
  const base = fixture(); const now = Date.now();
  const { writeReceipt } = await import("./receipt");
  writeFileSync(path.join(base, "data/activity.json"), JSON.stringify({ version: 1, updatedAt: "", activities: [] }));
  writeReceipt(base, { taskId: "real-business", event: "APPLICATION_SUBMITTED", status: "committed", createdAt: new Date(now - 1000).toISOString(), summary: "Real application committed" });
  const result = queryActivityFeed(base, { nowMs: now });
  expect(result.reporting.missingProgress).toBe(true); expect(result.reporting.recentBusiness[0].taskId).toBe("real-business");
  expect(result.running).toEqual([]); expect(result.activities).toEqual([]);
  expect(queryActivityFeed(base, { nowMs: now + 16 * 60_000 }).reporting.missingProgress).toBe(false);
});
it("fresh Agent running signals suppress missing-progress warnings; unverified business runs are excluded", async () => {
  const base = fixture(); const { writeReceipt } = await import("./receipt");
  const createdAt = new Date().toISOString();
  writeReceipt(base, { taskId: "verified-business", event: "SCREENED", status: "committed", createdAt, summary: "Screened" });
  writeFileSync(path.join(base, "data/runs/unverified.json"), JSON.stringify({ taskId: "unverified", event: "SCREENED", status: "committed", summary: "No receipt", finishedAt: createdAt }));
  const result = queryActivityFeed(base, {});
  expect(result.running.length).toBeGreaterThan(0); expect(result.reporting.missingProgress).toBe(false);
  expect(result.reporting.recentBusiness.map(x => x.taskId)).toEqual(["verified-business"]);
});
