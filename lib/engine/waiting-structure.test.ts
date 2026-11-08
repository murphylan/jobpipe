import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyAgentWaiting, applyWaitingAnswer } from "./events4";
import { groupWaitingQuestions, listWaiting, writeWaitingAnswer, type WaitingItem } from "./console";
import type { GenericChangeSet } from "./events";

const temps: string[] = [];
afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

function fixture(): string {
  const base = mkdtempSync(path.join(tmpdir(), "engine-waiting-"));
  temps.push(base);
  mkdirSync(path.join(base, "data", "inbox"), { recursive: true });
  const w = (rel: string, v: unknown) => writeFileSync(path.join(base, "data", rel), JSON.stringify(v));
  w("changelog.json", { entries: [], version: 1, updatedAt: "2026-11-08T00:00:00Z" });
  w("jobs.json", { jobs: [], version: 1, updatedAt: "2026-11-08T00:00:00Z" });
  w("applications.json", { applications: [], version: 1, updatedAt: "2026-11-08T00:00:00Z" });
  return base;
}

function waitingCs(taskId: string, overrides: Record<string, unknown> = {}): GenericChangeSet {
  return {
    taskId,
    event: "AGENT_WAITING",
    createdAt: "2026-11-08T10:00:00Z",
    payload: { waitingId: "w-001", question: "Degree in CS or related field?", context: ["form asks directly"], ...overrides },
  };
}

function readItems(base: string): Record<string, any>[] {
  return JSON.parse(readFileSync(path.join(base, "data", "waiting.json"), "utf-8")).items;
}

describe("structured waiting questions (temp dirs only)", () => {
  it("stores structured fields; a bad category is rejected", () => {
    const base = fixture();
    const ok = applyAgentWaiting(base, waitingCs("t1", {
      category: "missing-fact", factKey: "degree.cs-or-related",
      checkedSources: ["profile.education"], candidates: ["Yes", "No"], blocksStep: "apply:pre-submit",
      fieldRef: { jobId: "job-1", planFieldKey: "education" },
    }));
    expect(ok.ok).toBe(true);
    const item = readItems(base)[0];
    expect(item.category).toBe("missing-fact");
    expect(item.factKey).toBe("degree.cs-or-related");
    expect(item.candidates).toEqual(["Yes", "No"]);
    expect(item.answerScope).toBe(null);
    expect(applyAgentWaiting(base, waitingCs("t2", { waitingId: "w-002", category: "nope" })).ok).toBe(false);
  });

  it("answer scope: standing is stored for fact questions, defaults to once", () => {
    const base = fixture();
    expect(applyAgentWaiting(base, waitingCs("t3", { category: "missing-fact", factKey: "degree.x" })).ok).toBe(true);
    expect(applyWaitingAnswer(base, "w-001", "answer", "No", "2026-11-08T11:00:00Z", "standing").ok).toBe(true);
    expect(readItems(base)[0].answerScope).toBe("standing");
    expect(applyAgentWaiting(base, waitingCs("t4", { waitingId: "w-002" })).ok).toBe(true);
    expect(applyWaitingAnswer(base, "w-002", "answer", "ok", "2026-11-08T11:05:00Z").ok).toBe(true);
    expect(readItems(base)[1].answerScope).toBe("once");
  });

  it("approval answers can never be standing (facts reuse, approvals do not)", () => {
    const base = fixture();
    expect(applyAgentWaiting(base, waitingCs("t5", { category: "approval", kind: "approval" })).ok).toBe(true);
    const r = applyWaitingAnswer(base, "w-001", "answer", "同意", "2026-11-08T11:00:00Z", "standing");
    expect(r.ok).toBe(false);
    expect(readItems(base)[0].status).toBe("open");
    expect(applyWaitingAnswer(base, "w-001", "answer", "同意", "2026-11-08T11:01:00Z", "once").ok).toBe(true);
  });

  it("console writeWaitingAnswer enforces the same approval-scope rule and writes scope", () => {
    const base = fixture();
    expect(applyAgentWaiting(base, waitingCs("t6", { category: "approval", kind: "approval" })).ok).toBe(true);
    const bad = writeWaitingAnswer(base, { waitingId: "w-001", action: "answer", answer: "同意", scope: "standing" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe("approval-scope-standing");
    expect(applyAgentWaiting(base, waitingCs("t7", { waitingId: "w-002", category: "conflict", factKey: "salary.x" })).ok).toBe(true);
    const good = writeWaitingAnswer(base, { waitingId: "w-002", action: "answer", answer: "190k", scope: "standing" });
    expect(good.ok).toBe(true);
    const decision = JSON.parse(readFileSync(path.join(base, "data", "inbox", "decisions", "decision-waiting-w-002.json"), "utf-8"));
    expect(decision.scope).toBe("standing");
  });

  it("groupWaitingQuestions merges same category+factKey across jobs, never different meanings", () => {
    const mk = (over: Partial<WaitingItem>): WaitingItem => ({
      waitingId: "w-x", question: "?", context: [], kind: "question", status: "open",
      createdAt: "2026-11-08T10:00:00Z", sourceActivityId: null, sourceStage: null,
      answer: null, answeredAt: null, taskId: "t", ...over,
    });
    const groups = groupWaitingQuestions([
      mk({ waitingId: "w-1", jobId: "job-1", category: "missing-fact", factKey: "degree.x", createdAt: "2026-11-08T10:00:00Z" }),
      mk({ waitingId: "w-2", jobId: "job-2", category: "missing-fact", factKey: "degree.x", createdAt: "2026-11-08T10:01:00Z" }),
      mk({ waitingId: "w-3", jobId: "job-3", category: "conflict", factKey: "degree.x", createdAt: "2026-11-08T10:02:00Z" }),
      mk({ waitingId: "w-4", jobId: "job-4", createdAt: "2026-11-08T10:03:00Z" }),
      mk({ waitingId: "w-5", jobId: "job-5", category: "missing-fact", factKey: "degree.x", status: "answered" }),
    ]);
    expect(groups).toHaveLength(3);
    const merged = groups.find((g) => g.factKey === "degree.x" && g.category === "missing-fact")!;
    expect(merged.items.map((i) => i.waitingId)).toEqual(["w-1", "w-2"]);
    expect(merged.jobIds).toEqual(["job-1", "job-2"]);
    expect(groups.find((g) => g.category === "conflict")!.items).toHaveLength(1);
  });

  it("listWaiting marks answered items pending-resume until the source activity moves", () => {
    const base = fixture();
    const w = (rel: string, v: unknown) => writeFileSync(path.join(base, "data", rel), JSON.stringify(v));
    const activity = (status: string, createdAt: string) => ({
      activityId: "act-1", kind: "applying", stage: "apply", title: "Apply", status,
      startedAt: "2026-11-08T09:00:00Z", finishedAt: null, refs: [], note: "", evidence: [],
      taskId: `task-${createdAt}`, createdAt,
    });
    w("activity.json", { activities: [activity("waiting", "2026-11-08T10:00:00Z")], version: 1, updatedAt: "2026-11-08T10:00:00Z" });
    expect(applyAgentWaiting(base, waitingCs("t8", { sourceActivityId: "act-1" })).ok).toBe(true);
    expect(applyWaitingAnswer(base, "w-001", "answer", "No", "2026-11-08T11:00:00Z").ok).toBe(true);
    expect(listWaiting(base).find((i) => i.waitingId === "w-001")?.resumeState).toBe("answered-pending-resume");
    w("activity.json", { activities: [activity("waiting", "2026-11-08T10:00:00Z"), activity("running", "2026-11-08T11:30:00Z")], version: 2, updatedAt: "2026-11-08T11:30:00Z" });
    expect(listWaiting(base).find((i) => i.waitingId === "w-001")?.resumeState).toBe("resumed");
    expect(existsSync(path.join(base, "data", "waiting.json"))).toBe(true);
  });
});
