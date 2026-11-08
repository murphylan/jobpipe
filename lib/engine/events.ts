import { assertSafeTaskId } from "./envelope.ts";
import { atomicWriteFileSync as writeFileSync } from "./storage.ts";
// Stage 3 events, first batch: FOLLOWUP_RECEIVED and DISCOVERED
// (Doc-00 section 7.6 order, after APPLICATION_SUBMITTED).
// Both follow the same commit pattern as apply.ts: backup ->
// journal -> write -> validate -> verify -> commit journal,
// restore on any failure. Neither writes a receipt, run record,
// or inbox move; the daemon owns those.
//
// FOLLOWUP_RECEIVED updates only 5 ledger columns (stage,
// last_contact_date, next_action, next_action_date, notes when
// given) plus the matching application's stage/next action.
// The ledger file is edited line-by-line, never rewritten
// whole, so old 18-column rows stay byte-for-byte intact.
// DISCOVERED appends a new job. Daily business throughput is derived
// from the daemon's committed run records, never from current backlog.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { backupData } from "../backup.ts";
import { parseCsv } from "../csv.ts";
import { beginJournal, commitJournal, restoreJournal } from "./journal.ts";
import { applicationsFileSchema, changelogFileSchema, jobsFileSchema } from "./schema.ts";
import { canonicalJson, csvField } from "./serialize.ts";
import { validateDataDir } from "./validate.ts";

export type GenericChangeSet = {
  taskId: string;
  event: string;
  createdAt: string;
  payload: Record<string, unknown>;
  evidence?: { kind: string; text: string }[];
};
export type EventResult =
  | { ok: true; summary: string }
  | { ok: false; errors: string[] };

export function readJsonFile(full: string): unknown {
  return JSON.parse(readFileSync(full, "utf-8"));
}

function hasEvidence(cs: GenericChangeSet, kinds: string[]): boolean {
  return (cs.evidence ?? []).some((e) => kinds.includes(e.kind) && typeof e.text === "string" && e.text !== "");
}

export function commitFiles(baseDir: string, taskId: string, files: string[], write: () => void): EventResult {
  let journalBegun = false;
  try {
    assertSafeTaskId(taskId);
    backupData(baseDir, files, taskId);
    beginJournal(baseDir, taskId, files);
    journalBegun = true;
    write();
    const validation = validateDataDir(baseDir);
    if (validation.errors.length) throw new Error(`post-write validate failed: ${validation.errors.join("; ")}`);
    commitJournal(baseDir, taskId);
    return { ok: true, summary: "" };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (journalBegun) {
      try { restoreJournal(baseDir, taskId); } catch { /* journal already gone */ }
    }
    return { ok: false, errors: [message] };
  }
}

export function applyFollowupReceived(baseDir: string, cs: GenericChangeSet): EventResult {
  const dataDir = path.join(baseDir, "data");
  const stamp = cs.createdAt;
  const rowId = String(cs.payload.ledgerRowId ?? "");
  const stage = cs.payload.stage;
  if (rowId === "") return { ok: false, errors: ["E_SCHEMA: payload.ledgerRowId missing"] };
  if (typeof stage !== "string" || stage === "") return { ok: false, errors: ["E_SCHEMA: payload.stage missing"] };
  if (!hasEvidence(cs, ["employer-message", "employer-confirmation"]))
    return { ok: false, errors: ["E_EVIDENCE_MISSING: followup needs an employer-message or employer-confirmation entry"] };
  const files = ["applications.json", "mirror/ledger.csv", "changelog.json"];
  let summary = "";
  const result = commitFiles(baseDir, cs.taskId, files, () => {
    const ledgerPath = path.join(dataDir, "mirror", "ledger.csv");
    const raw = readFileSync(ledgerPath, "utf-8");
    const lines = raw.split("\n");
    const idx = lines.findIndex((line) => line !== "" && line.split(",")[0] === rowId);
    if (idx < 0) throw new Error(`E_GUARD:ledger-row-not-found: no ledger row ${rowId}`);
    const row = parseCsv(lines[idx])[0];
    if (!row || row.length < 17) throw new Error(`ledger row ${rowId} is too short to update`);
    const next = [...row];
    while (next.length < 19) next.push("");
    next[12] = stage;
    next[13] = typeof cs.payload.lastContactDate === "string" ? cs.payload.lastContactDate : stamp.slice(0, 10);
    if (typeof cs.payload.nextAction === "string") next[15] = cs.payload.nextAction;
    if (typeof cs.payload.nextActionDate === "string") next[16] = cs.payload.nextActionDate;
    if (typeof cs.payload.notes === "string") next[18] = cs.payload.notes;
    lines[idx] = next.map(csvField).join(",");
    writeFileSync(ledgerPath, lines.join("\n"), "utf-8");

    const appsPath = path.join(dataDir, "applications.json");
    const appsParsed = applicationsFileSchema.safeParse(readJsonFile(appsPath));
    if (!appsParsed.success) throw new Error("applications.json: invalid");
    const appsData = appsParsed.data as { applications: Record<string, unknown>[]; version: number };
    const app = appsData.applications.find((a) => String(a.ledgerRowId ?? "") === rowId);
    if (app) {
      app.stage = stage;
      if (typeof cs.payload.nextAction === "string") app.nextAction = cs.payload.nextAction;
      if (typeof cs.payload.nextActionDate === "string") app.nextActionDue = cs.payload.nextActionDate;
    }
    writeFileSync(appsPath, canonicalJson({ ...appsData, version: appsData.version + 1, updatedAt: stamp }), "utf-8");

    const changelogPath = path.join(dataDir, "changelog.json");
    const changelogParsed = existsSync(changelogPath)
      ? changelogFileSchema.safeParse(readJsonFile(changelogPath))
      : { success: true, data: { entries: [], version: 0, updatedAt: "" } } as const;
    if (!changelogParsed.success) throw new Error("changelog.json: invalid");
    const changelogData = changelogParsed.data as { entries: Record<string, unknown>[]; version: number };
    changelogData.entries.push({ at: stamp, action: "followup-received", target: "applications.json, mirror/ledger.csv", version: appsData.version, note: `${cs.taskId} ledger ${rowId} -> ${stage}` });
    writeFileSync(changelogPath, canonicalJson({ ...changelogData, version: changelogData.version + 1, updatedAt: stamp }), "utf-8");
    summary = `FOLLOWUP_RECEIVED ledger ${rowId} -> ${stage}`;
  });
  if (!result.ok) return result;
  return { ok: true, summary };
}

export function applyDiscovered(baseDir: string, cs: GenericChangeSet): EventResult {
  const dataDir = path.join(baseDir, "data");
  const stamp = cs.createdAt;
  const job = cs.payload.job;
  if (!job || typeof job !== "object" || Array.isArray(job))
    return { ok: false, errors: ["E_SCHEMA: payload.job missing"] };
  const jobObj = job as Record<string, unknown>;
  for (const field of ["id", "company", "role", "channel"]) {
    if (typeof jobObj[field] !== "string" || jobObj[field] === "")
      return { ok: false, errors: [`E_SCHEMA: payload.job.${field} missing`] };
  }
  const files = ["jobs.json", "changelog.json", "daily.json"];
  let summary = "";
  const result = commitFiles(baseDir, cs.taskId, files, () => {
    const jobsPath = path.join(dataDir, "jobs.json");
    const jobsParsed = jobsFileSchema.safeParse(readJsonFile(jobsPath));
    if (!jobsParsed.success) throw new Error("jobs.json: invalid");
    const jobsData = jobsParsed.data as { jobs: Record<string, unknown>[]; version: number };
    if (jobsData.jobs.some((j) => j.id === jobObj.id))
      throw new Error(`E_DUPLICATE: job ${String(jobObj.id)} already exists`);
    const newJob = { ...jobObj, status: "new" };
    jobsData.jobs.push(newJob);
    writeFileSync(jobsPath, canonicalJson({ ...jobsData, version: jobsData.version + 1, updatedAt: stamp }), "utf-8");

    const changelogPath = path.join(dataDir, "changelog.json");
    const changelogParsed = existsSync(changelogPath)
      ? changelogFileSchema.safeParse(readJsonFile(changelogPath))
      : { success: true, data: { entries: [], version: 0, updatedAt: "" } } as const;
    if (!changelogParsed.success) throw new Error("changelog.json: invalid");
    const changelogData = changelogParsed.data as { entries: Record<string, unknown>[]; version: number };
    changelogData.entries.push({ at: stamp, action: "discovered", target: "jobs.json", version: jobsData.version, note: `${cs.taskId} discovered ${String(jobObj.id)}` });
    writeFileSync(changelogPath, canonicalJson({ ...changelogData, version: changelogData.version + 1, updatedAt: stamp }), "utf-8");

    summary = `DISCOVERED ${String(jobObj.id)}`;
  });
  if (!result.ok) return result;
  return { ok: true, summary };
}
