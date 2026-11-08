import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyPlanRecorded } from "./events5";
import { applyAttemptRecorded, applyAttemptResolved, applyCheckpointRecorded, checkpointSetHashOf, type CheckpointRec } from "./events6";
import { listAttempts, listCheckpoints } from "./console";
import { expandApplicationSubmitted, type ChangeSetInput } from "./expand";
import { applyApplicationSubmitted } from "./apply";
import type { GenericChangeSet } from "./events";

const temps: string[] = [];
afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

const HEADER = "id,date_submitted,company,role,req_url,channel,score,role_family,resume_version,employment_type,submission_status,evidence,stage,last_contact_date,recruiter,next_action,next_action_date,jd_snapshot_path,notes";
const REGISTRY_YAML = `version: 2
events:
  - name: "APPLICATION_SUBMITTED"
    description: "test"
    requiresApproval: true
    writes:
      - "data/jobs.json"
      - "data/applications.json"
      - "data/mirror/ledger.csv"
      - "data/changelog.json"
      - "data/daily.json"
      - "data/attempts.json"
    handler: "expandApplicationSubmitted"
`;

function job(id: string, status: string): Record<string, unknown> {
  return {
    id, company: "Example", role: "Engineer", channel: "Greenhouse", location: "Remote",
    remote: "remote", salaryPosted: null, salaryAnswer: null, matchPoints: [], redFlags: [],
    conclusion: "apply", status, jdKind: "full", url: "https://example.com/job",
  };
}

function fixture(): string {
  const base = mkdtempSync(path.join(tmpdir(), "engine-events6-"));
  temps.push(base);
  mkdirSync(path.join(base, "data", "inbox"), { recursive: true });
  mkdirSync(path.join(base, "data", "mirror"), { recursive: true });
  mkdirSync(path.join(base, "data", "resume-files"), { recursive: true });
  mkdirSync(path.join(base, "lib", "engine"), { recursive: true });
  writeFileSync(path.join(base, "lib", "engine", "registry.yaml"), REGISTRY_YAML);
  const w = (rel: string, v: unknown) => writeFileSync(path.join(base, "data", rel), JSON.stringify(v));
  w("changelog.json", { entries: [], version: 1, updatedAt: "2026-11-08T00:00:00Z" });
  w("jobs.json", { jobs: [job("job-1", "approved"), job("job-2", "approved")], version: 1, updatedAt: "2026-11-08T00:00:00Z" });
  w("applications.json", { applications: [], version: 1, updatedAt: "2026-11-08T00:00:00Z" });
  w("resume-versions.json", { versions: [{ version: "v1-job1", jobId: "job-1", file: "data/resume-files/v1.pdf", createdAt: "2026-11-08T00:00:00Z", note: "" }], selected: {}, version: 1, updatedAt: "2026-11-08T00:00:00Z" });
  writeFileSync(path.join(base, "data", "resume-files", "v1.pdf"), "fake pdf content");
  w("profile.json", { version: 3, updatedAt: "2026-11-08T00:00:00Z", email: "a@example.com", workAuth: "Authorized (fixture)" });
  w("knowledge.json", { version: 12, updatedAt: "2026-11-08T00:00:00Z", entries: [{ id: "k-sponsorship", title: "Sponsorship", body: "Answer No", tags: ["agent-context"], createdAt: "2026-11-08T00:00:00Z", updatedAt: "2026-11-08T00:00:00Z", archived: false }], rereads: [] });
  w("quirks.json", { quirks: [], version: 1, updatedAt: "2026-11-08T00:00:00Z" });
  w("daily.json", { days: {}, version: 1, updatedAt: "2026-11-08T00:00:00Z" });
  writeFileSync(path.join(base, "data", "mirror", "ledger.csv"), `${HEADER}\n5,2026-11-07,Old Co,Old Role,,LinkedIn,,,,,confirmed,evidence,applied,,,,,,\n`);
  return base;
}

const PLAN_FIELDS = [
  { fieldKey: "work_auth", pageLabel: "Authorized to work?", plannedValue: "Yes", valueKind: "enum", source: { kind: "profile", ref: "profile.workAuth" }, key: true },
  { fieldKey: "email", pageLabel: "Email", plannedValue: "a@example.com", valueKind: "text", source: { kind: "profile", ref: "profile.email" }, key: true },
  { fieldKey: "sponsorship", pageLabel: "Require sponsorship?", plannedValue: "No", valueKind: "enum", source: { kind: "knowledge", ref: "k-sponsorship" }, key: true },
  { fieldKey: "resume", pageLabel: "Resume", plannedValue: "v1.pdf", valueKind: "file", source: { kind: "material", ref: "v1-job1" }, key: false },
];

function planCs(taskId: string, overrides: Record<string, unknown> = {}): GenericChangeSet {
  return {
    taskId, event: "PLAN_RECORDED", createdAt: "2026-11-08T10:00:00Z",
    payload: {
      planId: "plan-run-1-v1", jobId: "job-1", runId: "run-1", activityId: "act-1", planVersion: 1,
      resumeVersion: "v1-job1", formUrl: "https://example.com/apply", fields: PLAN_FIELDS,
      approvalBasis: { kind: "batch-authorization", ref: "chat-batch-1" }, ...overrides,
    },
  };
}

function readJson(base: string, rel: string): any {
  return JSON.parse(readFileSync(path.join(base, "data", rel), "utf-8"));
}

function approvedPlan(base: string): { planId: string; planHash: string } {
  const r = applyPlanRecorded(base, planCs("plan-task-1"));
  expect(r.ok).toBe(true);
  const plan = readJson(base, "plans.json").plans[0];
  expect(plan.status).toBe("approved");
  return { planId: plan.planId, planHash: plan.planHash };
}

function checkpointCs(taskId: string, createdAt: string, planRef: { planId: string; planHash: string }, type: string, results: unknown[]): GenericChangeSet {
  return { taskId, event: "CHECKPOINT_RECORDED", createdAt, payload: { checkpointId: `ck-${taskId}`, jobId: "job-1", runId: "run-1", activityId: "act-1", planRef, type, results } };
}

const KEY_READBACKS = [
  { fieldKey: "work_auth", expected: "Yes", readback: "Yes", result: "match", basis: "dom-value" },
  { fieldKey: "email", expected: "a@example.com", readback: "a@example.com", result: "match", basis: "dom-value" },
  { fieldKey: "sponsorship", expected: "No", readback: "No", result: "match", basis: "dom-value" },
];

function passedPreSubmit(base: string, planRef: { planId: string; planHash: string }): void {
  const r = applyCheckpointRecorded(base, checkpointCs("ck-task-pre", "2026-11-08T10:05:00Z", planRef, "pre-submit", KEY_READBACKS));
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.summary).toContain("passed");
}

function setHash(base: string, planRef: { planId: string; planHash: string }): string {
  const checkpoints = readJson(base, "checkpoints.json").checkpoints as CheckpointRec[];
  return checkpointSetHashOf(checkpoints, "job-1", planRef.planId, planRef.planHash);
}

function attemptCs(taskId: string, createdAt: string, planRef: { planId: string; planHash: string }, hash: string, overrides: Record<string, unknown> = {}): GenericChangeSet {
  return {
    taskId, event: "ATTEMPT_RECORDED", createdAt,
    payload: { attemptId: "att-run-1-1", jobId: "job-1", runId: "run-1", activityId: "act-1", planRef, resumeVersion: "v1-job1", checkpointSetHash: hash, approvalRef: "chat-batch-1", ...overrides },
  };
}

function resolveCs(taskId: string, createdAt: string, outcome: string, evidence?: { kind: string; text: string }[]): GenericChangeSet {
  return { taskId, event: "ATTEMPT_RESOLVED", createdAt, payload: { attemptId: "att-run-1-1", outcome, ...(evidence ? { evidence } : {}) } };
}

function submitCs(attemptId?: string): ChangeSetInput {
  return {
    taskId: "apply-task-1", event: "APPLICATION_SUBMITTED", createdAt: "2026-11-08T10:30:00Z",
    payload: { jobId: "job-1", resumeVersion: "v1-job1", ...(attemptId ? { attemptId } : {}) },
    evidence: [
      { kind: "employer-confirmation", text: "Greenhouse confirmation page" },
      { kind: "user-approval", text: "batch approval in chat" },
    ],
  };
}

describe("CHECKPOINT_RECORDED (temp dirs only)", () => {
  it("passes when read-backs equal the plan; the Engine recomputes a lying 'match' into a failure", () => {
    const base = fixture();
    const ref = approvedPlan(base);
    const ok = applyCheckpointRecorded(base, checkpointCs("ck-t1", "2026-11-08T10:05:00Z", ref, "after-parse", KEY_READBACKS));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.summary).toContain("passed");
    const lying = KEY_READBACKS.map((r) => r.fieldKey === "email" ? { ...r, readback: "different@example.com" } : r);
    const bad = applyCheckpointRecorded(base, checkpointCs("ck-t2", "2026-11-08T10:06:00Z", ref, "after-parse", lying));
    expect(bad.ok).toBe(true);
    if (bad.ok) expect(bad.summary).toContain("failed");
    const stored = readJson(base, "checkpoints.json").checkpoints.find((c: any) => c.checkpointId === "ck-ck-t2");
    expect(stored.results.find((r: any) => r.fieldKey === "email").result).toBe("mismatch");
    const unreadable = KEY_READBACKS.map((r) => r.fieldKey === "email" ? { ...r, readback: null } : r);
    const un = applyCheckpointRecorded(base, checkpointCs("ck-t3", "2026-11-08T10:07:00Z", ref, "after-parse", unreadable));
    expect(un.ok).toBe(true);
    if (un.ok) expect(un.summary).toContain("failed");
  });

  it("rejects a stale planHash, an expected value that contradicts the plan, and secret read-backs", () => {
    const base = fixture();
    const ref = approvedPlan(base);
    const stale = applyCheckpointRecorded(base, checkpointCs("ck-t4", "2026-11-08T10:05:00Z", { planId: ref.planId, planHash: "deadbeef" }, "after-parse", KEY_READBACKS));
    expect(stale.ok).toBe(false);
    const contra = KEY_READBACKS.map((r) => r.fieldKey === "email" ? { ...r, expected: "other@example.com" } : r);
    expect(applyCheckpointRecorded(base, checkpointCs("ck-t5", "2026-11-08T10:05:00Z", ref, "after-parse", contra)).ok).toBe(false);
    const base2 = fixture();
    const fields = [...PLAN_FIELDS, { fieldKey: "password", pageLabel: "Password", valueKind: "secret-action", source: null, key: false }];
    expect(applyPlanRecorded(base2, planCs("plan-task-s", { fields })).ok).toBe(true);
    const ref2 = readJson(base2, "plans.json").plans[0];
    const leak = applyCheckpointRecorded(base2, checkpointCs("ck-t6", "2026-11-08T10:05:00Z", { planId: ref2.planId, planHash: ref2.planHash }, "after-parse", [{ fieldKey: "password", readback: "hunter2", result: "match" }]));
    expect(leak.ok).toBe(false);
  });

  it("a pre-submit checkpoint missing a key field fails with the gap listed; other types do not require coverage", () => {
    const base = fixture();
    const ref = approvedPlan(base);
    const partial = KEY_READBACKS.filter((r) => r.fieldKey !== "sponsorship");
    const r = applyCheckpointRecorded(base, checkpointCs("ck-t7", "2026-11-08T10:05:00Z", ref, "pre-submit", partial));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.summary).toContain("failed");
    const stored = readJson(base, "checkpoints.json").checkpoints[0];
    expect(stored.missingKeyFields).toEqual(["sponsorship"]);
    const up = applyCheckpointRecorded(base, checkpointCs("ck-t8", "2026-11-08T10:06:00Z", ref, "after-upload", [{ fieldKey: "resume", expected: "v1.pdf", readback: "v1.pdf", result: "match", basis: "file-name" }]));
    expect(up.ok).toBe(true);
    if (up.ok) expect(up.summary).toContain("passed");
  });
});

describe("ATTEMPT_RECORDED / ATTEMPT_RESOLVED (temp dirs only)", () => {
  it("write-ahead record, job-level lock, and the not-submitted path frees the lock", () => {
    const base = fixture();
    const ref = approvedPlan(base);
    passedPreSubmit(base, ref);
    const hash = setHash(base, ref);
    expect(applyAttemptRecorded(base, attemptCs("att-t1", "2026-11-08T10:10:00Z", ref, hash)).ok).toBe(true);
    const locked = applyAttemptRecorded(base, attemptCs("att-t2", "2026-11-08T10:11:00Z", ref, hash, { attemptId: "att-run-1-2" }));
    expect(locked.ok).toBe(false);
    if (!locked.ok) expect(locked.errors.join(" ")).toContain("E_ATTEMPT_OPEN");
    expect(applyAttemptResolved(base, resolveCs("att-t3", "2026-11-08T10:12:00Z", "not-submitted")).ok).toBe(true);
    expect(applyAttemptRecorded(base, attemptCs("att-t4", "2026-11-08T10:13:00Z", ref, hash, { attemptId: "att-run-1-2" })).ok).toBe(true);
  });

  it("requires an approved plan, a passed pre-submit, and the current checkpoint set hash", () => {
    const base = fixture();
    const ref = approvedPlan(base);
    const noCk = applyAttemptRecorded(base, attemptCs("att-t5", "2026-11-08T10:10:00Z", ref, "whatever"));
    expect(noCk.ok).toBe(false);
    if (!noCk.ok) expect(noCk.errors.join(" ")).toContain("no-passed-pre-submit-checkpoint");
    passedPreSubmit(base, ref);
    const stale = applyAttemptRecorded(base, attemptCs("att-t6", "2026-11-08T10:11:00Z", ref, "whatever"));
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.errors.join(" ")).toContain("E_CHECKPOINT_STALE");
    const base2 = fixture();
    expect(applyPlanRecorded(base2, planCs("plan-task-u", { approvalBasis: undefined })).ok).toBe(true);
    const plan2 = readJson(base2, "plans.json").plans[0];
    expect(plan2.status).toBe("recorded");
    const ref2 = { planId: plan2.planId, planHash: plan2.planHash };
    passedPreSubmit(base2, ref2);
    const unapproved = applyAttemptRecorded(base2, attemptCs("att-t7", "2026-11-08T10:12:00Z", ref2, setHash(base2, ref2)));
    expect(unapproved.ok).toBe(false);
    if (!unapproved.ok) expect(unapproved.errors.join(" ")).toContain("E_KEY_UNAPPROVED");
  });

  it("uncertain must be resolved through resolved-* with evidence; direct jumps are rejected", () => {
    const base = fixture();
    const ref = approvedPlan(base);
    passedPreSubmit(base, ref);
    const hash = setHash(base, ref);
    expect(applyAttemptRecorded(base, attemptCs("att-t8", "2026-11-08T10:10:00Z", ref, hash)).ok).toBe(true);
    expect(applyAttemptResolved(base, resolveCs("att-t9", "2026-11-08T10:11:00Z", "resolved-confirmed", [{ kind: "employer-confirmation", text: "mail" }])).ok).toBe(false);
    expect(applyAttemptResolved(base, resolveCs("att-t10", "2026-11-08T10:12:00Z", "uncertain")).ok).toBe(true);
    const stillLocked = applyAttemptRecorded(base, attemptCs("att-t11", "2026-11-08T10:13:00Z", ref, hash, { attemptId: "att-run-1-2" }));
    expect(stillLocked.ok).toBe(false);
    expect(applyAttemptResolved(base, resolveCs("att-t12", "2026-11-08T10:14:00Z", "resolved-confirmed")).ok).toBe(false);
    expect(applyAttemptResolved(base, resolveCs("att-t13", "2026-11-08T10:15:00Z", "resolved-confirmed", [{ kind: "employer-confirmation", text: "Thank You for Your Application email 10:14Z" }])).ok).toBe(true);
    expect(applyAttemptResolved(base, resolveCs("att-t14", "2026-11-08T10:16:00Z", "uncertain")).ok).toBe(false);
    const attempt = readJson(base, "attempts.json").attempts[0];
    expect(attempt.status).toBe("resolved-confirmed");
    expect(attempt.history.map((h: any) => h.action)).toEqual(["recorded", "uncertain", "resolved-confirmed"]);
  });
});

describe("APPLICATION_SUBMITTED attempt guard (temp dirs only)", () => {
  it("a job with attempts must cite a confirmed one; citing it consumes the attempt exactly once", () => {
    const base = fixture();
    const ref = approvedPlan(base);
    passedPreSubmit(base, ref);
    expect(applyAttemptRecorded(base, attemptCs("att-t15", "2026-11-08T10:10:00Z", ref, setHash(base, ref))).ok).toBe(true);
    const noCite = expandApplicationSubmitted(base, submitCs(), { today: "2026-11-08" });
    expect(noCite.ok).toBe(false);
    if (!noCite.ok) expect(noCite.errors.join(" ")).toContain("E_ATTEMPT_REQUIRED");
    const tooEarly = expandApplicationSubmitted(base, submitCs("att-run-1-1"), { today: "2026-11-08" });
    expect(tooEarly.ok).toBe(false);
    if (!tooEarly.ok) expect(tooEarly.errors.join(" ")).toContain("E_ATTEMPT_NOT_CONFIRMED");
    expect(applyAttemptResolved(base, resolveCs("att-t16", "2026-11-08T10:12:00Z", "confirmed", [{ kind: "employer-confirmation", text: "confirmation page" }])).ok).toBe(true);
    const good = expandApplicationSubmitted(base, submitCs("att-run-1-1"), { today: "2026-11-08" });
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.expansion.application.attemptId).toBe("att-run-1-1");
    const applied = applyApplicationSubmitted(base, submitCs("att-run-1-1"), { today: "2026-11-08" });
    expect(applied.ok).toBe(true);
    const attempt = readJson(base, "attempts.json").attempts[0];
    expect(attempt.applicationId).toBe("2026-11-08-job-1");
  });

  it("legacy path: a job with no attempts on record still submits without an attemptId", () => {
    const base = fixture();
    const cs = submitCs();
    cs.payload = { jobId: "job-2", resumeVersion: "v1-job1" };
    const r = expandApplicationSubmitted(base, cs, { today: "2026-11-08" });
    expect(r.ok).toBe(true);
    expect(existsSync(path.join(base, "data", "attempts.json"))).toBe(false);
  });
});

describe("console projections (temp dirs only)", () => {
  it("a recorded attempt older than 30 minutes reads as uncertain-timeout; a fresh one does not", () => {
    const base = fixture();
    const now = Date.now();
    const old = new Date(now - 31 * 60_000).toISOString();
    const fresh = new Date(now - 5 * 60_000).toISOString();
    const mk = (attemptId: string, at: string) => ({
      attemptId, jobId: "job-1", runId: "run-1", activityId: null, planId: "p", planHash: "h",
      resumeVersion: "v1-job1", checkpointSetHash: "s", approvalRef: "chat", status: "recorded",
      outcome: null, evidence: [], applicationId: null, history: [], taskId: "t", createdAt: at, updatedAt: at,
    });
    writeFileSync(path.join(base, "data", "attempts.json"), JSON.stringify({ attempts: [mk("att-old", old), mk("att-new", fresh)], version: 1, updatedAt: fresh }));
    const listed = listAttempts(base, now);
    expect(listed.find((a) => a.attemptId === "att-old")?.effectiveStatus).toBe("uncertain-timeout");
    expect(listed.find((a) => a.attemptId === "att-new")?.effectiveStatus).toBe("recorded");
    expect(listCheckpoints(base)).toEqual([]);
  });
});
