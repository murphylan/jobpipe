import { atomicCreateFileSync } from "./storage.ts";
// Stage 4 console data layer (Doc-06).
// Pure reads over data/ plus the single sanctioned write: a
// decision file in data/inbox/decisions/. Nothing here
// touches a business data file (jobs, applications, ledger,
// daily, etc.); the engine is the only writer of those.
// All readers are lenient: a missing or corrupt file yields
// an empty list or null, never a throw, so the console can
// always render and say what is missing.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { displayStage, STAGE_IDS } from "../activity-display.ts";
import { runtimeStatus } from "./activity-lifecycle.ts";
import { UNCERTAIN_AFTER_MS } from "./events6.ts";
import { readTaskState } from "./task-state.ts";
import type { BusinessTask } from "../task-state.ts";
import { chicagoToday } from "../ledger.ts";
import { detectExternalModifications } from "./external.ts";
import { readHeartbeatStatus, type HeartbeatStatus } from "./heartbeat.ts";
import { readReceipt, type Receipt } from "./receipt.ts";
import { canonicalJson } from "./serialize.ts";
import { readState } from "./state.ts";
import { validateDataDir, type ValidationResult } from "./validate.ts";

export type RunRecord = {
  taskId: string;
  event: string;
  status: string;
  summary: string;
  finishedAt: string;
};

/** A taskId that is safe to use as a file basename. */
export { isSafeTaskId } from "./envelope.ts";
import { isSafeTaskId } from "./envelope.ts";

function readJsonLenient<T>(full: string): T | null {
  if (!existsSync(full)) return null;
  try {
    return JSON.parse(readFileSync(full, "utf-8")) as T;
  } catch {
    return null;
  }
}

function isRunRecord(v: unknown): v is RunRecord {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.taskId === "string" &&
    typeof r.event === "string" &&
    typeof r.status === "string" &&
    typeof r.summary === "string" &&
    typeof r.finishedAt === "string"
  );
}

/** All run records, newest first. Unparsable files are skipped. */
export function listRuns(baseDir: string): RunRecord[] {
  const dir = path.join(baseDir, "data", "runs");
  if (!existsSync(dir)) return [];
  const out: RunRecord[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const run = readJsonLenient<unknown>(path.join(dir, file));
    if (isRunRecord(run)) out.push(run);
  }
  out.sort((a, b) => (b.finishedAt < a.finishedAt ? -1 : b.finishedAt > a.finishedAt ? 1 : b.taskId < a.taskId ? -1 : 1));
  return out;
}

/** Pending-approval receipts, newest first. */
export function listPending(baseDir: string): Receipt[] {
  const dir = path.join(baseDir, "data", "receipts");
  if (!existsSync(dir)) return [];
  const out: Receipt[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const taskId = file.replace(/\.json$/, "");
    const receipt = readReceipt(baseDir, taskId);
    if (receipt && receipt.status === "pending-approval") out.push(receipt);
  }
  out.sort((a, b) => (b.createdAt < a.createdAt ? -1 : b.createdAt > a.createdAt ? 1 : b.taskId < a.taskId ? -1 : 1));
  return out;
}

export type RunDetail = {
  run: RunRecord | null;
  receipt: Receipt | null;
  receiptMd: string | null;
};

/** One run plus its receipt (json and md). Unsafe ids yield nulls, not a throw. */
export function readRunDetail(baseDir: string, taskId: string): RunDetail {
  if (!isSafeTaskId(taskId)) return { run: null, receipt: null, receiptMd: null };
  const run = readJsonLenient<unknown>(path.join(baseDir, "data", "runs", `${taskId}.json`));
  const receipt = readReceipt(baseDir, taskId);
  const mdPath = path.join(baseDir, "data", "receipts", `${taskId}.md`);
  const receiptMd = existsSync(mdPath) ? readFileSync(mdPath, "utf-8") : null;
  return { run: isRunRecord(run) ? run : null, receipt, receiptMd };
}

export type DecisionInput = { taskId: unknown; approved: unknown; quote: unknown };
export type DecisionResult = { ok: true; taskId: string } | { ok: false; reason: string };

/**
 * The console's only write. Guards, in order:
 * - taskId must be a safe basename (no traversal);
 * - a receipt must exist and be pending-approval (no
 *   decision for a task the engine is not holding);
 * - no decision file may already exist for the task;
 * - an approval must carry a non-empty user quote (T5).
 * The file lands in data/inbox/decisions/ and the engine
 * applies it on its next poll; this function never claims
 * the change is applied.
 */
export function writeDecision(baseDir: string, input: DecisionInput): DecisionResult {
  if (!isSafeTaskId(input.taskId)) return { ok: false, reason: "invalid-taskId" };
  if (typeof input.approved !== "boolean") return { ok: false, reason: "invalid-approved" };
  const receipt = readReceipt(baseDir, input.taskId);
  if (!receipt) return { ok: false, reason: "receipt-not-found" };
  if (receipt.status !== "pending-approval") return { ok: false, reason: "not-pending" };
  const destDir = path.join(baseDir, "data", "inbox", "decisions");
  const dest = path.join(destDir, `${input.taskId}.json`);
  if (existsSync(dest)) return { ok: false, reason: "already-decided" };
  const quote = typeof input.quote === "string" ? input.quote : "";
  if (input.approved && !quote.trim()) return { ok: false, reason: "quote-required" };
  mkdirSync(destDir, { recursive: true });
  if (!atomicCreateFileSync(
    dest,
    canonicalJson({ taskId: input.taskId, approved: input.approved, quote, decidedAt: new Date().toISOString() }),
  )) return { ok: false, reason: "already-decided" };
  return { ok: true, taskId: input.taskId };
}

export type EngineStatus = {
  heartbeat: HeartbeatStatus;
  lastTaskId: string | null;
  stateUpdatedAt: string | null;
  validation: ValidationResult;
  external: { stateMissing: boolean; mismatches: string[] };
  today: string;
  todayRow: Record<string, number> | null;
};

/** Everything the status view needs, in one read. */
export function loadEngineStatus(baseDir: string, nowMs: number = Date.now()): EngineStatus {
  const heartbeat = readHeartbeatStatus(baseDir, nowMs);
  const state = readState(baseDir) as { lastTaskId?: unknown; updatedAt?: unknown } | null;
  const today = chicagoToday();
  const daily = readJsonLenient<{ days?: Record<string, Record<string, number>> }>(path.join(baseDir, "data", "daily.json"));
  return {
    heartbeat,
    lastTaskId: typeof state?.lastTaskId === "string" ? state.lastTaskId : null,
    stateUpdatedAt: typeof state?.updatedAt === "string" ? state.updatedAt : null,
    validation: validateDataDir(baseDir, today),
    external: detectExternalModifications(baseDir),
    today,
    todayRow: daily?.days?.[today] ?? null,
  };
}

/** The registry yaml as text, for the read-only registry view. Null when absent. */
export function readRegistryText(repoDir: string): string | null {
  const full = path.join(repoDir, "lib", "engine", "registry.yaml");
  if (!existsSync(full)) return null;
  return readFileSync(full, "utf-8");
}

// Activity console (Doc-07) readers and the sanctioned writes.
// Same lenient-reader rule as above: a missing or corrupt
// activity/waiting file yields an empty list, never a throw,
// so the console can always render and say what is missing.
// Since v3, entries carry a stage; pre-v3 entries have none
// and listActivity normalizes them to stage null, leaving
// the kind-to-stage display mapping to the view layer.

export type ActivityEntry = {
  scope?: "job" | "batch";
  activityId: string;
  jobId?: string;
  businessStage?: string | null;
  runtimeDetail?: string;
  jobCompany?: string;
  jobRole?: string;
  jobChannel?: string;
  kind: string;
  stage: string | null;
  title: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  refs: string[];
  note: string;
  evidence: { kind: string; text: string }[];
  taskId: string;
  createdAt: string;
  runId?: string;
  sequence?: number;
  leaseExpiresAt?: string;
  recordedStatus?: string;
};

export type WaitingItem = {
  waitingId: string;
  jobId?: string;
  question: string;
  context: string[];
  kind: string;
  // Structured question fields (execution protocol stage B).
  // Absent on legacy free-text items.
  category?: string;
  factKey?: string;
  fieldRef?: Record<string, string>;
  checkedSources?: string[];
  candidates?: string[];
  blocksStep?: string;
  status: string;
  createdAt: string;
  sourceActivityId: string | null;
  sourceStage: string | null;
  answer: string | null;
  answeredAt: string | null;
  answerScope?: string | null;
  /** answered but the source run has not visibly resumed yet. */
  resumeState?: "answered-pending-resume" | "resumed" | null;
  taskId: string;
};

function isActivityEntry(v: unknown): v is ActivityEntry {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.activityId === "string" &&
    typeof r.kind === "string" &&
    typeof r.title === "string" &&
    typeof r.status === "string" &&
    typeof r.startedAt === "string" &&
    (typeof r.finishedAt === "string" || r.finishedAt === null) &&
    Array.isArray(r.refs) &&
    typeof r.note === "string" &&
    typeof r.taskId === "string" &&
    typeof r.createdAt === "string"
  );
}

function normalizeActivity(e: ActivityEntry): ActivityEntry {
  const raw = e as unknown as Record<string, unknown>;
  return { ...e, stage: typeof raw.stage === "string" ? raw.stage : null };
}

function isWaitingItem(v: unknown): v is WaitingItem {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.waitingId === "string" &&
    typeof r.question === "string" &&
    Array.isArray(r.context) &&
    typeof r.kind === "string" &&
    typeof r.status === "string" &&
    typeof r.createdAt === "string" &&
    (typeof r.sourceActivityId === "string" || r.sourceActivityId === null) &&
    (typeof r.answer === "string" || r.answer === null) &&
    (typeof r.answeredAt === "string" || r.answeredAt === null) &&
    typeof r.taskId === "string"
  );
}

/** Latest entry per activityId, newest first. Unparsable entries are skipped. */
export function listActivity(baseDir: string, nowMs = Date.now()): ActivityEntry[] {
  const data = readJsonLenient<{ activities?: unknown }>(path.join(baseDir, "data", "activity.json"));
  const entries = Array.isArray(data?.activities) ? data.activities.filter(isActivityEntry).map(normalizeActivity) : [];
  const latest = new Map<string, ActivityEntry>();
  const tasks = new Map(readTaskState(baseDir, nowMs).tasks.map((t) => [t.jobId, t]));
  for (const e of entries) latest.set(e.activityId, e);
  return [...latest.values()].map((entry) => {
    const task = entry.jobId ? tasks.get(entry.jobId) : undefined;
    // 终态锁定（2026-11-07 定版）：已完成/失败的活动不被运行时投影改写状态与进展，
    // 迟到的 waiting 答复不得把已完成活动重新点亮为“等待中”。
    const terminal = entry.status === "done" || entry.status === "failed";
    const linked = !terminal && task?.runtime.activityId === entry.activityId;
    return { ...entry, businessStage: task?.businessStage ?? null,
      jobCompany: task?.company, jobRole: task?.role, jobChannel: task?.channel,
      runtimeDetail: linked ? task.runtime.detail : entry.note,
      recordedStatus: entry.status, status: linked ? task.runtime.status : runtimeStatus(entry, nowMs) };
  }).sort((a, b) =>
    b.createdAt < a.createdAt ? -1 : b.createdAt > a.createdAt ? 1 : b.activityId < a.activityId ? -1 : 1,
  );
}

/** Waiting items, open first, newest first within each status, each with its source activity's display stage. */
export function listWaiting(baseDir: string): WaitingItem[] {
  const data = readJsonLenient<{ items?: unknown }>(path.join(baseDir, "data", "waiting.json"));
  const items = Array.isArray(data?.items) ? data.items.filter(isWaitingItem) : [];
  const activities = listActivity(baseDir);
  const stageById = new Map(activities.map((a) => [a.activityId, displayStage(a.kind, a.stage)]));
  const latestById = new Map(activities.map((a) => [a.activityId, a]));
  const enriched: WaitingItem[] = items.map((i) => {
    // Answered-pending-resume (stage B): an answered item stays
    // visibly pending until its source activity posts a newer
    // non-waiting entry, i.e. the executor actually picked the
    // answer up. The answer alone never flips the run's state.
    let resumeState: WaitingItem["resumeState"] = null;
    if (i.status === "answered" && i.sourceActivityId) {
      const latest = latestById.get(i.sourceActivityId);
      if (latest) {
        resumeState =
          latest.status !== "waiting" && i.answeredAt !== null && latest.createdAt > i.answeredAt
            ? "resumed"
            : "answered-pending-resume";
      }
    }
    return {
      ...i,
      sourceStage: i.sourceActivityId ? (stageById.get(i.sourceActivityId) ?? null) : null,
      resumeState,
    };
  });
  const rank = (s: string) => (s === "open" ? 0 : 1);
  return enriched.sort(
    (a, b) =>
      rank(a.status) - rank(b.status) ||
      (b.createdAt < a.createdAt ? -1 : b.createdAt > a.createdAt ? 1 : a.waitingId < b.waitingId ? -1 : 1),
  );
}

export type WaitingGroup = {
  key: string;
  factKey: string | null;
  category: string;
  items: WaitingItem[];
  jobIds: string[];
};

/**
 * Aggregate open waiting items for the console queue (stage B).
 * Items sharing category + factKey merge into one group (the
 * same fact asked by several jobs is answered once); items
 * without a factKey, or with a different category, never merge.
 * Answered/parked items are not grouped; they stay individual.
 */
export function groupWaitingQuestions(items: WaitingItem[]): WaitingGroup[] {
  const groups = new Map<string, WaitingGroup>();
  for (const item of items) {
    if (item.status !== "open") continue;
    const category = item.category ?? (item.kind === "approval" ? "approval" : item.kind === "manual-step" ? "user-action" : "missing-fact");
    const key = item.factKey ? `${category}::${item.factKey}` : `single::${item.waitingId}`;
    const group = groups.get(key) ?? { key, factKey: item.factKey ?? null, category, items: [], jobIds: [] };
    group.items.push(item);
    if (item.jobId && !group.jobIds.includes(item.jobId)) group.jobIds.push(item.jobId);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) =>
    a.items[0].createdAt < b.items[0].createdAt ? -1 : a.items[0].createdAt > b.items[0].createdAt ? 1 : a.key < b.key ? -1 : 1,
  );
}

export type PlanRecord = {
  planId: string;
  jobId: string;
  runId: string;
  activityId: string | null;
  planVersion: number;
  resumeVersion: string;
  formUrl: string;
  fields: Record<string, unknown>[];
  approvalBasis: { kind: string; ref: string } | null;
  status: string;
  blockers: string[];
  planHash: string;
  taskId: string;
  createdAt: string;
};

function isPlanRecord(v: unknown): v is PlanRecord {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.planId === "string" &&
    typeof r.jobId === "string" &&
    typeof r.planVersion === "number" &&
    typeof r.status === "string" &&
    typeof r.planHash === "string" &&
    Array.isArray(r.fields) &&
    typeof r.createdAt === "string"
  );
}

/** All recorded plan versions, newest first. Lenient like every console reader. */
export function listPlans(baseDir: string): PlanRecord[] {
  const data = readJsonLenient<{ plans?: unknown }>(path.join(baseDir, "data", "plans.json"));
  const plans = Array.isArray(data?.plans) ? data.plans.filter(isPlanRecord) : [];
  return plans.sort((a, b) => (b.createdAt < a.createdAt ? -1 : b.createdAt > a.createdAt ? 1 : b.planId < a.planId ? -1 : 1));
}

/** The current (non-superseded) plan for one job, if any. */
export function latestPlanForJob(baseDir: string, jobId: string): PlanRecord | null {
  return listPlans(baseDir).find((p) => p.jobId === jobId && p.status !== "superseded") ?? null;
}

export type CheckpointRecord = {
  checkpointId: string;
  jobId: string;
  runId: string;
  activityId: string | null;
  planId: string;
  planHash: string;
  type: string;
  status: string;
  results: Record<string, unknown>[];
  missingKeyFields: string[];
  taskId: string;
  createdAt: string;
};

function isCheckpointRecord(v: unknown): v is CheckpointRecord {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.checkpointId === "string" &&
    typeof r.jobId === "string" &&
    typeof r.planId === "string" &&
    typeof r.type === "string" &&
    typeof r.status === "string" &&
    Array.isArray(r.results) &&
    typeof r.createdAt === "string"
  );
}

/** All recorded checkpoints, newest first. Lenient like every console reader. */
export function listCheckpoints(baseDir: string): CheckpointRecord[] {
  const data = readJsonLenient<{ checkpoints?: unknown }>(path.join(baseDir, "data", "checkpoints.json"));
  const checkpoints = Array.isArray(data?.checkpoints) ? data.checkpoints.filter(isCheckpointRecord) : [];
  return checkpoints.sort((a, b) => (b.createdAt < a.createdAt ? -1 : b.createdAt > a.createdAt ? 1 : b.checkpointId < a.checkpointId ? -1 : 1));
}

export type AttemptRecord = {
  attemptId: string;
  jobId: string;
  runId: string;
  activityId: string | null;
  planId: string;
  planHash: string;
  resumeVersion: string;
  checkpointSetHash: string;
  approvalRef: string;
  status: string;
  outcome: string | null;
  evidence: { kind: string; text: string }[];
  applicationId: string | null;
  history: { at: string; action: string; byTaskId: string }[];
  taskId: string;
  createdAt: string;
  updatedAt: string;
  effectiveStatus: string;
};

function isAttemptRecord(v: unknown): v is Omit<AttemptRecord, "effectiveStatus"> {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.attemptId === "string" &&
    typeof r.jobId === "string" &&
    typeof r.status === "string" &&
    typeof r.createdAt === "string" &&
    typeof r.updatedAt === "string"
  );
}

/**
 * All submission attempts, newest first. effectiveStatus is a read
 * projection (the stored record is never rewritten): an attempt
 * still "recorded" more than 30 minutes after the click window
 * opened reads as "uncertain-timeout" — the protocol's Engine-side
 * backstop for the uncertain-submission rule.
 */
export function listAttempts(baseDir: string, nowMs: number = Date.now()): AttemptRecord[] {
  const data = readJsonLenient<{ attempts?: unknown }>(path.join(baseDir, "data", "attempts.json"));
  const attempts = Array.isArray(data?.attempts) ? data.attempts.filter(isAttemptRecord) : [];
  return attempts
    .map((a) => ({
      ...a,
      effectiveStatus: a.status === "recorded" && nowMs - Date.parse(a.createdAt) > UNCERTAIN_AFTER_MS ? "uncertain-timeout" : a.status,
    }))
    .sort((a, b) => (b.createdAt < a.createdAt ? -1 : b.createdAt > a.createdAt ? 1 : b.attemptId < a.attemptId ? -1 : 1));
}

function chicagoDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

export type PendingInboxItem = { taskId: string; event: string; submittedAt: string };

/**
 * Files still sitting in data/inbox/ (processed files move to
 * data/processed/, and decisions/ is a subdir, not a file,
 * so it is never counted). Oldest first, at most 5 items;
 * the count covers every pending file. Lenient: a missing
 * dir yields an empty result, an unparsable file still
 * counts with event "unknown", never a throw.
 */
export function listPendingInbox(baseDir: string): { count: number; items: PendingInboxItem[] } {
  const dir = path.join(baseDir, "data", "inbox");
  if (!existsSync(dir)) return { count: 0, items: [] };
  const rows: (PendingInboxItem & { mtimeMs: number })[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const full = path.join(dir, file);
    let st: { isFile: () => boolean; mtimeMs: number } | null = null;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    let event = "unknown";
    let taskId = file.replace(/\.json$/, "");
    try {
      const parsed = JSON.parse(readFileSync(full, "utf-8")) as { taskId?: unknown; event?: unknown };
      if (typeof parsed.taskId === "string" && parsed.taskId) taskId = parsed.taskId;
      if (typeof parsed.event === "string" && parsed.event) event = parsed.event;
    } catch {
      /* keep unknown */
    }
    rows.push({ taskId, event, submittedAt: new Date(st.mtimeMs).toISOString(), mtimeMs: st.mtimeMs });
  }
  rows.sort((a, b) => a.mtimeMs - b.mtimeMs || (a.taskId < b.taskId ? -1 : 1));
  return { count: rows.length, items: rows.slice(0, 5).map(({ taskId, event, submittedAt }) => ({ taskId, event, submittedAt })) };
}

export type ActivityReporting = {
  lastActivityAt: string | null;
  missingProgress: boolean;
  recentBusiness: { taskId: string; event: string; summary: string; finishedAt: string }[];
};
/** Real committed business work is observable without inventing Agent running events. */
function readActivityReporting(baseDir: string, activities: ActivityEntry[], nowMs: number): ActivityReporting {
  const business = new Set(["DISCOVERED", "SCREENED", "TAILORED", "USER_DECIDED", "APPLICATION_SUBMITTED", "FOLLOWUP_RECEIVED"]);
  const recentBusiness = listRuns(baseDir).filter(run => run.status === "committed" && business.has(run.event) &&
    Number.isFinite(Date.parse(run.finishedAt)) && Date.parse(run.finishedAt) <= nowMs).filter(run => {
      try { const receipt = readReceipt(baseDir, run.taskId); return receipt?.event === run.event && ["committed", "verified"].includes(receipt.status); }
      catch { return false; }
    }).slice(0, 5).map(({ taskId, event, summary, finishedAt }) => ({ taskId, event, summary, finishedAt }));
  const times = activities.map(a => a.createdAt).filter(at => Number.isFinite(Date.parse(at)) && Date.parse(at) <= nowMs).sort((a, b) => Date.parse(b) - Date.parse(a));
  const lastActivityAt = times[0] ?? null;
  const newest = recentBusiness[0];
  const missingProgress = !!newest && nowMs - Date.parse(newest.finishedAt) < 15 * 60_000 &&
    (!lastActivityAt || Date.parse(newest.finishedAt) > Date.parse(lastActivityAt)) && !activities.some(a => a.status === "running");
  return { lastActivityAt, missingProgress, recentBusiness };
}

export type ActivityFeedQuery = {
  reporting: ActivityReporting;
  tasks: BusinessTask[];
  taskIssues: string[];
  activities: ActivityEntry[];
  selectedActivity: ActivityEntry | null;
  page: number;
  total: number;
  distribution: { running: number; waiting: number; done: number; failed: number; interrupted: number };
  overview: { totalToday: number; runningToday: number; openWaiting: number; submittedToday: number };
  stageCounts: Record<string, number>;
  /** Every latest entry still running (unfiltered, unpaged), newest first. */
  running: ActivityEntry[];
  /** Files Muse already submitted that the engine has not processed yet. */
  pendingInbox: { count: number; items: PendingInboxItem[] };
};

const STATUS_RANK: Record<string, number> = { running: 0, waiting: 1, interrupted: 2, done: 3, failed: 4 };

/**
 * Filtered, sorted, paged activity feed plus its counts.
 * Distribution counts cover the stage-filtered full list
 * (not the page slice, and independent of the status filter,
 * so the status chips always show the whole distribution
 * within the current stage). Overview counts are Chicago-
 * today scoped, except openWaiting, which is current.
 * Invalid sort/stage/status values fall back to no filter
 * (created-desc), never an error.
 */
export function queryActivityFeed(
  baseDir: string,
  opts: { sort?: string; stage?: string | null; status?: string | null; page?: number; pageSize?: number; selectedId?: string | null; nowMs?: number },
): ActivityFeedQuery {
  const latest = listActivity(baseDir, opts.nowMs);
  const today = chicagoToday(new Date(opts.nowMs ?? Date.now()));
  const todayEntries = latest.filter((a) => chicagoDate(a.createdAt) === today);
  const appsData = readJsonLenient<{ applications?: unknown }>(path.join(baseDir, "data", "applications.json"));
  const submittedToday = Array.isArray(appsData?.applications)
    ? appsData.applications.filter((a) => a !== null && typeof a === "object" && typeof (a as { appliedAt?: unknown }).appliedAt === "string" && chicagoDate((a as { appliedAt: string }).appliedAt) === today).length
    : 0;
  const overview = {
    totalToday: todayEntries.length,
    runningToday: todayEntries.filter((a) => a.status === "running").length,
    openWaiting: listWaiting(baseDir).filter((i) => i.status === "open").length,
    submittedToday,
  };
  const stageCounts: Record<string, number> = {};
  for (const s of STAGE_IDS) stageCounts[s] = 0;
  for (const a of todayEntries) {
    const st = displayStage(a.kind, a.stage);
    if (st) stageCounts[st] += 1;
  }
  const stage = opts.stage && STAGE_IDS.includes(opts.stage) ? opts.stage : null;
  const stageFiltered = stage ? latest.filter((a) => displayStage(a.kind, a.stage) === stage) : latest;
  const distribution = { running: 0, waiting: 0, done: 0, failed: 0, interrupted: 0 };
  for (const a of stageFiltered) {
    if (a.status === "running" || a.status === "waiting" || a.status === "done" || a.status === "failed" || a.status === "interrupted") distribution[a.status] += 1;
  }
  const status =
    opts.status === "running" || opts.status === "waiting" || opts.status === "done" || opts.status === "failed" || opts.status === "interrupted" ? opts.status : null;
  const filtered = opts.status === "unfinished" ? stageFiltered.filter(a => a.status !== "done" && a.status !== "failed") : opts.status === "finished" ? stageFiltered.filter(a => a.status === "done" || a.status === "failed") : status ? stageFiltered.filter((a) => a.status === status) : stageFiltered;
  const sort = opts.sort === "created-asc" || opts.sort === "status" || opts.sort === "kind" ? opts.sort : "created-desc";
  const byCreatedDesc = (x: ActivityEntry, y: ActivityEntry) =>
    y.createdAt < x.createdAt ? -1 : y.createdAt > x.createdAt ? 1 : y.activityId < x.activityId ? -1 : 1;
  const sorted = [...filtered].sort((a, b) =>
    sort === "created-asc"
      ? -byCreatedDesc(a, b)
      : sort === "status"
        ? (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) || byCreatedDesc(a, b)
        : sort === "kind"
          ? (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : byCreatedDesc(a, b))
          : byCreatedDesc(a, b),
  );
  const pageSize = opts.pageSize && opts.pageSize > 0 ? opts.pageSize : 15;
  const requested = opts.page && opts.page > 0 ? Math.floor(opts.page) : 1;
  const page = Math.min(requested, Math.max(1, Math.ceil(sorted.length / pageSize)));
  const start = (page - 1) * pageSize;
  const taskState = readTaskState(baseDir, opts.nowMs);
  return {
    tasks: taskState.tasks.filter((t) => t.unfinished),
    taskIssues: taskState.issues,
    reporting: readActivityReporting(baseDir, latest, opts.nowMs ?? Date.now()),
    selectedActivity: latest.find(a => a.activityId === opts.selectedId) ?? null,
    page,
    activities: sorted.slice(start, start + pageSize),
    total: sorted.length,
    distribution,
    overview,
    stageCounts,
    running: latest.filter((a) => a.status === "running"),
    pendingInbox: listPendingInbox(baseDir),
  };
}

export type WaitingAnswerInput = { waitingId: unknown; action: unknown; answer: unknown; scope?: unknown };
export type WaitingAnswerResult = { ok: true; waitingId: string } | { ok: false; reason: string };

/**
 * The console's second sanctioned write: a waiting-answer
 * decision file in data/inbox/decisions/. Guards, in order:
 * - waitingId must be a safe basename (no traversal);
 * - action must be answer or park;
 * - the waiting item must exist and be open;
 * - no answer file may already exist for the item;
 * - an answer action must carry a non-empty answer.
 * The file lands in data/inbox/decisions/ and the engine
 * applies it on its next poll; this function never claims
 * the change is applied.
 */
export function writeWaitingAnswer(baseDir: string, input: WaitingAnswerInput): WaitingAnswerResult {
  if (!isSafeTaskId(input.waitingId)) return { ok: false, reason: "invalid-waitingId" };
  const waitingId = input.waitingId;
  if (input.action !== "answer" && input.action !== "park") return { ok: false, reason: "invalid-action" };
  const item = listWaiting(baseDir).find((i) => i.waitingId === waitingId);
  if (!item) return { ok: false, reason: "waiting-not-found" };
  if (item.status !== "open") return { ok: false, reason: "not-open" };
  const scope = input.scope === undefined ? "once" : input.scope;
  if (scope !== "once" && scope !== "standing") return { ok: false, reason: "invalid-scope" };
  // Facts may become standing answers; approvals never do.
  const itemCategory = item.category ?? (item.kind === "approval" ? "approval" : undefined);
  if (input.action === "answer" && scope === "standing" && itemCategory === "approval")
    return { ok: false, reason: "approval-scope-standing" };
  const destDir = path.join(baseDir, "data", "inbox", "decisions");
  const dest = path.join(destDir, `decision-waiting-${waitingId}.json`);
  if (existsSync(dest)) return { ok: false, reason: "already-answered" };
  const answer = typeof input.answer === "string" ? input.answer : "";
  if (input.action === "answer" && !answer.trim()) return { ok: false, reason: "answer-required" };
  mkdirSync(destDir, { recursive: true });
  if (!atomicCreateFileSync(
    dest,
    canonicalJson({ waitingId, action: input.action, answer, scope, decidedAt: new Date().toISOString() }),
  )) return { ok: false, reason: "already-decided" };
  return { ok: true, waitingId };
}

/** Terminal job statuses (applied/dropped): an activity left open
 * against such a job is orphaned — its closing report may never
 * arrive when the job-level decision landed on a different run —
 * so it is deletable even though its own status is not done/failed. */
const TERMINAL_JOB_STATUSES = new Set(["applied", "dropped"]);

function jobIsTerminal(baseDir: string, jobId: string): boolean {
  const data = readJsonLenient<{ jobs?: unknown }>(path.join(baseDir, "data", "jobs.json"));
  const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
  return jobs.some((j) => typeof j === "object" && j !== null && (j as { id?: unknown }).id === jobId && TERMINAL_JOB_STATUSES.has(String((j as { status?: unknown }).status)));
}

export type DeletionInput = { scope: unknown; id: unknown };
export type DeletionResult = { ok: true; scope: string; id: string } | { ok: false; reason: string };

/**
 * The console's third sanctioned write: a deletion decision
 * file in data/inbox/decisions/. Guards, in order:
 * - scope must be activity or waiting;
 * - id must be a safe basename (no traversal);
 * - the target must exist and be finished (activity latest
 *   status done/failed, or its job already terminal — applied
 *   or dropped — which orphans the still-open activity) or
 *   closed (waiting answered/parked);
 * - no delete file may already exist for the target.
 * The file lands in data/inbox/decisions/ and the engine
 * applies it on its next poll; this function never claims
 * the change is applied.
 */
export function writeDeletion(baseDir: string, input: DeletionInput): DeletionResult {
  if (input.scope !== "activity" && input.scope !== "waiting") return { ok: false, reason: "invalid-scope" };
  const scope = input.scope;
  if (!isSafeTaskId(input.id)) return { ok: false, reason: "invalid-id" };
  const id = input.id;
  if (scope === "activity") {
    const entry = listActivity(baseDir).find((a) => a.activityId === id);
    if (!entry) return { ok: false, reason: "activity-not-found" };
    if (entry.status !== "done" && entry.status !== "failed") {
      const jobId = typeof entry.jobId === "string" ? entry.jobId : "";
      if (!jobId || !jobIsTerminal(baseDir, jobId)) return { ok: false, reason: "not-completed" };
    }
  } else {
    const item = listWaiting(baseDir).find((i) => i.waitingId === id);
    if (!item) return { ok: false, reason: "waiting-not-found" };
    if (item.status !== "answered" && item.status !== "parked") return { ok: false, reason: "not-closed" };
  }
  const destDir = path.join(baseDir, "data", "inbox", "decisions");
  const dest = path.join(destDir, `decision-delete-${scope}-${id}.json`);
  if (existsSync(dest)) return { ok: false, reason: "already-deleted" };
  mkdirSync(destDir, { recursive: true });
  if (!atomicCreateFileSync(
    dest,
    canonicalJson({ scope, id, decidedAt: new Date().toISOString() }),
  )) return { ok: false, reason: "already-decided" };
  return { ok: true, scope, id };
}
