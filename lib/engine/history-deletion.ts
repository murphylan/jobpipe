import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseCsv } from "../csv.ts";
import { commitFiles } from "./events.ts";
import { withEngineLock } from "./lock.ts";
import { deferJournalCommit, finishJournal } from "./journal.ts";
import { canonicalJson } from "./serialize.ts";
import { atomicWriteFileSync } from "./storage.ts";
import { readReceipt, writeReceipt } from "./receipt.ts";
import { writeState } from "./state.ts";
import { commitDataGit } from "./git.ts";
import { assertSafeTaskId } from "./envelope.ts";

export const HISTORY_FILES = ["activity.json", "applications.json", "mirror/ledger.csv"] as const;
export type HistoryDeletionRequest = {
  taskId: string;
  authorization: string;
  activityIds: string[];
  applicationIds: string[];
  ledgerIds: string[];
  hashes: Record<string, string>;
};
export const historyHash = (text: string) => createHash("sha256").update(text).digest("hex");

/** Explicitly authorized maintenance only; never inferred from reconciliation warnings. */
export function deleteAuthorizedHistory(base: string, request: HistoryDeletionRequest) {
  return withEngineLock(base, () => {
    assertSafeTaskId(request.taskId);
    if (!request.authorization?.trim()) throw new Error("User authorization required");
    const prior = readReceipt(base, request.taskId);
    const inputHash = historyHash(canonicalJson(request));
    if (prior) {
      if (prior.inputHash !== inputHash || prior.status !== "committed") throw new Error("Conflicting prior receipt");
      return prior;
    }
    for (const key of ["activityIds", "applicationIds", "ledgerIds"] as const) {
      if (!Array.isArray(request[key]) || request[key].some(id => typeof id !== "string" || !id) || new Set(request[key]).size !== request[key].length) throw new Error(`Invalid ${key}`);
    }
    const content = Object.fromEntries(HISTORY_FILES.map(file => {
      const text = readFileSync(path.join(base, "data", file), "utf8");
      if (historyHash(text) !== request.hashes[file]) throw new Error(`Source changed: ${file}`);
      return [file, text];
    }));
    const activities = JSON.parse(content["activity.json"]);
    const applications = JSON.parse(content["applications.json"]);
    const records = csvRecords(content["mirror/ledger.csv"]);
    const header = parseCsv(records[0])[0];
    const idColumn = header.indexOf("id");
    if (idColumn < 0) throw new Error("Ledger id column missing");
    const ledgerIds = records.slice(1).map(record => parseCsv(record)[0]?.[idColumn]);
    for (const [requested, actual] of [[request.activityIds, activities.activities.map((a: { activityId: string }) => a.activityId)], [request.applicationIds, applications.applications.map((a: { id: string }) => a.id)], [request.ledgerIds, ledgerIds]] as [string[], string[]][]) {
      if (requested.some(id => !actual.includes(id))) throw new Error("Requested record missing");
    }
    const stamp = new Date().toISOString();
    const activitySet = new Set(request.activityIds), appSet = new Set(request.applicationIds), ledgerSet = new Set(request.ledgerIds);
    const keptActivities = activities.activities.filter((a: { activityId: string }) => !activitySet.has(a.activityId));
    const keptApplications = applications.applications.filter((a: { id: string; ledgerRowId: string }) => !appSet.has(a.id));
    if (keptApplications.some((a: { ledgerRowId: string }) => ledgerSet.has(a.ledgerRowId))) throw new Error("Ledger row still referenced by retained application");
    const ops = { activityIds: request.activityIds, activityRows: activities.activities.length - keptActivities.length, applicationIds: request.applicationIds, ledgerIds: request.ledgerIds };
    const files = [...HISTORY_FILES, "changelog.json"];
    const result = deferJournalCommit(base, () => commitFiles(base, request.taskId, files, () => {
      atomicWriteFileSync(path.join(base, "data/activity.json"), canonicalJson({ ...activities, activities: keptActivities, version: activities.version + 1, updatedAt: stamp }));
      atomicWriteFileSync(path.join(base, "data/applications.json"), canonicalJson({ ...applications, applications: keptApplications, version: applications.version + 1, updatedAt: stamp }));
      atomicWriteFileSync(path.join(base, "data/mirror/ledger.csv"), records.filter((_, index) => index === 0 || !ledgerSet.has(ledgerIds[index - 1])).join(""));
      const changelogPath = path.join(base, "data/changelog.json");
      const log = existsSync(changelogPath) ? JSON.parse(readFileSync(changelogPath, "utf8")) : { entries: [] };
      log.entries.push({ at: stamp, action: "history-deleted", target: "activity.json / applications.json / mirror/ledger.csv", version: applications.version + 1, note: canonicalJson({ authorization: request.authorization, ...ops }).trim() });
      atomicWriteFileSync(changelogPath, canonicalJson(log));
    }));
    if (!result.ok) throw new Error(result.errors.join("; "));
    const receipt = { taskId: request.taskId, event: "AUTHORIZED_HISTORY_DELETED", status: "committed" as const, createdAt: stamp, inputHash, summary: `Deleted ${request.activityIds.length} activities (${ops.activityRows} signals), ${request.applicationIds.length} applications, ${request.ledgerIds.length} ledger rows`, ops };
    writeReceipt(base, receipt);
    atomicWriteFileSync(path.join(base, "data/runs", `${request.taskId}.json`), canonicalJson({ ...receipt, finishedAt: stamp }));
    writeState(base, request.taskId, { paths: files });
    finishJournal(base, request.taskId);
    const git = commitDataGit(base, request.taskId, [...files, `receipts/${request.taskId}.json`, `receipts/${request.taskId}.md`, `runs/${request.taskId}.json`]);
    return { ...receipt, git };
  });
}

/** Preserve retained CSV records byte-for-byte, including quoted newlines and legacy column counts. */
export function csvRecords(text: string): string[] {
  const records: string[] = [];
  let quoted = false, start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') {
      if (quoted && text[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted && (text[i] === "\n" || text[i] === "\r")) {
      if (text[i] === "\r" && text[i + 1] === "\n") i++;
      records.push(text.slice(start, i + 1)); start = i + 1;
    }
  }
  if (quoted) throw new Error("Malformed CSV quotes");
  if (start < text.length) records.push(text.slice(start));
  return records;
}
