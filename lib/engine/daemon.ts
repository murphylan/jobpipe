import { applyAgentContextRequested } from "./agent-context.ts";
import { applyMuseSettings } from "./muse-settings.ts";
import { applyKnowledgeChanged } from "./knowledge-events.ts";
import { randomUUID } from "node:crypto";
import { isSafeTaskId, isObject, validEnvelope, eventHash } from "./envelope.ts";
import { withEngineLock } from "./lock.ts";
import { deferJournalCommit, recoverJournals, finishJournal } from "./journal.ts";
import { setReceiptIdentity } from "./receipt.ts";
import { readState, writeState } from "./state.ts";
import { atomicWriteFileSync as writeFileSync } from "./storage.ts";
// Stage 2 daemon, one poll only (Doc-00 sections 9 and 10).
// processInboxOnce scans data/inbox/*.json, in filename order,
// and processes each stable file (mtime older than 1.5 seconds;
// fresher files are skipped, not rejected, per the stable-window
// rule). Batch 1 supports exactly one event, TARGET_SET, as
// the low-risk end-to-end path; anything else is rejected with
// E_UNKNOWN_EVENT and moved to data/rejected/, never applied.
// Pipeline per file: crash-recovery rollback first (a journal
// left by an interrupted run is restored, never rolled forward),
// duplicate check by receipt, backup, journal, validate, write,
// persist Run + Receipt, derive today/state, close journal, move to processed/.
// On any failure after journal begin, the journal restores the
// prior contents and the file moves to rejected/ with a receipt.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import { backupData } from "../backup.ts";
import { applyApplicationSubmitted } from "./apply.ts";
import { recalculateDaily } from "./daily.ts";
import { checkForceMode } from "./force-mode.ts";
import type { ChangeSetInput } from "./expand.ts";
import { applyDiscovered, applyFollowupReceived, type GenericChangeSet } from "./events.ts";
import { applyScreened, applyTailored, applyUserDecided } from "./events2.ts";
import { HIGH_APPROVAL_EVENTS, applyProfileChanged, applyQuirkLearned, applyResumeImported, applySkillRevised } from "./events3.ts";
import { applyAgentActivity, applyAgentWaiting, applyDeletion, applyWaitingAnswer } from "./events4.ts";
import { applyPlanRecorded } from "./events5.ts";
import { applyAttemptRecorded, applyAttemptResolved, applyCheckpointRecorded } from "./events6.ts";
import { applyApplicationImported } from "./events7.ts";
import { commitDataGit, gitFilesForEvent } from "./git.ts";
import { readHeartbeatStatus, writeHeartbeat } from "./heartbeat.ts";
import { processMuseLiveInboxOnce } from "./muse-live.ts";
import { beginJournal, commitJournal, restoreJournal } from "./journal.ts";
import { readReceipt, writeReceipt, type Receipt } from "./receipt.ts";
import { changelogFileSchema, dailyTargetsFileSchema } from "./schema.ts";
import { canonicalJson } from "./serialize.ts";

export type DaemonOutcome = "committed" | "rejected" | "skipped" | "duplicate" | "pending";
export type DaemonResult = { taskId: string; outcome: DaemonOutcome; summary: string };

function dataDir(baseDir: string): string {
  return path.join(baseDir, "data");
}

function moveFile(src: string, destDir: string, basename = path.basename(src)): void {
  mkdirSync(destDir, { recursive: true });
  const original = path.join(destDir, basename);
  const dest = existsSync(original) ? path.join(destDir, `${path.basename(basename, ".json")}-${randomUUID()}.json`) : original;
  renameSync(src, dest);
}

// Archive a decision file under a decision- prefix. Moving it
// with its bare basename would overwrite the original event
// file of the same taskId already sitting in processed/.
function archiveDecision(baseDir: string, decisionFile: string, taskId: string): void {
  const destDir = path.join(dataDir(baseDir), "processed");
  mkdirSync(destDir, { recursive: true });
  moveFile(decisionFile, destDir, `decision-${taskId}.json`);
}

// Events whose committed run record or ledger effect can change the
// daily counters. deriveDailyCounts() only counts runs of DISCOVERED /
// SCREENED / TAILORED / USER_DECIDED, and the apply count only moves
// when APPLICATION_SUBMITTED appends a confirmed ledger row. Every
// other committed event (progress reports, plans, checkpoints,
// attempts, context requests, ...) leaves both inputs untouched, so
// recalculateDaily() could only re-derive the same numbers — at the
// cost of a full ledger parse plus a full scan of data/runs on every
// single event. Gate the recalculation to the events that can move
// it; run persistence, state and journal completion are unchanged
// for all events. (Efficiency roadmap item 2, 2026-11-09.)
const DAILY_AFFECTING_EVENTS = new Set([
  "DISCOVERED",
  "SCREENED",
  "TAILORED",
  "USER_DECIDED",
  "APPLICATION_SUBMITTED",
]);

function writeRun(baseDir: string, taskId: string, event: string, status: string, summary: string): void {
  const dir = path.join(dataDir(baseDir), "runs");
  const full = path.join(dir, `${taskId}.json`);
  if (status !== "committed" || !existsSync(full)) {
    writeFileSync(full, canonicalJson({ taskId, event, status, summary, finishedAt: new Date().toISOString() }));
  }
  if (status === "committed") {
    if (DAILY_AFFECTING_EVENTS.has(event)) {
      recalculateDaily(baseDir);
    }
    writeState(baseDir, taskId, { paths: [...gitFilesForEvent(event, taskId), "daily.json"] });
    finishJournal(baseDir, taskId);
  }
}

// Git step for a committed task: local commit only, never a
// push. A Git failure is recorded on the receipt as git:
// failed and does not roll back the committed data.
function markGit(baseDir: string, taskId: string, event: string): void {
  const receipt = readReceipt(baseDir, taskId);
  if (!receipt) return;
  const git = commitDataGit(baseDir, taskId, gitFilesForEvent(event, taskId));
  const ops = { ...((receipt.ops as Record<string, unknown> | undefined) ?? {}), git: git.ok ? "committed" : `failed: ${git.detail}` };
  writeReceipt(baseDir, { ...receipt, ops });
}

function reject(baseDir: string, taskId: string, event: string, errors: string[], inboxFile: string): DaemonResult {
  const prior = readReceipt(baseDir, taskId);
  if (prior && prior.status !== "pending-approval") {
    moveFile(inboxFile, path.join(dataDir(baseDir), "rejected"));
    return { taskId, outcome: "rejected", summary: errors.join("; ") };
  }
  const receipt: Receipt = {
    taskId,
    event,
    status: "rejected",
    createdAt: new Date().toISOString(),
    summary: errors.join("; "),
    errors,
  };
  writeReceipt(baseDir, receipt);
  writeRun(baseDir, taskId, event, "rejected", receipt.summary);
  moveFile(inboxFile, path.join(dataDir(baseDir), "rejected"));
  return { taskId, outcome: "rejected", summary: receipt.summary };
}

function applyTargetSet(
  baseDir: string,
  taskId: string,
  payload: unknown,
  inboxFile: string,
): DaemonResult {
  const now = new Date().toISOString();
  const date = (payload as { date?: unknown }).date;
  const target = (payload as { target?: unknown }).target;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return reject(baseDir, taskId, "TARGET_SET", ["E_SCHEMA: payload.date must be YYYY-MM-DD"], inboxFile);
  if (typeof target !== "number" || !Number.isInteger(target) || target < 0)
    return reject(baseDir, taskId, "TARGET_SET", ["E_SCHEMA: payload.target must be a non-negative integer"], inboxFile);

  const targetsPath = path.join(dataDir(baseDir), "daily-targets.json");
  const changelogPath = path.join(dataDir(baseDir), "changelog.json");
  const readTargets = () => {
    if (!existsSync(targetsPath)) return { targets: {}, version: 0, updatedAt: "" };
    const parsed = dailyTargetsFileSchema.safeParse(JSON.parse(readFileSync(targetsPath, "utf-8")));
    if (!parsed.success) throw new Error("daily-targets.json: invalid");
    return parsed.data;
  };
  const readChangelog = () => {
    if (!existsSync(changelogPath)) return { entries: [], version: 0, updatedAt: "" };
    const parsed = changelogFileSchema.safeParse(JSON.parse(readFileSync(changelogPath, "utf-8")));
    if (!parsed.success) throw new Error("changelog.json: invalid");
    return parsed.data;
  };

  let journalBegun = false;
  try {
    backupData(baseDir, ["daily-targets.json", "changelog.json"], taskId);
    beginJournal(baseDir, taskId, ["daily-targets.json", "changelog.json"]);
    journalBegun = true;
    const oldTargets = readTargets();
    const oldChangelog = readChangelog();
    const newTargets = {
      ...oldTargets,
      targets: { ...oldTargets.targets, [date]: target },
      version: oldTargets.version + 1,
      updatedAt: now,
    };
    const newChangelog = {
      ...oldChangelog,
      entries: [...oldChangelog.entries, { at: now, action: "target-set", target: "daily-targets.json", version: newTargets.version, note: `${taskId} target ${date} = ${target}` }],
      version: oldChangelog.version + 1,
      updatedAt: now,
    };
    const tParsed = dailyTargetsFileSchema.safeParse(newTargets);
    const cParsed = changelogFileSchema.safeParse(newChangelog);
    if (!tParsed.success || !cParsed.success) throw new Error("new daily-targets or changelog failed validation");
    writeFileSync(targetsPath, canonicalJson(newTargets), "utf-8");
    writeFileSync(changelogPath, canonicalJson(newChangelog), "utf-8");
    commitJournal(baseDir, taskId);
    const summary = `TARGET_SET ${date} = ${target}`;
    writeReceipt(baseDir, { taskId, event: "TARGET_SET", status: "committed", createdAt: now, summary, ops: { dailyTargetsVersion: newTargets.version } });
    writeRun(baseDir, taskId, "TARGET_SET", "committed", summary);
    moveFile(inboxFile, path.join(dataDir(baseDir), "processed"));
    return { taskId, outcome: "committed", summary };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const durable = readReceipt(baseDir, taskId);
    if (durable && ["committed", "verified"].includes(durable.status)) throw e;
    if (journalBegun) {
      try { restoreJournal(baseDir, taskId); } catch { /* journal already gone; nothing to restore */ }
    }
    return reject(baseDir, taskId, "TARGET_SET", [message], inboxFile);
  }
}

// Approved high-approval event: runs only after a decisions
// file with approved=true and a non-empty user quote. On
// success the original inbox file moves to processed/ and the
// decision file is archived as decision-<taskId>.json in
// processed/ by the caller. On failure the original moves to
// rejected/ with a rejected receipt, and the caller archives
// the decision file in rejected/ too.
function applyApprovedEvent(baseDir: string, taskId: string, event: string, parsed: unknown, inboxFile: string): DaemonResult {
  const applied = event === "PROFILE_CHANGED"
    ? applyProfileChanged(baseDir, parsed as GenericChangeSet)
    : event === "RESUME_IMPORTED"
      ? applyResumeImported(baseDir, parsed as GenericChangeSet)
      : event === "APPLICATION_IMPORTED"
        ? applyApplicationImported(baseDir, parsed as GenericChangeSet)
        : applySkillRevised(baseDir, parsed as GenericChangeSet);
  if (!applied.ok) return reject(baseDir, taskId, event, applied.errors, inboxFile);
  writeReceipt(baseDir, { taskId, event, status: "committed", createdAt: new Date().toISOString(), summary: applied.summary });
  writeRun(baseDir, taskId, event, "committed", applied.summary);
  moveFile(inboxFile, path.join(dataDir(baseDir), "processed"));
  markGit(baseDir, taskId, event);
  return { taskId, outcome: "committed", summary: applied.summary };
}

export function processDecisionsOnce(baseDir: string, nowMs: number): DaemonResult[] {
  return withEngineLock(baseDir, () => deferJournalCommit(baseDir, () => {
    recoverJournals(baseDir, receipt => writeRun(baseDir, receipt.taskId, receipt.event, "committed", receipt.summary));
    return processDecisionsLocked(baseDir, nowMs);
  }));
}

function processDecisionsLocked(baseDir: string, nowMs: number): DaemonResult[] {
  const results: DaemonResult[] = [];
  const decisionsDir = path.join(dataDir(baseDir), "inbox", "decisions");
  if (!existsSync(decisionsDir)) return results;
  const files = readdirSync(decisionsDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => path.join(decisionsDir, f))
    .filter((f) => statSync(f).isFile());
  for (const decisionFile of files) {
    // Console waiting answers (Doc-07) live in the same
    // directory but under a decision-waiting- prefix and a
    // different body shape (waitingId/action/answer). They
    // are applied here, before the taskId/approved path,
    // and archived under their own basename (no extra
    // decision- prefix) so the waiting id stays readable.
    const decisionBase = path.basename(decisionFile);
    if (decisionBase.startsWith("decision-waiting-") && decisionBase.endsWith(".json")) {
      if (nowMs - statSync(decisionFile).mtimeMs < 1500) {
        results.push({ taskId: decisionBase.replace(/\.json$/, ""), outcome: "skipped", summary: "decision file too fresh" });
        continue;
      }
      let waitingDecision: unknown;
      try {
        waitingDecision = JSON.parse(readFileSync(decisionFile, "utf-8"));
      } catch {
        moveFile(decisionFile, path.join(dataDir(baseDir), "rejected"));
        results.push({ taskId: decisionBase.replace(/\.json$/, ""), outcome: "rejected", summary: "E_PARSE: decision file is not valid JSON" });
        continue;
      }
      if (!isObject(waitingDecision)) {
        moveFile(decisionFile, path.join(dataDir(baseDir), "rejected"));
        results.push({ taskId: path.basename(decisionFile, ".json"), outcome: "rejected", summary: "E_SCHEMA: decision must be an object" });
        continue;
      }
      const waitingId = (waitingDecision as { waitingId?: unknown }).waitingId;
      const action = (waitingDecision as { action?: unknown }).action;
      const answer = (waitingDecision as { answer?: unknown }).answer;
      const scope = (waitingDecision as { scope?: unknown }).scope;
      const fileWaitingId = decisionBase.slice("decision-waiting-".length, -".json".length);
      if (waitingId !== fileWaitingId || (action !== "answer" && action !== "park") || typeof answer !== "string" ||
        (scope !== undefined && scope !== "once" && scope !== "standing")) {
        moveFile(decisionFile, path.join(dataDir(baseDir), "rejected"));
        results.push({ taskId: decisionBase.replace(/\.json$/, ""), outcome: "rejected", summary: "E_SCHEMA: waiting decision waitingId/action/answer/scope mismatch" });
        continue;
      }
      const decisionTaskId = `waiting-answer-${fileWaitingId}`;
      if (!isSafeTaskId(decisionTaskId)) { moveFile(decisionFile, path.join(dataDir(baseDir), "rejected")); continue; }
      const prior = readReceipt(baseDir, decisionTaskId);
      if (prior) {
        const conflict = prior.inputHash && prior.inputHash !== eventHash(waitingDecision);
        moveFile(decisionFile, path.join(dataDir(baseDir), conflict ? "rejected" : "processed"));
        results.push({ taskId: decisionTaskId, outcome: conflict ? "rejected" : "duplicate", summary: conflict ? "E_ID_CONFLICT: decision payload changed" : "decision already processed" });
        continue;
      }
      const forceCheck = checkForceMode(baseDir, "WAITING_ANSWERED");
      if (forceCheck.blocked) { results.push(reject(baseDir, decisionTaskId, "WAITING_ANSWERED", [forceCheck.reason], decisionFile)); continue; }
      setReceiptIdentity(baseDir, decisionTaskId, eventHash(waitingDecision));
      const applied = applyWaitingAnswer(baseDir, fileWaitingId, action, answer, new Date().toISOString(), typeof scope === "string" ? scope : "once");
      if (!applied.ok) {
        moveFile(decisionFile, path.join(dataDir(baseDir), "rejected"));
        results.push({ taskId: `waiting-answer-${fileWaitingId}`, outcome: "rejected", summary: applied.errors.join("; ") });
        continue;
      }
      const answerTaskId = `waiting-answer-${fileWaitingId}`;
      writeReceipt(baseDir, { taskId: answerTaskId, event: "WAITING_ANSWERED", status: "committed", createdAt: new Date().toISOString(), summary: applied.summary });
      writeRun(baseDir, answerTaskId, "WAITING_ANSWERED", "committed", applied.summary);
      moveFile(decisionFile, path.join(dataDir(baseDir), "processed"));
      markGit(baseDir, answerTaskId, "WAITING_ANSWERED");
      results.push({ taskId: answerTaskId, outcome: "committed", summary: applied.summary });
      continue;
    }
    // Console deletion requests (Doc-07 v2) live in the same
    // directory under a decision-delete- prefix: the body
    // carries scope (activity/waiting) and id, and both must
    // match the filename (decision-delete-<scope>-<id>).
    // Applied here, before the taskId/approved path, and
    // archived under their own basename so the target stays
    // readable. The changelog entry and receipt keep the
    // audit trail; only the feed/queue row is removed.
    if (decisionBase.startsWith("decision-delete-") && decisionBase.endsWith(".json")) {
      if (nowMs - statSync(decisionFile).mtimeMs < 1500) {
        results.push({ taskId: decisionBase.replace(/\.json$/, ""), outcome: "skipped", summary: "decision file too fresh" });
        continue;
      }
      let deleteDecision: unknown;
      try {
        deleteDecision = JSON.parse(readFileSync(decisionFile, "utf-8"));
      } catch {
        moveFile(decisionFile, path.join(dataDir(baseDir), "rejected"));
        results.push({ taskId: decisionBase.replace(/\.json$/, ""), outcome: "rejected", summary: "E_PARSE: decision file is not valid JSON" });
        continue;
      }
      if (!isObject(deleteDecision)) {
        moveFile(decisionFile, path.join(dataDir(baseDir), "rejected"));
        results.push({ taskId: path.basename(decisionFile, ".json"), outcome: "rejected", summary: "E_SCHEMA: decision must be an object" });
        continue;
      }
      const scope = (deleteDecision as { scope?: unknown }).scope;
      const deleteId = (deleteDecision as { id?: unknown }).id;
      const fileBody = decisionBase.slice("decision-delete-".length, -".json".length);
      const fileScope = fileBody.startsWith("activity-") ? "activity" : fileBody.startsWith("waiting-") ? "waiting" : "";
      const fileId = fileScope ? fileBody.slice(fileScope.length + 1) : "";
      if (scope !== fileScope || deleteId !== fileId || (scope !== "activity" && scope !== "waiting")) {
        moveFile(decisionFile, path.join(dataDir(baseDir), "rejected"));
        results.push({ taskId: decisionBase.replace(/\.json$/, ""), outcome: "rejected", summary: "E_SCHEMA: delete decision scope/id mismatch" });
        continue;
      }
      const decisionTaskId = `delete-${fileScope}-${fileId}`;
      if (!isSafeTaskId(decisionTaskId)) { moveFile(decisionFile, path.join(dataDir(baseDir), "rejected")); continue; }
      const prior = readReceipt(baseDir, decisionTaskId);
      if (prior) {
        const conflict = prior.inputHash && prior.inputHash !== eventHash(deleteDecision);
        moveFile(decisionFile, path.join(dataDir(baseDir), conflict ? "rejected" : "processed"));
        results.push({ taskId: decisionTaskId, outcome: conflict ? "rejected" : "duplicate", summary: conflict ? "E_ID_CONFLICT: decision payload changed" : "decision already processed" });
        continue;
      }
      const forceCheck = checkForceMode(baseDir, fileScope === "activity" ? "ACTIVITY_DELETED" : "WAITING_DELETED");
      if (forceCheck.blocked) { results.push(reject(baseDir, decisionTaskId, fileScope === "activity" ? "ACTIVITY_DELETED" : "WAITING_DELETED", [forceCheck.reason], decisionFile)); continue; }
      setReceiptIdentity(baseDir, decisionTaskId, eventHash(deleteDecision));
      const applied = applyDeletion(baseDir, fileScope, fileId, new Date().toISOString());
      if (!applied.ok) {
        moveFile(decisionFile, path.join(dataDir(baseDir), "rejected"));
        results.push({ taskId: `delete-${fileScope}-${fileId}`, outcome: "rejected", summary: applied.errors.join("; ") });
        continue;
      }
      const deleteTaskId = `delete-${fileScope}-${fileId}`;
      const deleteEvent = fileScope === "activity" ? "ACTIVITY_DELETED" : "WAITING_DELETED";
      writeReceipt(baseDir, { taskId: deleteTaskId, event: deleteEvent, status: "committed", createdAt: new Date().toISOString(), summary: applied.summary });
      writeRun(baseDir, deleteTaskId, deleteEvent, "committed", applied.summary);
      moveFile(decisionFile, path.join(dataDir(baseDir), "processed"));
      markGit(baseDir, deleteTaskId, deleteEvent);
      results.push({ taskId: deleteTaskId, outcome: "committed", summary: applied.summary });
      continue;
    }
    if (nowMs - statSync(decisionFile).mtimeMs < 1500) {
      results.push({ taskId: path.basename(decisionFile, ".json"), outcome: "skipped", summary: "decision file too fresh" });
      continue;
    }
    let decision: unknown;
    try {
      decision = JSON.parse(readFileSync(decisionFile, "utf-8"));
    } catch {
      moveFile(decisionFile, path.join(dataDir(baseDir), "rejected"));
      results.push({ taskId: path.basename(decisionFile, ".json"), outcome: "rejected", summary: "E_PARSE: decision file is not valid JSON" });
      continue;
    }
    if (!isObject(decision)) {
      moveFile(decisionFile, path.join(dataDir(baseDir), "rejected"));
      results.push({ taskId: path.basename(decisionFile, ".json"), outcome: "rejected", summary: "E_SCHEMA: decision must be an object" });
      continue;
    }
    const taskId = (decision as { taskId?: unknown }).taskId;
    const approved = (decision as { approved?: unknown }).approved;
    const quote = (decision as { quote?: unknown }).quote;
    if (!isSafeTaskId(taskId)) {
      moveFile(decisionFile, path.join(dataDir(baseDir), "rejected"));
      results.push({ taskId: path.basename(decisionFile, ".json"), outcome: "rejected", summary: "E_SCHEMA: decision taskId missing" });
      continue;
    }
    if (approved !== true && approved !== false) {
      moveFile(decisionFile, path.join(dataDir(baseDir), "rejected"));
      results.push({ taskId, outcome: "rejected", summary: "E_SCHEMA: decision approved must be true or false" });
      continue;
    }
    const prior = readReceipt(baseDir, taskId);
    if (prior && ["committed", "verified", "rejected", "failed"].includes(prior.status)) {
      archiveDecision(baseDir, decisionFile, taskId);
      results.push({ taskId, outcome: "duplicate", summary: "decision already processed" });
      continue;
    }
    const inboxFile = path.join(dataDir(baseDir), "inbox", `${taskId}.json`);
    if (approved === false) {
      let deniedEvent = "unknown";
      if (existsSync(inboxFile)) {
        try {
          const orig = JSON.parse(readFileSync(inboxFile, "utf-8")) as { event?: unknown };
          if (typeof orig.event === "string") deniedEvent = orig.event;
        } catch { /* keep unknown */ }
        moveFile(inboxFile, path.join(dataDir(baseDir), "rejected"));
      }
      const summary = "denied by user decision";
      writeReceipt(baseDir, { taskId, event: deniedEvent, status: "rejected", createdAt: new Date().toISOString(), summary });
      writeRun(baseDir, taskId, deniedEvent, "rejected", summary);
      archiveDecision(baseDir, decisionFile, taskId);
      results.push({ taskId, outcome: "rejected", summary });
      continue;
    }
    if (typeof quote !== "string" || !quote.trim()) {
      results.push({ taskId, outcome: "pending", summary: "approval quote missing, decision left in place" });
      continue;
    }
    if (!existsSync(inboxFile)) {
      moveFile(decisionFile, path.join(dataDir(baseDir), "rejected"));
      results.push({ taskId, outcome: "rejected", summary: "original inbox file missing" });
      continue;
    }
    let original: unknown;
    try {
      original = JSON.parse(readFileSync(inboxFile, "utf-8"));
    } catch {
      moveFile(decisionFile, path.join(dataDir(baseDir), "rejected"));
      results.push({ taskId, outcome: "rejected", summary: "E_PARSE: original inbox file is not valid JSON" });
      continue;
    }
    if (!isObject(original)) {
      moveFile(decisionFile, path.join(dataDir(baseDir), "rejected"));
      results.push({ taskId: path.basename(decisionFile, ".json"), outcome: "rejected", summary: "E_SCHEMA: decision must be an object" });
      continue;
    }
    if (!validEnvelope(original) || original.taskId !== taskId) {
      moveFile(decisionFile, path.join(dataDir(baseDir), "rejected"));
      results.push({ taskId, outcome: "rejected", summary: "E_SCHEMA: invalid original event" });
      continue;
    }
    if (prior?.inputHash && prior.inputHash !== eventHash(original)) {
      moveFile(decisionFile, path.join(dataDir(baseDir), "rejected"));
      results.push({ taskId, outcome: "rejected", summary: "E_ID_CONFLICT: pending payload changed" });
      continue;
    }
    setReceiptIdentity(baseDir, taskId, eventHash(original));
    const event = (original as { event?: unknown }).event;
    if (typeof event !== "string" || !(HIGH_APPROVAL_EVENTS as readonly string[]).includes(event)) {
      moveFile(decisionFile, path.join(dataDir(baseDir), "rejected"));
      results.push({ taskId, outcome: "rejected", summary: `decision is for non-high event ${String(event)}` });
      continue;
    }
    const existing = readReceipt(baseDir, taskId);
    if (existing && existing.status === "committed") {
      archiveDecision(baseDir, decisionFile, taskId);
      results.push({ taskId, outcome: "duplicate", summary: "already committed" });
      continue;
    }
    const forceCheck = checkForceMode(baseDir, event);
    if (forceCheck.blocked) {
      results.push(reject(baseDir, taskId, event, [forceCheck.reason], inboxFile));
      moveFile(decisionFile, path.join(dataDir(baseDir), "rejected"));
      continue;
    }
    const applied = applyApprovedEvent(baseDir, taskId, event, original, inboxFile);
    if (applied.outcome === "committed") {
      archiveDecision(baseDir, decisionFile, taskId);
    } else {
      moveFile(decisionFile, path.join(dataDir(baseDir), "rejected"));
    }
    results.push(applied);
  }
  return results;
}

export function processInboxOnce(baseDir: string, opts: { nowMs?: number; continuous?: boolean } = {}): DaemonResult[] {
  return withEngineLock(baseDir, () => deferJournalCommit(baseDir, () => {
    try {
      recoverJournals(baseDir, receipt => writeRun(baseDir, receipt.taskId, receipt.event, "committed", receipt.summary));
      return processInboxLocked(baseDir, opts);
    } catch (e) {
      writeHeartbeat(baseDir, "error", e instanceof Error ? e.message : String(e));
      throw e;
    }
  }));
}

function processInboxLocked(baseDir: string, opts: { nowMs?: number; continuous?: boolean }): DaemonResult[] {
  const nowMs = opts.nowMs ?? Date.now();
  writeHeartbeat(baseDir, "running");
  const results: DaemonResult[] = [];
  let pollError: string | undefined;
  try {
    results.push(...processDecisionsOnce(baseDir, nowMs));
    // Muse 实时状态 inbox：Muse 写 staging，引擎提升为正式文件（引擎唯一写者）
    try {
      const promoted = processMuseLiveInboxOnce(baseDir, { nowMs });
      if (promoted.length) writeState(baseDir, readState(baseDir)?.lastTaskId ?? null, { paths: ["muse-live.json"] });
    } catch (e) {
      pollError = e instanceof Error ? e.message : String(e);
    }
    const inboxDir = path.join(dataDir(baseDir), "inbox");
    if (!existsSync(inboxDir)) return results;
    const files = readdirSync(inboxDir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => path.join(inboxDir, f))
      .filter((f) => statSync(f).isFile());
    for (const inboxFile of files) {
      const mtimeMs = statSync(inboxFile).mtimeMs;
      if (nowMs - mtimeMs < 1500) {
        results.push({ taskId: path.basename(inboxFile, ".json"), outcome: "skipped", summary: "file too fresh, stable window not reached" });
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(inboxFile, "utf-8"));
      } catch {
        const taskId = path.basename(inboxFile, ".json");
        if (isSafeTaskId(taskId)) results.push(reject(baseDir, taskId, "unknown", ["E_PARSE: inbox file is not valid JSON"], inboxFile));
        else moveFile(inboxFile, path.join(dataDir(baseDir), "rejected"));
        continue;
      }
      if (!validEnvelope(parsed)) {
        const fileId = path.basename(inboxFile, ".json");
        if (isSafeTaskId(fileId)) results.push(reject(baseDir, fileId, "unknown", ["E_SCHEMA: invalid event envelope"], inboxFile));
        else moveFile(inboxFile, path.join(dataDir(baseDir), "rejected"));
        continue;
      }
      const taskId = (parsed as { taskId?: unknown }).taskId;
      const event = (parsed as { event?: unknown }).event;
      if (!isSafeTaskId(taskId)) {
        results.push(reject(baseDir, path.basename(inboxFile, ".json"), typeof event === "string" ? event : "unknown", ["E_SCHEMA: taskId missing"], inboxFile));
        continue;
      }
      const existing = readReceipt(baseDir, taskId);
      if (existing) {
        const archived = path.join(dataDir(baseDir), "processed", `${taskId}.json`);
        const priorHash = existing.inputHash ?? (existsSync(archived) ? eventHash(JSON.parse(readFileSync(archived, "utf-8"))) : undefined);
        if (priorHash && priorHash !== eventHash(parsed)) {
          moveFile(inboxFile, path.join(dataDir(baseDir), "rejected"));
          results.push({ taskId, outcome: "rejected", summary: "E_ID_CONFLICT: taskId belongs to another event" });
          continue;
        }
        if (existing.status === "pending-approval") {
          results.push({ taskId, outcome: "pending", summary: "waiting for user approval, not processed" });
          continue;
        }
        moveFile(inboxFile, path.join(dataDir(baseDir), "processed"));
        results.push({ taskId, outcome: "duplicate", summary: `already processed with receipt status ${existing.status}${priorHash ? "" : "; legacy payload identity cannot be verified"}` });
        continue;
      }
      if (path.basename(inboxFile, ".json") !== taskId) {
        moveFile(inboxFile, path.join(dataDir(baseDir), "rejected"));
        results.push({ taskId, outcome: "rejected", summary: "E_SCHEMA: taskId must match inbox filename" });
        continue;
      }
      // FR-8: Force mode - reject ChangeSets that write to externally-modified files.
      if (typeof event === "string") {
        const forceCheck = checkForceMode(baseDir, event);
        if (forceCheck.blocked) {
          results.push(reject(baseDir, taskId, event, [forceCheck.reason], inboxFile));
          continue;
        }
      }
      setReceiptIdentity(baseDir, taskId, eventHash(parsed));
      if (typeof event === "string" && (HIGH_APPROVAL_EVENTS as readonly string[]).includes(event)) {
        const summary = `high-approval event ${event} held for user approval, not applied`;
        writeReceipt(baseDir, { taskId, event, status: "pending-approval", createdAt: new Date().toISOString(), summary });
        writeRun(baseDir, taskId, event, "pending-approval", summary);
        results.push({ taskId, outcome: "pending", summary });
        continue;
      }
      if (event === "APPLICATION_SUBMITTED") {
        const applied = applyApplicationSubmitted(baseDir, parsed as ChangeSetInput);
        if (!applied.ok) {
          results.push(reject(baseDir, taskId, "APPLICATION_SUBMITTED", applied.errors, inboxFile));
          continue;
        }
        const summary = `APPLICATION_SUBMITTED ${String((parsed as { payload?: { jobId?: unknown } }).payload?.jobId ?? "")} -> applied, ledger ${applied.expansion.ledgerId}`;
        writeReceipt(baseDir, { taskId, event: "APPLICATION_SUBMITTED", status: "committed", createdAt: new Date().toISOString(), summary, ops: { jobId: applied.expansion.job.id, ledgerId: applied.expansion.ledgerId, applicationId: applied.expansion.application.id } });
        writeRun(baseDir, taskId, "APPLICATION_SUBMITTED", "committed", summary);
        moveFile(inboxFile, path.join(dataDir(baseDir), "processed"));
        markGit(baseDir, taskId, "APPLICATION_SUBMITTED");
        results.push({ taskId, outcome: "committed", summary });
        continue;
      }
      if (event === "AGENT_CONTEXT_REQUESTED" || event === "MUSE_SETTINGS_CHANGED" || event === "KNOWLEDGE_CHANGED" || event === "FOLLOWUP_RECEIVED" || event === "DISCOVERED" || event === "SCREENED" || event === "TAILORED" || event === "USER_DECIDED" || event === "QUIRK_LEARNED" || event === "AGENT_ACTIVITY" || event === "AGENT_WAITING" || event === "PLAN_RECORDED" || event === "CHECKPOINT_RECORDED" || event === "ATTEMPT_RECORDED" || event === "ATTEMPT_RESOLVED") {
        const applied = event === "AGENT_CONTEXT_REQUESTED"
          ? applyAgentContextRequested(baseDir, parsed as GenericChangeSet)
          : event === "MUSE_SETTINGS_CHANGED"
          ? applyMuseSettings(baseDir, parsed as GenericChangeSet)
          : event === "KNOWLEDGE_CHANGED"
          ? applyKnowledgeChanged(baseDir, parsed as GenericChangeSet)
          : event === "FOLLOWUP_RECEIVED"
          ? applyFollowupReceived(baseDir, parsed as GenericChangeSet)
          : event === "DISCOVERED"
            ? applyDiscovered(baseDir, parsed as GenericChangeSet)
            : event === "SCREENED"
              ? applyScreened(baseDir, parsed as GenericChangeSet)
              : event === "TAILORED"
                ? applyTailored(baseDir, parsed as GenericChangeSet)
                : event === "USER_DECIDED"
                  ? applyUserDecided(baseDir, parsed as GenericChangeSet)
                  : event === "AGENT_ACTIVITY"
                    ? applyAgentActivity(baseDir, parsed as GenericChangeSet)
                    : event === "AGENT_WAITING"
                      ? applyAgentWaiting(baseDir, parsed as GenericChangeSet)
                      : event === "PLAN_RECORDED"
                        ? applyPlanRecorded(baseDir, parsed as GenericChangeSet)
                        : event === "CHECKPOINT_RECORDED"
                          ? applyCheckpointRecorded(baseDir, parsed as GenericChangeSet)
                          : event === "ATTEMPT_RECORDED"
                            ? applyAttemptRecorded(baseDir, parsed as GenericChangeSet)
                            : event === "ATTEMPT_RESOLVED"
                              ? applyAttemptResolved(baseDir, parsed as GenericChangeSet)
                              : applyQuirkLearned(baseDir, parsed as GenericChangeSet);
        if (!applied.ok) {
          results.push(reject(baseDir, taskId, event, applied.errors, inboxFile));
          continue;
        }
        writeReceipt(baseDir, { taskId, event, status: "committed", createdAt: new Date().toISOString(), summary: applied.summary });
        writeRun(baseDir, taskId, event, "committed", applied.summary);
        moveFile(inboxFile, path.join(dataDir(baseDir), "processed"));
        markGit(baseDir, taskId, event);
        results.push({ taskId, outcome: "committed", summary: applied.summary });
        continue;
      }
      if (event !== "TARGET_SET") {
        results.push(reject(baseDir, taskId, typeof event === "string" ? event : "unknown", [`E_UNKNOWN_EVENT: ${String(event)} (supported: TARGET_SET, APPLICATION_SUBMITTED, FOLLOWUP_RECEIVED, DISCOVERED, SCREENED, TAILORED, USER_DECIDED, QUIRK_LEARNED, AGENT_ACTIVITY, AGENT_WAITING, PLAN_RECORDED, CHECKPOINT_RECORDED, ATTEMPT_RECORDED, ATTEMPT_RESOLVED, APPLICATION_IMPORTED, PROFILE_CHANGED, RESUME_IMPORTED, SKILL_REVISED)`], inboxFile));
        continue;
      }
      const targetResult = applyTargetSet(baseDir, taskId, (parsed as { payload?: unknown }).payload, inboxFile);
      results.push(targetResult);
      if (targetResult.outcome === "committed") markGit(baseDir, taskId, "TARGET_SET");
    }
    return results;
  } finally {
    writeHeartbeat(baseDir, pollError ? "error" : opts.continuous ? "running" : "idle", pollError);
  }
}

export function heartbeatStatus(baseDir: string, nowMs?: number) {
  return readHeartbeatStatus(baseDir, nowMs);
}
