import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { validateContextReference } from "./agent-context.ts";
import { atomicWriteFileSync as writeFileSync } from "./storage.ts";
// Stage C events (execution protocol, 2026-11-08): read-back
// checkpoints and submission attempts.
//
// CHECKPOINT_RECORDED: the executor reports the read-back VALUES
// themselves (never a bare pass/fail claim). The Engine recomputes
// every result against the bound plan's planned values and
// computes the verdict itself: a key field that reads back
// different (mismatch) or cannot be read (unreadable) fails the
// checkpoint, and a pre-submit checkpoint must cover every key
// field of the current plan version. Checkpoints bind to a
// planHash; a superseded plan makes its checkpoints unusable.
//
// ATTEMPT_RECORDED / ATTEMPT_RESOLVED: an attempt is recorded
// BEFORE the submit click (write-ahead; no committed receipt, no
// click) and resolved after. The Engine holds the only job-level
// lock: one open attempt per job (E_ATTEMPT_OPEN). Outcomes are
// business facts, separate from activity run status. An attempt
// left "recorded" past the 30-minute uncertainty threshold is
// projected as uncertain by readers (console), never rewritten.
import { commitFiles, readJsonFile, type EventResult, type GenericChangeSet } from "./events.ts";
import { isSafeId } from "./events4.ts";
import { attemptFileSchema, checkpointFileSchema, planFileSchema } from "./schema.ts";
import { canonicalJson } from "./serialize.ts";
import { validTime } from "./activity-lifecycle.ts";

export const CHECKPOINT_TYPES = ["after-upload", "after-parse", "on-page-change", "pre-submit"] as const;
export const CHECKPOINT_RESULTS = ["match", "mismatch", "unreadable", "not-applicable"] as const;
export const CHECKPOINT_BASES = ["dom-value", "screenshot", "file-name"] as const;
export const ATTEMPT_OUTCOMES = ["confirmed", "not-submitted", "uncertain", "resolved-confirmed", "resolved-not-submitted", "escalated"] as const;
export const OPEN_ATTEMPT_STATUSES = ["recorded", "uncertain", "escalated"] as const;
export const UNCERTAIN_AFTER_MS = 30 * 60_000;

const ATTEMPT_TRANSITIONS: Record<string, readonly string[]> = {
  recorded: ["confirmed", "not-submitted", "uncertain"],
  uncertain: ["resolved-confirmed", "resolved-not-submitted", "escalated"],
  escalated: ["resolved-confirmed", "resolved-not-submitted"],
};

type PlanFieldRec = { fieldKey: string; plannedValue?: unknown; valueKind: string; key: boolean };
type PlanRec = {
  planId: string; jobId: string; runId: string; planVersion: number;
  resumeVersion: string; status: string; planHash: string; fields: PlanFieldRec[];
};
export type CheckpointRec = {
  checkpointId: string; jobId: string; planId: string; planHash: string;
  type: string; status: string; createdAt: string;
};
type AttemptRec = Record<string, unknown> & {
  attemptId: string; jobId: string; status: string;
  history: { at: string; action: string; byTaskId: string }[];
};
type CheckpointFile = { checkpoints: Record<string, unknown>[]; version: number; updatedAt: string };
type AttemptFile = { attempts: AttemptRec[]; version: number; updatedAt: string };

function readPlans(baseDir: string): PlanRec[] {
  const full = path.join(baseDir, "data", "plans.json");
  if (!existsSync(full)) return [];
  const parsed = planFileSchema.safeParse(readJsonFile(full));
  if (!parsed.success) throw new Error("plans.json: invalid");
  return parsed.data.plans as PlanRec[];
}

function readCheckpointFile(baseDir: string): CheckpointFile {
  const full = path.join(baseDir, "data", "checkpoints.json");
  if (!existsSync(full)) return { checkpoints: [], version: 0, updatedAt: "" };
  const parsed = checkpointFileSchema.safeParse(readJsonFile(full));
  if (!parsed.success) throw new Error("checkpoints.json: invalid");
  return parsed.data as CheckpointFile;
}

function readAttemptFile(baseDir: string): AttemptFile {
  const full = path.join(baseDir, "data", "attempts.json");
  if (!existsSync(full)) return { attempts: [], version: 0, updatedAt: "" };
  const parsed = attemptFileSchema.safeParse(readJsonFile(full));
  if (!parsed.success) throw new Error("attempts.json: invalid");
  return parsed.data as AttemptFile;
}

function writeChangelogEntry(baseDir: string, stamp: string, action: string, target: string, version: number, note: string): void {
  const changelogPath = path.join(baseDir, "data", "changelog.json");
  const parsed = existsSync(changelogPath)
    ? (readJsonFile(changelogPath) as { entries: Record<string, unknown>[]; version: number })
    : { entries: [], version: 0 };
  parsed.entries.push({ at: stamp, action, target, version, note });
  writeFileSync(changelogPath, canonicalJson({ ...parsed, version: parsed.version + 1, updatedAt: stamp }), "utf-8");
}

function preamble(baseDir: string, cs: GenericChangeSet): EventResult | null {
  try { validateContextReference(baseDir, cs.payload && typeof cs.payload === "object" ? (cs.payload as Record<string, unknown>) : {}); } catch (error) { return { ok: false, errors: [error instanceof Error ? error.message : String(error)] }; }
  if (!validTime(cs.createdAt) || !isSafeId(cs.taskId))
    return { ok: false, errors: ["E_SCHEMA: valid createdAt and safe taskId required"] };
  if (!cs.payload || typeof cs.payload !== "object" || Array.isArray(cs.payload))
    return { ok: false, errors: ["E_SCHEMA: payload must be an object"] };
  return null;
}

function normalizeValue(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v) ?? "";
}

export function valuesEqual(a: unknown, b: unknown): boolean {
  return normalizeValue(a) === normalizeValue(b);
}

function isEmptyValue(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

/** Hash of the current valid checkpoint set for one plan version: latest passed checkpoint per type. */
export function checkpointSetHashOf(checkpoints: CheckpointRec[], jobId: string, planId: string, planHash: string): string {
  const passed = checkpoints.filter((c) => c.jobId === jobId && c.planId === planId && c.planHash === planHash && c.status === "passed");
  const latestByType = new Map<string, CheckpointRec>();
  for (const c of passed) {
    const prev = latestByType.get(c.type);
    if (!prev || c.createdAt >= prev.createdAt) latestByType.set(c.type, c);
  }
  const tuple = [...latestByType.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([type, c]) => [type, c.checkpointId, c.createdAt]);
  return createHash("sha256").update(JSON.stringify(tuple)).digest("hex");
}

function hasPassedPreSubmit(checkpoints: CheckpointRec[], jobId: string, planId: string, planHash: string): boolean {
  return checkpoints.some((c) => c.jobId === jobId && c.planId === planId && c.planHash === planHash && c.type === "pre-submit" && c.status === "passed");
}

function jobSubmissionGuard(baseDir: string, jobId: string): void {
  const jobs = readJsonFile(path.join(baseDir, "data/jobs.json")) as { jobs: { id: string; status?: string }[] };
  const job = jobs.jobs.find((j) => j.id === jobId);
  if (!job) throw new Error(`E_REF_INVALID: job ${jobId} not found`);
  if (job.status === "applied") throw new Error(`E_GUARD:already-applied: job ${jobId} is already applied`);
  if (job.status === "dropped") throw new Error(`E_GUARD:job-dropped: job ${jobId} is dropped`);
  const appsPath = path.join(baseDir, "data", "applications.json");
  if (existsSync(appsPath)) {
    const apps = readJsonFile(appsPath) as { applications: { jobId: string }[] };
    if (apps.applications.some((a) => a.jobId === jobId))
      throw new Error(`E_GUARD:already-applied: job ${jobId} already has an application record`);
  }
}

function currentPlan(plans: PlanRec[], planId: string, jobId: string, planHash: string): PlanRec {
  const plan = plans.find((p) => p.planId === planId);
  if (!plan) throw new Error(`E_REF_INVALID: plan ${planId} not found`);
  if (plan.jobId !== jobId) throw new Error(`E_JOB_MISMATCH: plan ${planId} belongs to job ${plan.jobId}, not ${jobId}`);
  if (plan.status === "superseded" || plan.planHash !== planHash)
    throw new Error(`E_PLAN_STALE: plan ${planId} is ${plan.status} or its hash no longer matches`);
  return plan;
}

type PlanRef = { planId: string; planHash: string };
function parsePlanRef(p: Record<string, unknown>): PlanRef | string {
  const ref = p.planRef;
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) return "E_SCHEMA: payload.planRef must be an object";
  const r = ref as Record<string, unknown>;
  if (!isSafeId(r.planId)) return "E_SCHEMA: payload.planRef.planId missing or unsafe";
  if (typeof r.planHash !== "string" || r.planHash === "") return "E_SCHEMA: payload.planRef.planHash missing";
  return { planId: r.planId, planHash: r.planHash };
}

export function applyCheckpointRecorded(baseDir: string, cs: GenericChangeSet): EventResult {
  const bad = preamble(baseDir, cs);
  if (bad) return bad;
  const stamp = cs.createdAt;
  const p = cs.payload as Record<string, unknown>;
  const checkpointId = p.checkpointId;
  if (!isSafeId(checkpointId)) return { ok: false, errors: ["E_SCHEMA: payload.checkpointId missing or unsafe"] };
  const jobId = p.jobId;
  if (!isSafeId(jobId)) return { ok: false, errors: ["E_SCHEMA: payload.jobId missing or unsafe"] };
  const runId = p.runId;
  if (!isSafeId(runId)) return { ok: false, errors: ["E_SCHEMA: payload.runId missing or unsafe"] };
  const activityId = p.activityId;
  if (activityId !== undefined && !isSafeId(activityId))
    return { ok: false, errors: ["E_SCHEMA: payload.activityId must be safe"] };
  const planRef = parsePlanRef(p);
  if (typeof planRef === "string") return { ok: false, errors: [planRef] };
  const type = p.type;
  if (typeof type !== "string" || !(CHECKPOINT_TYPES as readonly string[]).includes(type))
    return { ok: false, errors: [`E_SCHEMA: payload.type must be one of ${CHECKPOINT_TYPES.join(", ")}`] };
  if (!Array.isArray(p.results) || p.results.length === 0)
    return { ok: false, errors: ["E_SCHEMA: payload.results must be a non-empty array"] };
  type RawResult = { fieldKey: string; expected?: unknown; readback?: unknown; result: string; basis?: string };
  const rawResults: RawResult[] = [];
  for (const raw of p.results as unknown[]) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      return { ok: false, errors: ["E_SCHEMA: each result must be an object"] };
    const r = raw as Record<string, unknown>;
    if (typeof r.fieldKey !== "string" || r.fieldKey === "")
      return { ok: false, errors: ["E_SCHEMA: result.fieldKey missing"] };
    if (typeof r.result !== "string" || !(CHECKPOINT_RESULTS as readonly string[]).includes(r.result))
      return { ok: false, errors: [`E_SCHEMA: result ${r.fieldKey} result must be one of ${CHECKPOINT_RESULTS.join(", ")}`] };
    if (r.basis !== undefined && (typeof r.basis !== "string" || !(CHECKPOINT_BASES as readonly string[]).includes(r.basis)))
      return { ok: false, errors: [`E_SCHEMA: result ${r.fieldKey} basis invalid`] };
    rawResults.push({
      fieldKey: r.fieldKey,
      ...(r.expected !== undefined ? { expected: r.expected } : {}),
      ...(r.readback !== undefined ? { readback: r.readback } : {}),
      result: r.result,
      ...(typeof r.basis === "string" ? { basis: r.basis } : {}),
    });
  }
  let plan: PlanRec;
  try { plan = currentPlan(readPlans(baseDir), planRef.planId, jobId, planRef.planHash); }
  catch (error) { return { ok: false, errors: [error instanceof Error ? error.message : String(error)] }; }
  const planFields = new Map(plan.fields.map((f) => [f.fieldKey, f]));
  const computed: Record<string, unknown>[] = [];
  let failed = false;
  for (const r of rawResults) {
    const pf = planFields.get(r.fieldKey);
    let result = r.result;
    if (pf && pf.valueKind === "secret-action") {
      if (!isEmptyValue(r.readback))
        return { ok: false, errors: [`E_SCHEMA: field ${r.fieldKey} is secret-action and must not carry a readback value`] };
      result = "not-applicable";
    } else if (pf) {
      if (r.expected !== undefined && !valuesEqual(r.expected, pf.plannedValue))
        return { ok: false, errors: [`E_CHECKPOINT_PLAN_MISMATCH: field ${r.fieldKey} expected does not match the plan's planned value`] };
      if (pf.valueKind === "absent") {
        result = isEmptyValue(r.readback) ? (r.result === "not-applicable" ? "not-applicable" : "match") : "mismatch";
      } else if (isEmptyValue(r.readback)) {
        result = "unreadable";
      } else {
        result = valuesEqual(r.readback, pf.plannedValue) ? "match" : "mismatch";
      }
    }
    if (pf?.key && (result === "mismatch" || result === "unreadable")) failed = true;
    computed.push({
      fieldKey: r.fieldKey,
      expected: pf ? (pf.plannedValue ?? null) : (r.expected ?? null),
      readback: r.readback ?? null,
      result,
      ...(r.basis ? { basis: r.basis } : {}),
    });
  }
  const missingKeyFields = type === "pre-submit"
    ? plan.fields.filter((f) => f.key && !rawResults.some((r) => r.fieldKey === f.fieldKey)).map((f) => f.fieldKey)
    : [];
  if (missingKeyFields.length > 0) failed = true;
  const status = failed ? "failed" : "passed";
  let summary = "";
  const result = commitFiles(baseDir, cs.taskId, ["checkpoints.json", "changelog.json"], () => {
    currentPlan(readPlans(baseDir), planRef.planId, jobId, planRef.planHash);
    const data = readCheckpointFile(baseDir);
    if (data.checkpoints.some((c) => c.checkpointId === checkpointId))
      throw new Error(`E_DUPLICATE: checkpoint ${checkpointId} already exists`);
    data.checkpoints.push({
      checkpointId,
      jobId,
      runId,
      activityId: typeof activityId === "string" ? activityId : null,
      planId: planRef.planId,
      planHash: planRef.planHash,
      type,
      status,
      results: computed,
      missingKeyFields,
      taskId: cs.taskId,
      createdAt: stamp,
    });
    const version = data.version + 1;
    writeFileSync(path.join(baseDir, "data", "checkpoints.json"), canonicalJson({ ...data, version, updatedAt: stamp }), "utf-8");
    writeChangelogEntry(baseDir, stamp, "checkpoint-recorded", "checkpoints.json", version, `${cs.taskId} ${checkpointId} ${type} ${status}`);
    summary = `CHECKPOINT_RECORDED ${checkpointId} ${type} ${status}`;
  });
  if (!result.ok) return result;
  return { ok: true, summary };
}

export function applyAttemptRecorded(baseDir: string, cs: GenericChangeSet): EventResult {
  const bad = preamble(baseDir, cs);
  if (bad) return bad;
  const stamp = cs.createdAt;
  const p = cs.payload as Record<string, unknown>;
  const attemptId = p.attemptId;
  if (!isSafeId(attemptId)) return { ok: false, errors: ["E_SCHEMA: payload.attemptId missing or unsafe"] };
  const jobId = p.jobId;
  if (!isSafeId(jobId)) return { ok: false, errors: ["E_SCHEMA: payload.jobId missing or unsafe"] };
  const runId = p.runId;
  if (!isSafeId(runId)) return { ok: false, errors: ["E_SCHEMA: payload.runId missing or unsafe"] };
  const activityId = p.activityId;
  if (activityId !== undefined && !isSafeId(activityId))
    return { ok: false, errors: ["E_SCHEMA: payload.activityId must be safe"] };
  const planRef = parsePlanRef(p);
  if (typeof planRef === "string") return { ok: false, errors: [planRef] };
  const resumeVersion = p.resumeVersion;
  if (typeof resumeVersion !== "string" || resumeVersion === "")
    return { ok: false, errors: ["E_SCHEMA: payload.resumeVersion missing"] };
  const checkpointSetHash = p.checkpointSetHash;
  if (typeof checkpointSetHash !== "string" || checkpointSetHash === "")
    return { ok: false, errors: ["E_SCHEMA: payload.checkpointSetHash missing"] };
  const approvalRef = p.approvalRef;
  if (typeof approvalRef !== "string" || approvalRef === "")
    return { ok: false, errors: ["E_SCHEMA: payload.approvalRef missing (the user's submission authorization reference)"] };
  let plan: PlanRec;
  try { plan = currentPlan(readPlans(baseDir), planRef.planId, jobId, planRef.planHash); }
  catch (error) { return { ok: false, errors: [error instanceof Error ? error.message : String(error)] }; }
  if (plan.status !== "approved")
    return { ok: false, errors: [`E_KEY_UNAPPROVED: plan ${planRef.planId} is ${plan.status}, not approved; an attempt requires an approved plan`] };
  if (plan.resumeVersion !== resumeVersion)
    return { ok: false, errors: [`E_SCHEMA: resumeVersion ${resumeVersion} does not match plan ${planRef.planId} (${plan.resumeVersion})`] };
  let checkpoints: CheckpointRec[];
  try { checkpoints = readCheckpointFile(baseDir).checkpoints as CheckpointRec[]; }
  catch (error) { return { ok: false, errors: [error instanceof Error ? error.message : String(error)] }; }
  if (!hasPassedPreSubmit(checkpoints, jobId, planRef.planId, planRef.planHash))
    return { ok: false, errors: ["E_GUARD:no-passed-pre-submit-checkpoint: a passed pre-submit checkpoint for the current plan is required before an attempt"] };
  const computedSetHash = checkpointSetHashOf(checkpoints, jobId, planRef.planId, planRef.planHash);
  if (computedSetHash !== checkpointSetHash)
    return { ok: false, errors: [`E_CHECKPOINT_STALE: checkpointSetHash does not match the current valid checkpoint set for plan ${planRef.planId}`] };
  let summary = "";
  const result = commitFiles(baseDir, cs.taskId, ["attempts.json", "changelog.json"], () => {
    jobSubmissionGuard(baseDir, jobId);
    const data = readAttemptFile(baseDir);
    if (data.attempts.some((a) => a.attemptId === attemptId))
      throw new Error(`E_DUPLICATE: attempt ${attemptId} already exists`);
    const open = data.attempts.find((a) => a.jobId === jobId && (OPEN_ATTEMPT_STATUSES as readonly string[]).includes(a.status));
    if (open) throw new Error(`E_ATTEMPT_OPEN: job ${jobId} already has an open attempt ${open.attemptId} (${open.status}); resolve it before recording a new attempt`);
    data.attempts.push({
      attemptId,
      jobId,
      runId,
      activityId: typeof activityId === "string" ? activityId : null,
      planId: planRef.planId,
      planHash: planRef.planHash,
      resumeVersion,
      checkpointSetHash,
      approvalRef,
      status: "recorded",
      outcome: null,
      evidence: [],
      applicationId: null,
      history: [{ at: stamp, action: "recorded", byTaskId: cs.taskId }],
      taskId: cs.taskId,
      createdAt: stamp,
      updatedAt: stamp,
    });
    const version = data.version + 1;
    writeFileSync(path.join(baseDir, "data", "attempts.json"), canonicalJson({ ...data, version, updatedAt: stamp }), "utf-8");
    writeChangelogEntry(baseDir, stamp, "attempt-recorded", "attempts.json", version, `${cs.taskId} ${attemptId} job ${jobId} recorded`);
    summary = `ATTEMPT_RECORDED ${attemptId} recorded`;
  });
  if (!result.ok) return result;
  return { ok: true, summary };
}

export function applyAttemptResolved(baseDir: string, cs: GenericChangeSet): EventResult {
  const bad = preamble(baseDir, cs);
  if (bad) return bad;
  const stamp = cs.createdAt;
  const p = cs.payload as Record<string, unknown>;
  const attemptId = p.attemptId;
  if (!isSafeId(attemptId)) return { ok: false, errors: ["E_SCHEMA: payload.attemptId missing or unsafe"] };
  const outcome = p.outcome;
  if (typeof outcome !== "string" || !(ATTEMPT_OUTCOMES as readonly string[]).includes(outcome))
    return { ok: false, errors: [`E_SCHEMA: payload.outcome must be one of ${ATTEMPT_OUTCOMES.join(", ")}`] };
  const rawEvidence = Array.isArray(p.evidence) ? p.evidence : (cs.evidence ?? []);
  const evidence = (rawEvidence as unknown[])
    .filter((e): e is { kind: string; text: string } => !!e && typeof e === "object" && typeof (e as { kind?: unknown }).kind === "string" && typeof (e as { text?: unknown }).text === "string")
    .map((e) => ({ kind: e.kind, text: e.text }));
  let summary = "";
  const result = commitFiles(baseDir, cs.taskId, ["attempts.json", "changelog.json"], () => {
    const data = readAttemptFile(baseDir);
    const attempt = data.attempts.find((a) => a.attemptId === attemptId);
    if (!attempt) throw new Error(`E_REF_INVALID: attempt ${attemptId} not found`);
    const allowed = ATTEMPT_TRANSITIONS[attempt.status] ?? [];
    if (!allowed.includes(outcome))
      throw new Error(`E_GUARD:invalid-transition: attempt ${attemptId} is ${attempt.status}; outcome ${outcome} is not allowed from here`);
    if ((outcome === "confirmed" || outcome === "resolved-confirmed") && !evidence.some((e) => e.text.trim() !== ""))
      throw new Error(`E_EVIDENCE_MISSING: outcome ${outcome} needs evidence (confirmation page, confirmation email, or site application history)`);
    attempt.status = outcome;
    attempt.outcome = outcome;
    if (evidence.length > 0) attempt.evidence = evidence;
    attempt.history = [...(attempt.history ?? []), { at: stamp, action: outcome, byTaskId: cs.taskId }];
    attempt.updatedAt = stamp;
    const version = data.version + 1;
    writeFileSync(path.join(baseDir, "data", "attempts.json"), canonicalJson({ ...data, version, updatedAt: stamp }), "utf-8");
    writeChangelogEntry(baseDir, stamp, "attempt-resolved", "attempts.json", version, `${cs.taskId} ${attemptId} -> ${outcome}`);
    summary = `ATTEMPT_RESOLVED ${attemptId} ${outcome}`;
  });
  if (!result.ok) return result;
  return { ok: true, summary };
}
