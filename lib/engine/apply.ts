import { atomicWriteFileSync as writeFileSync } from "./storage.ts";
// Stage 2 real write for APPLICATION_SUBMITTED (Doc-00 section 9).
// This is the commit half of stage 1's dry-run expand: it calls
// expandApplicationSubmitted for guards and the expansion, then
// performs backup -> journal -> write -> validate -> verify ->
// commit journal. It writes no receipt, run record, or inbox
// move; the daemon owns those, so a failed apply can still be
// reported uniformly. On any failure after journal begin, the
// journal restores the prior contents before returning errors.
//
// Two deliberate choices, both following current practice:
// - daily.json is updated incrementally here (apply = the
//   expansion's preview) so post-write validate stays green;
//   stage 3 replaces this with full derivation from runs+ledger.
// - the ledger file is appended to, never rewritten whole:
//   old rows on disk include 18-column rows, and rewriting
//   them through serializeLedgerCsv would refuse or alter them.
//   The new row is written as one correct 19-column line.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { backupData } from "../backup.ts";
import { parseCsv } from "../csv.ts";
import { expandApplicationSubmitted, type ChangeSetInput, type Expansion } from "./expand.ts";
import { beginJournal, commitJournal, restoreJournal } from "./journal.ts";
import { applicationsFileSchema, attemptFileSchema, changelogFileSchema, dailyFileSchema, jobsFileSchema } from "./schema.ts";
import { canonicalJson, csvField } from "./serialize.ts";
import { validateDataDir } from "./validate.ts";

export type ApplyResult =
  | { ok: true; expansion: Expansion }
  | { ok: false; errors: string[] };

const FILES = ["jobs.json", "applications.json", "mirror/ledger.csv", "changelog.json", "daily.json", "attempts.json"];

function readJsonFile(full: string): unknown {
  return JSON.parse(readFileSync(full, "utf-8"));
}

export function applyApplicationSubmitted(baseDir: string, changeset: ChangeSetInput, opts: { today?: string } = {}): ApplyResult {
  const dataDir = path.join(baseDir, "data");
  const expanded = expandApplicationSubmitted(baseDir, changeset, opts);
  if (!expanded.ok) return expanded;
  const expansion = expanded.expansion;
  const stamp = changeset.createdAt;
  let journalBegun = false;
  try {
    backupData(baseDir, FILES, changeset.taskId);
    beginJournal(baseDir, changeset.taskId, FILES);
    journalBegun = true;

    const jobsPath = path.join(dataDir, "jobs.json");
    const jobsParsed = jobsFileSchema.safeParse(readJsonFile(jobsPath));
    if (!jobsParsed.success) throw new Error("jobs.json: invalid");
    const jobsData = jobsParsed.data as { jobs: Record<string, unknown>[]; version: number };
    const jobIndex = jobsData.jobs.findIndex((j) => (j as { id?: unknown }).id === expansion.job.id);
    if (jobIndex < 0) throw new Error(`job ${String(expansion.job.id)} disappeared between expand and write`);
    jobsData.jobs[jobIndex] = expansion.job;
    writeFileSync(jobsPath, canonicalJson({ ...jobsData, version: expansion.jobsFileVersion, updatedAt: stamp }), "utf-8");

    const appsPath = path.join(dataDir, "applications.json");
    const appsParsed = applicationsFileSchema.safeParse(readJsonFile(appsPath));
    if (!appsParsed.success) throw new Error("applications.json: invalid");
    const appsData = appsParsed.data as { applications: Record<string, unknown>[]; version: number };
    appsData.applications.push(expansion.application);
    writeFileSync(appsPath, canonicalJson({ ...appsData, version: expansion.applicationsFileVersion, updatedAt: stamp }), "utf-8");

    // Stage C: consume the cited submission attempt (expand already
    // validated it is confirmed and unconsumed). Marking it here, in
    // the same journal, keeps one-attempt-one-application atomic.
    const attemptId = changeset.payload.attemptId;
    if (attemptId) {
      const attemptsPath = path.join(dataDir, "attempts.json");
      const attemptsParsed = attemptFileSchema.safeParse(readJsonFile(attemptsPath));
      if (!attemptsParsed.success) throw new Error("attempts.json: invalid");
      const attemptsData = attemptsParsed.data as { attempts: Record<string, unknown>[]; version: number };
      const attempt = attemptsData.attempts.find((a) => a.attemptId === attemptId);
      if (!attempt) throw new Error(`attempt ${attemptId} disappeared between expand and write`);
      attempt.applicationId = expansion.application.id;
      const history = Array.isArray(attempt.history) ? [...(attempt.history as unknown[])] : [];
      history.push({ at: stamp, action: "application-submitted", byTaskId: changeset.taskId });
      attempt.history = history;
      attempt.updatedAt = stamp;
      writeFileSync(attemptsPath, canonicalJson({ ...attemptsData, version: attemptsData.version + 1, updatedAt: stamp }), "utf-8");
    }

    const ledgerPath = path.join(dataDir, "mirror", "ledger.csv");
    const ledgerText = readFileSync(ledgerPath, "utf-8");
    const ledgerLine = expansion.ledgerRow.map(csvField).join(",");
    writeFileSync(ledgerPath, (ledgerText.endsWith("\n") ? ledgerText : ledgerText + "\n") + ledgerLine + "\n", "utf-8");

    const changelogPath = path.join(dataDir, "changelog.json");
    const changelogParsed = existsSync(changelogPath)
      ? changelogFileSchema.safeParse(readJsonFile(changelogPath))
      : { success: true, data: { entries: [], version: 0, updatedAt: "" } } as const;
    if (!changelogParsed.success) throw new Error("changelog.json: invalid");
    const changelogData = changelogParsed.data as { entries: Record<string, unknown>[]; version: number };
    changelogData.entries.push(expansion.changelogEntry);
    writeFileSync(changelogPath, canonicalJson({ ...changelogData, version: changelogData.version + 1, updatedAt: stamp }), "utf-8");

    const dailyPath = path.join(dataDir, "daily.json");
    const parsedDaily = existsSync(dailyPath) ? dailyFileSchema.safeParse(readJsonFile(dailyPath)) : null;
    if (parsedDaily && !parsedDaily.success) throw new Error("daily.json: invalid; refusing to replace history");
    const dailyData = parsedDaily?.success ? parsedDaily.data : { days: {}, version: 0 };
    // daily 的键必须是展开用的同一天（expansion.today），不能回退到 createdAt 日期，
    // 否则展开按处理日算、入账按创建日写，两边错位，写后校验会拒收。
    const today = expansion.today;
    const days = { ...(dailyData.days ?? {}) };
    days[today] = { ...(days[today] ?? { discovery: 0, screening: 0, tailoring: 0, review: 0, apply: 0 }), apply: expansion.dailyApplyPreview };
    writeFileSync(dailyPath, canonicalJson({ ...dailyData, days, version: (dailyData.version ?? 0) + 1, updatedAt: stamp }), "utf-8");

    const validation = validateDataDir(baseDir);
    if (validation.errors.length) throw new Error(`post-write validate failed: ${validation.errors.join("; ")}`);

    const verifyJobs = jobsFileSchema.safeParse(readJsonFile(jobsPath));
    const verifyApps = applicationsFileSchema.safeParse(readJsonFile(appsPath));
    const verifyLedgerRows = parseCsv(readFileSync(ledgerPath, "utf-8"));
    const lastRow = verifyLedgerRows[verifyLedgerRows.length - 1];
    const jobAfter = verifyJobs.success ? (verifyJobs.data as { jobs: { id?: unknown; status?: unknown }[] }).jobs.find((j) => j.id === expansion.job.id) : undefined;
    if (!verifyJobs.success || jobAfter?.status !== "applied") throw new Error("verify failed: job not applied after write");
    if (!verifyApps.success || !(verifyApps.data as { applications: { id?: unknown }[] }).applications.some((a) => a.id === expansion.application.id))
      throw new Error("verify failed: application missing after write");
    if (!lastRow || lastRow[0] !== String(expansion.ledgerId) || lastRow.length !== 19)
      throw new Error("verify failed: ledger row missing or not 19 columns after write");

    commitJournal(baseDir, changeset.taskId);
    return { ok: true, expansion };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (journalBegun) {
      try { restoreJournal(baseDir, changeset.taskId); } catch { /* journal already gone */ }
    }
    return { ok: false, errors: [message] };
  }
}
