import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyPlanRecorded, planHashOf } from "./events5";
import type { GenericChangeSet } from "./events";

const temps: string[] = [];
afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

function job(id: string, status: string): Record<string, unknown> {
  return {
    id, company: "Example", role: "Engineer", channel: "Greenhouse", location: "Remote",
    remote: "remote", salaryPosted: null, salaryAnswer: null, matchPoints: [], redFlags: [],
    conclusion: "apply", status,
  };
}

function fixture(): string {
  const base = mkdtempSync(path.join(tmpdir(), "engine-events5-"));
  temps.push(base);
  mkdirSync(path.join(base, "data", "inbox"), { recursive: true });
  const w = (rel: string, v: unknown) => writeFileSync(path.join(base, "data", rel), JSON.stringify(v));
  w("changelog.json", { entries: [], version: 1, updatedAt: "2026-11-08T00:00:00Z" });
  w("jobs.json", { jobs: [job("job-1", "approved"), job("job-applied", "applied"), job("job-dropped", "dropped")], version: 1, updatedAt: "2026-11-08T00:00:00Z" });
  w("applications.json", { applications: [], version: 1, updatedAt: "2026-11-08T00:00:00Z" });
  w("resume-versions.json", { versions: [{ version: "v1-job1", jobId: "job-1", file: "data/resume-files/v1.pdf", createdAt: "2026-11-08T00:00:00Z", note: "" }], selected: {}, version: 1, updatedAt: "2026-11-08T00:00:00Z" });
  w("profile.json", { version: 3, updatedAt: "2026-11-08T00:00:00Z", email: "a@example.com", workAuth: "Authorized (fixture)" });
  w("knowledge.json", { version: 12, updatedAt: "2026-11-08T00:00:00Z", entries: [{ id: "k-sponsorship", title: "Sponsorship", body: "Answer No", tags: ["agent-context"], createdAt: "2026-11-08T00:00:00Z", updatedAt: "2026-11-08T00:00:00Z", archived: false }], rereads: [] });
  w("quirks.json", { quirks: [{ id: "q-school", trigger: "school dropdown", action: "leave blank", source: "test", version: 1, updatedAt: "2026-11-08T00:00:00Z" }], version: 1, updatedAt: "2026-11-08T00:00:00Z" });
  w("waiting.json", { items: [{
    waitingId: "w-ans-1", jobId: "job-1", question: "Degree?", context: [], kind: "question",
    status: "answered", createdAt: "2026-11-08T01:00:00Z", sourceActivityId: null,
    answer: "No", answeredAt: "2026-11-08T02:00:00Z", taskId: "w-task-1",
  }], version: 1, updatedAt: "2026-11-08T00:00:00Z" });
  return base;
}

function planCs(taskId: string, overrides: Record<string, unknown> = {}): GenericChangeSet {
  return {
    taskId,
    event: "PLAN_RECORDED",
    createdAt: "2026-11-08T10:00:00Z",
    payload: {
      planId: "plan-run-1-v1",
      jobId: "job-1",
      runId: "run-1",
      activityId: "act-1",
      planVersion: 1,
      resumeVersion: "v1-job1",
      formUrl: "https://example.com/apply",
      fields: [
        { fieldKey: "work_auth", pageLabel: "Authorized to work?", plannedValue: "Yes", valueKind: "enum", source: { kind: "profile", ref: "profile.workAuth" }, key: true },
        { fieldKey: "email", pageLabel: "Email", plannedValue: "a@example.com", valueKind: "text", source: { kind: "profile", ref: "profile.email" }, key: true },
        { fieldKey: "sponsorship", pageLabel: "Require sponsorship?", plannedValue: "No", valueKind: "enum", source: { kind: "knowledge", ref: "k-sponsorship" }, key: true },
        { fieldKey: "resume", pageLabel: "Resume", plannedValue: "v1.pdf", valueKind: "file", source: { kind: "material", ref: "v1-job1" }, key: false },
      ],
      approvalBasis: { kind: "batch-authorization", ref: "chat-batch-1" },
      ...overrides,
    },
  };
}

function readPlans(base: string): { plans: Record<string, any>[]; version: number } {
  return JSON.parse(readFileSync(path.join(base, "data", "plans.json"), "utf-8"));
}

describe("PLAN_RECORDED (temp dirs only)", () => {
  it("approved when every key source resolves and an approval basis is carried", () => {
    const base = fixture();
    const r = applyPlanRecorded(base, planCs("plan-task-1"));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.summary).toContain("approved");
    const data = readPlans(base);
    expect(data.plans).toHaveLength(1);
    expect(data.plans[0].status).toBe("approved");
    expect(data.plans[0].blockers).toEqual([]);
    expect(data.plans[0].planHash).toMatch(/^[0-9a-f]{64}$/);
    const changelog = JSON.parse(readFileSync(path.join(base, "data", "changelog.json"), "utf-8"));
    expect(changelog.entries.at(-1).action).toBe("plan-recorded");
  });

  it("recorded (not approved) when the approval basis is missing", () => {
    const base = fixture();
    const r = applyPlanRecorded(base, planCs("plan-task-2", { approvalBasis: undefined }));
    expect(r.ok).toBe(true);
    const data = readPlans(base);
    expect(data.plans[0].status).toBe("recorded");
    expect(data.plans[0].blockers.join(" ")).toContain("approval-basis");
  });

  it("an unresolvable key source blocks approval and names the field", () => {
    const base = fixture();
    const fields = [
      { fieldKey: "sponsorship", pageLabel: "Require sponsorship?", plannedValue: "No", valueKind: "enum", source: { kind: "knowledge", ref: "k-missing" }, key: true },
    ];
    const r = applyPlanRecorded(base, planCs("plan-task-3", { fields }));
    expect(r.ok).toBe(true);
    const data = readPlans(base);
    expect(data.plans[0].status).toBe("recorded");
    expect(data.plans[0].blockers.join(" ")).toContain("sponsorship");
  });

  it("user-answer source resolves only from an answered waiting item of the same job", () => {
    const base = fixture();
    const fields = [
      { fieldKey: "education", pageLabel: "Degree in CS?", plannedValue: "No", valueKind: "enum", source: { kind: "user-answer", ref: "w-ans-1" }, key: true },
    ];
    expect(applyPlanRecorded(base, planCs("plan-task-4", { fields })).ok).toBe(true);
    expect(readPlans(base).plans[0].status).toBe("approved");
    const openFields = [
      { fieldKey: "education", pageLabel: "Degree in CS?", plannedValue: "No", valueKind: "enum", source: { kind: "user-answer", ref: "w-nope" }, key: true },
    ];
    expect(applyPlanRecorded(base, planCs("plan-task-5", { planId: "plan-run-1-v2", planVersion: 2, fields: openFields })).ok).toBe(true);
    const plans = readPlans(base).plans;
    expect(plans.find((p) => p.planVersion === 2)?.status).toBe("recorded");
  });

  it("a higher planVersion supersedes the previous version; a stale version is rejected", () => {
    const base = fixture();
    expect(applyPlanRecorded(base, planCs("plan-task-6")).ok).toBe(true);
    expect(applyPlanRecorded(base, planCs("plan-task-7", { planId: "plan-run-1-v2", planVersion: 2 })).ok).toBe(true);
    const plans = readPlans(base).plans;
    expect(plans.find((p) => p.planVersion === 1)?.status).toBe("superseded");
    expect(plans.find((p) => p.planVersion === 2)?.status).toBe("approved");
    expect(applyPlanRecorded(base, planCs("plan-task-8", { planId: "plan-run-1-v2b", planVersion: 2 })).ok).toBe(false);
    expect(applyPlanRecorded(base, planCs("plan-task-9", { planId: "plan-run-1-v2", planVersion: 3 })).ok).toBe(false);
  });

  it("guards: applied/dropped jobs, secret values, key without source, unregistered resume, forced key", () => {
    const base = fixture();
    expect(applyPlanRecorded(base, planCs("g1", { jobId: "job-applied" })).ok).toBe(false);
    expect(applyPlanRecorded(base, planCs("g2", { jobId: "job-dropped" })).ok).toBe(false);
    expect(applyPlanRecorded(base, planCs("g3", { jobId: "job-nope" })).ok).toBe(false);
    const secret = [{ fieldKey: "password", pageLabel: "Password", plannedValue: "hunter2", valueKind: "secret-action", source: null, key: false }];
    expect(applyPlanRecorded(base, planCs("g4", { fields: secret })).ok).toBe(false);
    const noSource = [{ fieldKey: "work_auth", pageLabel: "Authorized?", plannedValue: "Yes", valueKind: "enum", source: null, key: true }];
    expect(applyPlanRecorded(base, planCs("g5", { fields: noSource })).ok).toBe(false);
    expect(applyPlanRecorded(base, planCs("g6", { resumeVersion: "v-unregistered" })).ok).toBe(false);
    const forced = [{ fieldKey: "email", pageLabel: "Email", plannedValue: "a@example.com", valueKind: "text", source: { kind: "profile", ref: "profile.email" }, key: false }];
    expect(applyPlanRecorded(base, planCs("g7", { fields: forced })).ok).toBe(false);
    expect(existsSync(path.join(base, "data", "plans.json"))).toBe(false);
  });

  it("planHashOf is deterministic and value-sensitive", () => {
    const input = { planId: "p1", jobId: "j1", runId: "r1", planVersion: 1, resumeVersion: "v1", formUrl: "https://example.com", fields: [{ fieldKey: "email", pageLabel: "Email", plannedValue: "a@example.com", valueKind: "text", source: { kind: "profile", ref: "profile.email" }, key: true }] };
    expect(planHashOf(input)).toBe(planHashOf(input));
    expect(planHashOf({ ...input, fields: [{ ...input.fields[0], plannedValue: "b@example.com" }] })).not.toBe(planHashOf(input));
  });
});
