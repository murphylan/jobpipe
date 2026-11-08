import { validateContextReference } from "./agent-context.ts";
import { atomicWriteFileSync as writeFileSync } from "./storage.ts";
// Stage 5 events (Doc-07): AGENT_ACTIVITY and AGENT_WAITING,
// plus the daemon-side application of a console waiting answer
// and a console deletion request. All follow the same commit
// pattern as events.ts: backup -> journal -> write ->
// validate -> commit journal, restore on any failure. The
// daemon owns receipts, run records, and inbox moves; these
// functions only write the data files and the changelog entry.
//
// AGENT_ACTIVITY appends one feed entry to data/activity.json.
// The same activityId may repeat: a later entry supersedes
// an earlier one and the view takes the latest, so a running
// activity is closed by a later done/failed entry, never by
// mutating the old row in place. Since v3 every new activity
// event must carry a stage (one of the six Doc-00 pipeline
// stages); entries written before v3 have no stage and the
// view falls back to a kind mapping, never a rewrite.
// AGENT_WAITING appends one open question to data/waiting.json.
// Its status flips only through applyWaitingAnswer, which the
// daemon calls for a console decision file, never directly
// from the inbox.
// Deletion (v2) removes a completed activity (all entries of
// one activityId) or a closed waiting item, only through
// applyDeletion, which the daemon calls for a console
// decision-delete file, never directly from the inbox.
// Deletion (v3, 2026-11-09): an activity whose job is already
// terminal (applied/dropped) is also deletable even when its own
// latest entry is not done/failed — such activities are orphaned
// when a job-level decision (e.g. a USER_DECIDED drop) lands on a
// different run and no closing report ever arrives.
import { existsSync } from "node:fs";
import path from "node:path";
import { commitFiles, readJsonFile, type EventResult, type GenericChangeSet } from "./events.ts";
import { activityFileSchema, waitingFileSchema } from "./schema.ts";
import { canonicalJson } from "./serialize.ts";
import { ACTIVITY_LEASE_MS, checkActivityTransition, safeId, validTime, type RuntimeActivity } from "./activity-lifecycle.ts";
import { readReceipt } from "./receipt.ts";
import { hasApplicationProof } from "./application-proof.ts";

export const ACTIVITY_KINDS = ["screening", "applying", "gmail-check", "recording", "other"] as const;
export const ACTIVITY_STAGES = ["discovery", "screening", "tailoring", "review", "apply", "ledger"] as const;
export const ACTIVITY_STATUSES = ["running", "done", "waiting", "failed"] as const;
export const ACTIVITY_EVIDENCE_KINDS = ["browser-report", "gmail-message", "confirmation-page", "screen-record", "receipt"] as const;
export const WAITING_KINDS = ["question", "approval", "manual-step"] as const;
/** Structured question taxonomy (execution protocol stage B, 2026-11-08). */
export const WAITING_CATEGORIES = ["missing-fact", "conflict", "approval", "user-action"] as const;
export const WAITING_ANSWER_SCOPES = ["once", "standing"] as const;

/** A waiting/activity id that is safe to use as a file basename. */
export function isSafeId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) && !id.includes("..");
}

type ActivityFile = { activities: Record<string, unknown>[]; version: number; updatedAt: string };
type WaitingFile = { items: Record<string, unknown>[]; version: number; updatedAt: string };

function readActivityFile(baseDir: string): ActivityFile {
  const full = path.join(baseDir, "data", "activity.json");
  if (!existsSync(full)) return { activities: [], version: 0, updatedAt: "" };
  const parsed = activityFileSchema.safeParse(readJsonFile(full));
  if (!parsed.success) throw new Error("activity.json: invalid");
  return parsed.data as ActivityFile;
}

function readWaitingFile(baseDir: string): WaitingFile {
  const full = path.join(baseDir, "data", "waiting.json");
  if (!existsSync(full)) return { items: [], version: 0, updatedAt: "" };
  const parsed = waitingFileSchema.safeParse(readJsonFile(full));
  if (!parsed.success) throw new Error("waiting.json: invalid");
  return parsed.data as WaitingFile;
}

function writeChangelogEntry(baseDir: string, stamp: string, action: string, target: string, version: number, note: string): void {
  const changelogPath = path.join(baseDir, "data", "changelog.json");
  const parsed = existsSync(changelogPath)
    ? (readJsonFile(changelogPath) as { entries: Record<string, unknown>[]; version: number })
    : { entries: [], version: 0 };
  parsed.entries.push({ at: stamp, action, target, version, note });
  writeFileSync(changelogPath, canonicalJson({ ...parsed, version: parsed.version + 1, updatedAt: stamp }), "utf-8");
}

export function applyAgentActivity(baseDir: string, cs: GenericChangeSet): EventResult {
  const stamp = cs.createdAt;
  try { validateContextReference(baseDir, cs.payload); } catch (error) { return { ok: false, errors: [error instanceof Error ? error.message : String(error)] }; }
  if (!validTime(stamp) || !safeId(cs.taskId))
    return { ok: false, errors: ["E_SCHEMA: valid createdAt and safe taskId required"] };
  if (!cs.payload || typeof cs.payload !== "object" || Array.isArray(cs.payload))
    return { ok: false, errors: ["E_SCHEMA: payload must be an object"] };
  const p = cs.payload as Record<string, unknown>;
  if (p.jobId !== undefined && !safeId(p.jobId))
    return { ok: false, errors: ["E_SCHEMA: payload.jobId must be safe"] };
  if (p.scope !== undefined && p.scope !== "job" && p.scope !== "batch")
    return { ok: false, errors: ["E_SCHEMA: activity scope must be job or batch"] };
  const activityId = p.activityId;
  if (!isSafeId(activityId)) return { ok: false, errors: ["E_SCHEMA: payload.activityId missing or unsafe"] };
  const kind = p.kind;
  if (typeof kind !== "string" || !(ACTIVITY_KINDS as readonly string[]).includes(kind))
    return { ok: false, errors: ["E_SCHEMA: payload.kind must be one of screening, applying, gmail-check, recording, other"] };
  const stage = p.stage;
  if (typeof stage !== "string" || !(ACTIVITY_STAGES as readonly string[]).includes(stage))
    return { ok: false, errors: ["E_SCHEMA: payload.stage must be one of discovery, screening, tailoring, review, apply, ledger"] };
  const status = p.status;
  if (typeof status !== "string" || !(ACTIVITY_STATUSES as readonly string[]).includes(status))
    return { ok: false, errors: ["E_SCHEMA: payload.status must be one of running, done, waiting, failed"] };
  const title = p.title;
  if (typeof title !== "string" || title.trim() === "")
    return { ok: false, errors: ["E_SCHEMA: payload.title missing"] };
  const note = p.note;
  if (note !== undefined && (typeof note !== "string" || [...note].length > 300))
    return { ok: false, errors: ["E_SCHEMA: payload.note must be a string of at most 300 characters"] };
  const refs = p.refs;
  if (refs !== undefined && (!Array.isArray(refs) || refs.some((r) => typeof r !== "string")))
    return { ok: false, errors: ["E_SCHEMA: payload.refs must be an array of strings"] };
  if (cs.evidence !== undefined && (!Array.isArray(cs.evidence) || cs.evidence.some((e) =>
    !e || typeof e !== "object" || typeof e.kind !== "string" || typeof e.text !== "string")))
    return { ok: false, errors: ["E_SCHEMA: evidence must contain kind/text objects"] };
  if ((p.runId !== undefined && !safeId(p.runId)) ||
      (p.runId === undefined ? p.sequence !== undefined : !Number.isSafeInteger(p.sequence) || Number(p.sequence) < 0) ||
      (p.restartOf !== undefined && !safeId(p.restartOf)))
    return { ok: false, errors: ["E_SCHEMA: runId requires a nonnegative integer sequence; restartOf must be safe"] };
  for (const field of ["startedAt", "finishedAt", "leaseExpiresAt"]) {
    if (field === "finishedAt" && p[field] === null) continue;
    if (p[field] !== undefined && !validTime(p[field]))
      return { ok: false, errors: [`E_SCHEMA: invalid ${field}`] };
  }
  if (p.leaseExpiresAt !== undefined && (status !== "running" || Date.parse(String(p.leaseExpiresAt)) <= Date.parse(stamp) ||
      Date.parse(String(p.leaseExpiresAt)) > Date.parse(stamp) + ACTIVITY_LEASE_MS))
    return { ok: false, errors: ["E_SCHEMA: running lease must expire within five minutes of createdAt"] };
  if (status === "done") {
    const hasEvidence = (cs.evidence ?? []).some(
      (e) => (ACTIVITY_EVIDENCE_KINDS as readonly string[]).includes(e.kind) && typeof e.text === "string" && e.text.trim() !== "",
    );
    if (!hasEvidence) return { ok: false, errors: ["E_EVIDENCE_MISSING: done activity needs at least one evidence entry"] };
    // 2026-11-05: apply-stage done must reference the business event receipt.
    // Prevents "activity says done but job is still approved" phantom completions.
    if (stage === "apply") {
      const hasRef = Array.isArray(refs) && refs.length > 0 && refs.every((r) => typeof r === "string" && r.trim() !== "");
      if (!hasRef)
        return { ok: false, errors: ["E_REF_MISSING: apply-stage done must have payload.refs referencing the business event receipt taskId (e.g. APPLICATION_SUBMITTED)"] };
      const validReceipt = refs.some((ref) => {
        if (!safeId(ref)) return false;
        const receipt = readReceipt(baseDir, ref);
        return receipt?.taskId === ref && receipt.event === "APPLICATION_SUBMITTED" &&
          (receipt.status === "committed" || receipt.status === "verified");
      });
      if (!validReceipt) return { ok: false, errors: ["E_REF_INVALID: apply done requires a committed/verified APPLICATION_SUBMITTED receipt"] };
      if (!safeId(p.jobId) || !hasApplicationProof(baseDir, p.jobId, refs))
        return { ok: false, errors: ["E_BUSINESS_PROOF: apply done requires jobId and matching application/confirmed ledger/receipt"] };
    }
  }
  let summary = "";
  const result = commitFiles(baseDir, cs.taskId, ["activity.json", "changelog.json"], () => {
    const data = readActivityFile(baseDir);
    const history = data.activities.filter((entry) => entry.activityId === activityId);
    const previous = history.at(-1);
    const jobId = p.jobId ?? previous?.jobId;
    const scope = p.scope ?? previous?.scope ?? (jobId ? "job" : undefined);
    if (previous?.scope && scope !== previous.scope) throw new Error("E_GUARD: activity cannot change scope");
    if (scope === "job" && !jobId) throw new Error("E_SCHEMA: job scope requires jobId");
    if (scope === "batch" && (jobId || stage === "apply" || kind === "applying")) throw new Error("E_SCHEMA: batch scope cannot replace job-scoped application activity");
    if (previous?.jobId && jobId !== previous.jobId) throw new Error("E_REF_INVALID: activity cannot change its jobId");
    if (jobId !== undefined) {
      const jobs = readJsonFile(path.join(baseDir, "data/jobs.json")) as { jobs: { id: string }[] };
      if (!jobs.jobs.some((job) => job.id === jobId)) throw new Error("E_REF_INVALID: activity job not found");
    }
    const next = {
      status, taskId: cs.taskId, createdAt: stamp,
      ...(typeof p.runId === "string" ? { runId: p.runId, sequence: Number(p.sequence) } : {}),
    };
    checkActivityTransition(history as RuntimeActivity[], next, p.restartOf);
    const sameRun = previous && previous.runId === p.runId;
    const startedAt = typeof p.startedAt === "string" ? p.startedAt : sameRun ? String(previous.startedAt) : stamp;
    const terminal = status === "done" || status === "failed";
    const finishedAt = terminal ? (typeof p.finishedAt === "string" ? p.finishedAt : stamp) : null;
    if (!validTime(startedAt) || Date.parse(startedAt) > Date.parse(stamp) ||
        (sameRun && startedAt !== previous.startedAt) ||
        (finishedAt !== null && Date.parse(finishedAt) < Date.parse(startedAt)) ||
        (!terminal && typeof p.finishedAt === "string"))
      throw new Error("E_LIFECYCLE: invalid start/finish time or changed run start");
    data.activities.push({
      activityId,
      ...(jobId !== undefined ? { jobId } : {}),
      kind,
      stage,
      ...(p.contextTaskId !== undefined ? { contextTaskId: p.contextTaskId, contextDigest: p.contextDigest } : {}),
      title,
      status,
      startedAt,
      finishedAt,
      ...(scope ? { scope } : {}),
      ...(typeof p.runId === "string" ? { runId: p.runId, sequence: p.sequence } : {}),
      ...(p.restartOf !== undefined ? { restartOf: p.restartOf } : {}),
      ...(status === "running" ? { leaseExpiresAt: p.leaseExpiresAt ?? new Date(Date.parse(stamp) + ACTIVITY_LEASE_MS).toISOString() } : {}),
      refs: Array.isArray(refs) ? refs : [],
      note: typeof note === "string" ? note : "",
      evidence: Array.isArray(cs.evidence) ? cs.evidence.filter((e) => typeof e.kind === "string" && typeof e.text === "string") : [],
      taskId: cs.taskId,
      createdAt: stamp,
    });
    const version = data.version + 1;
    writeFileSync(path.join(baseDir, "data", "activity.json"), canonicalJson({ ...data, version, updatedAt: stamp }), "utf-8");
    writeChangelogEntry(baseDir, stamp, "agent-activity", "activity.json", version, `${cs.taskId} ${activityId} ${status}`);
    summary = `AGENT_ACTIVITY ${activityId} ${status}`;
  });
  if (!result.ok) return result;
  return { ok: true, summary };
}

export function applyAgentWaiting(baseDir: string, cs: GenericChangeSet): EventResult {
  const stamp = cs.createdAt;
  const p = cs.payload as Record<string, unknown>;
  const waitingId = p.waitingId;
  if (!isSafeId(waitingId)) return { ok: false, errors: ["E_SCHEMA: payload.waitingId missing or unsafe"] };
  const question = p.question;
  if (typeof question !== "string" || question.trim() === "")
    return { ok: false, errors: ["E_SCHEMA: payload.question missing"] };
  const context = p.context;
  if (context !== undefined && (!Array.isArray(context) || context.some((c) => typeof c !== "string")))
    return { ok: false, errors: ["E_SCHEMA: payload.context must be an array of strings"] };
  const kind = p.kind === undefined ? "question" : p.kind;
  if (typeof kind !== "string" || !(WAITING_KINDS as readonly string[]).includes(kind))
    return { ok: false, errors: ["E_SCHEMA: payload.kind must be one of question, approval, manual-step"] };
  const sourceActivityId = p.sourceActivityId;
  if (sourceActivityId !== undefined && typeof sourceActivityId !== "string")
    return { ok: false, errors: ["E_SCHEMA: payload.sourceActivityId must be a string"] };
  if (p.jobId !== undefined && !safeId(p.jobId)) return { ok: false, errors: ["E_SCHEMA: invalid waiting jobId"] };
  // Structured question fields (stage B): all optional so legacy
  // free-text questions keep working; when present they must be
  // well-formed so the console can aggregate and route answers.
  const category = p.category;
  if (category !== undefined && (typeof category !== "string" || !(WAITING_CATEGORIES as readonly string[]).includes(category)))
    return { ok: false, errors: [`E_SCHEMA: payload.category must be one of ${WAITING_CATEGORIES.join(", ")}`] };
  const factKey = p.factKey;
  if (factKey !== undefined && (typeof factKey !== "string" || factKey.trim() === ""))
    return { ok: false, errors: ["E_SCHEMA: payload.factKey must be a non-empty string"] };
  const fieldRef = p.fieldRef;
  if (fieldRef !== undefined &&
    (!fieldRef || typeof fieldRef !== "object" || Array.isArray(fieldRef) ||
      Object.values(fieldRef as Record<string, unknown>).some((v) => typeof v !== "string")))
    return { ok: false, errors: ["E_SCHEMA: payload.fieldRef must be an object of strings"] };
  for (const listField of ["checkedSources", "candidates"] as const) {
    const v = p[listField];
    if (v !== undefined && (!Array.isArray(v) || v.some((x) => typeof x !== "string")))
      return { ok: false, errors: [`E_SCHEMA: payload.${listField} must be an array of strings`] };
  }
  const blocksStep = p.blocksStep;
  if (blocksStep !== undefined && typeof blocksStep !== "string")
    return { ok: false, errors: ["E_SCHEMA: payload.blocksStep must be a string"] };
  let summary = "";
  const result = commitFiles(baseDir, cs.taskId, ["waiting.json", "changelog.json"], () => {
    const data = readWaitingFile(baseDir);
    const source = typeof sourceActivityId === "string" ? readActivityFile(baseDir).activities.findLast((a) => a.activityId === sourceActivityId) : undefined;
    const jobId = p.jobId ?? source?.jobId;
    if (source?.jobId && source.jobId !== jobId) throw new Error("E_REF_INVALID: waiting jobId differs from source activity");
    if (jobId !== undefined) {
      const jobs = readJsonFile(path.join(baseDir, "data/jobs.json")) as { jobs: { id: string }[] };
      if (!jobs.jobs.some((j) => j.id === jobId)) throw new Error("E_REF_INVALID: waiting job not found");
    }
    if (data.items.some((i) => i.waitingId === waitingId))
      throw new Error(`E_DUPLICATE: waiting ${waitingId} already exists`);
    data.items.push({
      waitingId,
      ...(jobId !== undefined ? { jobId } : {}),
      question,
      context: Array.isArray(context) ? context : [],
      kind,
      ...(typeof category === "string" ? { category } : {}),
      ...(typeof factKey === "string" ? { factKey } : {}),
      ...(fieldRef !== undefined ? { fieldRef } : {}),
      ...(Array.isArray(p.checkedSources) ? { checkedSources: p.checkedSources } : {}),
      ...(Array.isArray(p.candidates) ? { candidates: p.candidates } : {}),
      ...(typeof blocksStep === "string" ? { blocksStep } : {}),
      status: "open",
      createdAt: stamp,
      sourceActivityId: typeof sourceActivityId === "string" ? sourceActivityId : null,
      answer: null,
      answeredAt: null,
      answerScope: null,
      taskId: cs.taskId,
    });
    const version = data.version + 1;
    writeFileSync(path.join(baseDir, "data", "waiting.json"), canonicalJson({ ...data, version, updatedAt: stamp }), "utf-8");
    writeChangelogEntry(baseDir, stamp, "agent-waiting", "waiting.json", version, `${cs.taskId} waiting ${waitingId}`);
    summary = `AGENT_WAITING ${waitingId}`;
  });
  if (!result.ok) return result;
  return { ok: true, summary };
}

/**
 * Apply a console waiting answer (daemon decision branch only).
 * The waiting item must exist and be open; an answer action
 * needs a non-empty answer, a park action may carry a reason
 * or nothing. Never called from the inbox path.
 */
export function applyWaitingAnswer(baseDir: string, waitingId: string, action: string, answer: string, stamp: string, scope: string = "once"): EventResult {
  if (!isSafeId(waitingId)) return { ok: false, errors: ["E_SCHEMA: waitingId missing or unsafe"] };
  if (action !== "answer" && action !== "park") return { ok: false, errors: ["E_SCHEMA: action must be answer or park"] };
  if (action === "answer" && answer.trim() === "") return { ok: false, errors: ["E_SCHEMA: answer action needs a non-empty answer"] };
  if (!(WAITING_ANSWER_SCOPES as readonly string[]).includes(scope))
    return { ok: false, errors: [`E_SCHEMA: scope must be one of ${WAITING_ANSWER_SCOPES.join(", ")}`] };
  let summary = "";
  const result = commitFiles(baseDir, `waiting-answer-${waitingId}`, ["waiting.json", "changelog.json"], () => {
    const data = readWaitingFile(baseDir);
    const item = data.items.find((i) => i.waitingId === waitingId);
    if (!item) throw new Error(`E_GUARD:waiting-not-found: no waiting item ${waitingId}`);
    if (item.status !== "open") throw new Error(`E_GUARD:waiting-not-open: waiting ${waitingId} is ${String(item.status)}`);
    // Facts may be reused; application approvals never carry over
    // (execution protocol stage B): an approval-category answer
    // cannot be recorded as a standing answer.
    if (action === "answer" && scope === "standing" && item.category === "approval")
      throw new Error("E_GUARD:approval-scope: approval answers cannot be standing");
    item.status = action === "answer" ? "answered" : "parked";
    item.answer = answer;
    item.answeredAt = stamp;
    if (action === "answer") item.answerScope = scope;
    const version = data.version + 1;
    writeFileSync(path.join(baseDir, "data", "waiting.json"), canonicalJson({ ...data, version, updatedAt: stamp }), "utf-8");
    writeChangelogEntry(baseDir, stamp, action === "answer" ? "waiting-answered" : "waiting-parked", "waiting.json", version, `waiting ${waitingId} -> ${String(item.status)}`);
    summary = `WAITING ${waitingId} -> ${String(item.status)}`;
  });
  if (!result.ok) return result;
  return { ok: true, summary };
}

/** Job statuses that end a job's lifecycle; an activity left open
 * against such a job is orphaned and may be deleted even though
 * its own latest entry is not done/failed. */
const TERMINAL_JOB_STATUSES = new Set(["applied", "dropped"]);

function jobIsTerminal(baseDir: string, jobId: string): boolean {
  const full = path.join(baseDir, "data", "jobs.json");
  if (!existsSync(full)) return false;
  const data = readJsonFile(full) as { jobs?: { id?: unknown; status?: unknown }[] };
  return Array.isArray(data.jobs) && data.jobs.some((j) => j.id === jobId && TERMINAL_JOB_STATUSES.has(String(j.status)));
}

/**
 * Apply a console deletion request (daemon decision branch
 * only). An activity deletes when its latest entry is done or
 * failed — or when its job is already terminal (applied or
 * dropped), which leaves the still-open activity orphaned —
 * and then all entries of that activityId go; a waiting item
 * deletes only when answered or parked.
 * Never called from the inbox path. The changelog entry and
 * the receipt keep the audit trail; only the feed/queue row
 * is removed.
 */
export function applyDeletion(baseDir: string, scope: string, id: string, stamp: string): EventResult {
  if (scope !== "activity" && scope !== "waiting") return { ok: false, errors: ["E_SCHEMA: scope must be activity or waiting"] };
  if (!isSafeId(id)) return { ok: false, errors: ["E_SCHEMA: id missing or unsafe"] };
  let summary = "";
  const files = scope === "activity" ? ["activity.json", "changelog.json"] : ["waiting.json", "changelog.json"];
  const result = commitFiles(baseDir, `delete-${scope}-${id}`, files, () => {
    if (scope === "activity") {
      const data = readActivityFile(baseDir);
      const latest = new Map<string, Record<string, unknown>>();
      for (const e of data.activities) latest.set(String(e.activityId), e);
      const entry = latest.get(id);
      if (!entry) throw new Error(`E_GUARD:activity-not-found: no activity ${id}`);
      if (entry.status !== "done" && entry.status !== "failed") {
        const jobId = typeof entry.jobId === "string" ? entry.jobId : "";
        if (!jobId || !jobIsTerminal(baseDir, jobId))
          throw new Error(`E_GUARD:activity-not-completed: activity ${id} is ${String(entry.status)}`);
      }
      data.activities = data.activities.filter((e) => e.activityId !== id);
      const version = data.version + 1;
      writeFileSync(path.join(baseDir, "data", "activity.json"), canonicalJson({ ...data, version, updatedAt: stamp }), "utf-8");
      writeChangelogEntry(baseDir, stamp, "activity-deleted", "activity.json", version, `delete activity ${id}`);
      summary = `ACTIVITY_DELETED ${id}`;
      return;
    }
    const data = readWaitingFile(baseDir);
    const item = data.items.find((i) => i.waitingId === id);
    if (!item) throw new Error(`E_GUARD:waiting-not-found: no waiting item ${id}`);
    if (item.status !== "answered" && item.status !== "parked")
      throw new Error(`E_GUARD:waiting-not-closed: waiting ${id} is ${String(item.status)}`);
    data.items = data.items.filter((i) => i.waitingId !== id);
    const version = data.version + 1;
    writeFileSync(path.join(baseDir, "data", "waiting.json"), canonicalJson({ ...data, version, updatedAt: stamp }), "utf-8");
    writeChangelogEntry(baseDir, stamp, "waiting-deleted", "waiting.json", version, `delete waiting ${id}`);
    summary = `WAITING_DELETED ${id}`;
  });
  if (!result.ok) return result;
  return { ok: true, summary };
}
