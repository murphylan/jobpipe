import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { atomicWriteFileSync as writeFileSync } from "./storage.ts";
// APPLICATION_IMPORTED: explicitly authorized import of historical applications.
// Use only when an existing confirmed ledger record has no application record.
// Import links that existing fact without performing another external submission.
// Scope:
//
// - The job must already be marked applied; the import never flips a
//   job status, never appends a ledger row, and never touches
//   daily.json (historical daily counts are not rewritten).
// - The cited ledger row must exist, be submission_status=confirmed,
//   and agree with the job on company and role (normalized) and on
//   the resume version it recorded; the version must be registered
//   with its PDF on disk.
// - Neither the job nor the ledger row may already have an
//   application record (one row <-> one application, enforced both
//   ways), so imports cannot duplicate.
// - Evidence must carry the employer confirmation (quoted from the
//   ledger row) and the user's import authorization.
//
// Writes only applications.json + changelog.json, through the same
// commitFiles journal as the other stage-3 events.
import { commitFiles, readJsonFile, type EventResult, type GenericChangeSet } from "./events.ts";
import { applicationsFileSchema, changelogFileSchema, jobsFileSchema, resumeVersionsFileSchema } from "./schema.ts";
import { canonicalJson } from "./serialize.ts";
import { parseCsv } from "../csv.ts";

const APP_STAGES = new Set([
  "todo", "applied", "replied", "screen", "interview", "offer",
  "rejected", "rejected_after_contact", "withdrawn", "ghosted",
]);

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, "");
}

function hasEvidenceKind(cs: GenericChangeSet, kind: string): boolean {
  return (cs.evidence ?? []).some((e) => e.kind === kind && typeof e.text === "string" && e.text !== "");
}

function writeChangelog(baseDir: string, stamp: string, action: string, target: string, version: number, note: string): void {
  const changelogPath = path.join(baseDir, "data", "changelog.json");
  const parsed = existsSync(changelogPath)
    ? changelogFileSchema.safeParse(readJsonFile(changelogPath))
    : { success: true, data: { entries: [], version: 0, updatedAt: "" } } as const;
  if (!parsed.success) throw new Error("changelog.json: invalid");
  const data = parsed.data as { entries: Record<string, unknown>[]; version: number };
  data.entries.push({ at: stamp, action, target, version, note });
  writeFileSync(changelogPath, canonicalJson({ ...data, version: data.version + 1, updatedAt: stamp }), "utf-8");
}

export function applyApplicationImported(baseDir: string, cs: GenericChangeSet): EventResult {
  const stamp = cs.createdAt;
  const jobId = cs.payload.jobId;
  const ledgerRowId = cs.payload.ledgerRowId;
  const resumeVersion = cs.payload.resumeVersion;
  if (typeof jobId !== "string" || jobId === "") return { ok: false, errors: ["E_SCHEMA: payload.jobId missing"] };
  if (typeof ledgerRowId !== "string" || ledgerRowId === "") return { ok: false, errors: ["E_SCHEMA: payload.ledgerRowId missing"] };
  if (typeof resumeVersion !== "string" || resumeVersion === "") return { ok: false, errors: ["E_SCHEMA: payload.resumeVersion missing"] };
  if (!hasEvidenceKind(cs, "employer-confirmation"))
    return { ok: false, errors: ["E_EVIDENCE_MISSING: import needs an employer-confirmation entry"] };
  if (!hasEvidenceKind(cs, "user-approval"))
    return { ok: false, errors: ["E_EVIDENCE_MISSING: import needs a user-approval entry"] };
  let summary = "";
  const result = commitFiles(baseDir, cs.taskId, ["applications.json", "changelog.json"], () => {
    const dataDir = path.join(baseDir, "data");

    const jobsParsed = jobsFileSchema.safeParse(readJsonFile(path.join(dataDir, "jobs.json")));
    if (!jobsParsed.success) throw new Error("jobs.json: invalid");
    const job = (jobsParsed.data as { jobs: Record<string, unknown>[] }).jobs.find((j) => j.id === jobId);
    if (!job) throw new Error(`E_GUARD:job-not-found: ${jobId}`);
    if (job.status !== "applied")
      throw new Error(`E_GUARD:not-applied: job ${jobId} status is ${String(job.status)}; imports only repair jobs already marked applied`);

    const appsParsed = applicationsFileSchema.safeParse(readJsonFile(path.join(dataDir, "applications.json")));
    if (!appsParsed.success) throw new Error("applications.json: invalid");
    const appsData = appsParsed.data as { applications: Record<string, unknown>[]; version: number };
    if (appsData.applications.some((a) => a.ledgerRowId === ledgerRowId))
      throw new Error(`E_DUPLICATE: ledger row ${ledgerRowId} already has an application record`);
    if (appsData.applications.some((a) => a.jobId === jobId))
      throw new Error(`E_DUPLICATE: job ${jobId} already has an application record`);

    const ledgerPath = path.join(dataDir, "mirror", "ledger.csv");
    if (!existsSync(ledgerPath)) throw new Error("ledger.csv: real mirror file missing");
    const ledgerRows = parseCsv(readFileSync(ledgerPath, "utf-8").replace(/^\uFEFF/, ""));
    const row = ledgerRows.slice(1).find((r) => (r[0] ?? "").trim() === ledgerRowId);
    if (!row) throw new Error(`E_GUARD:ledger-row-not-found: no ledger row ${ledgerRowId}`);
    const cell = (idx: number) => (row[idx] ?? "").trim();
    if (cell(10) !== "confirmed")
      throw new Error(`E_GUARD:ledger-not-confirmed: ledger row ${ledgerRowId} submission_status is ${cell(10) || "missing"}`);
    if (normalizeName(cell(2)) !== normalizeName(String(job.company ?? "")) || normalizeName(cell(3)) !== normalizeName(String(job.role ?? "")))
      throw new Error(`E_GUARD:ledger-job-mismatch: ledger row ${ledgerRowId} is ${cell(2)} / ${cell(3)}, job ${jobId} is ${String(job.company ?? "")} / ${String(job.role ?? "")}`);
    if (cell(8) !== resumeVersion)
      throw new Error(`E_GUARD:resume-version-mismatch: ledger row ${ledgerRowId} recorded ${cell(8) || "no version"}, payload cites ${resumeVersion}`);

    const rvParsed = resumeVersionsFileSchema.safeParse(readJsonFile(path.join(dataDir, "resume-versions.json")));
    if (!rvParsed.success) throw new Error("resume-versions.json: invalid");
    const version = (rvParsed.data as { versions: Record<string, unknown>[] }).versions.find((v) => v.version === resumeVersion);
    if (!version) throw new Error(`E_GUARD:resume-not-registered: ${resumeVersion}`);
    if (!version.file || !existsSync(path.join(baseDir, String(version.file))))
      throw new Error(`E_GUARD:resume-file-missing: ${String(version.file ?? "")} is not on disk`);

    const dateSubmitted = cell(1);
    const applicationId = `${dateSubmitted}-${jobId}`;
    if (appsData.applications.some((a) => a.id === applicationId))
      throw new Error(`E_DUPLICATE: application ${applicationId} already exists`);
    const ledgerStage = cell(12);
    const application: Record<string, unknown> = {
      id: applicationId,
      jobId,
      ledgerRowId,
      resumeVersion,
      // The ledger row is the submission's own record, so its channel
      // (e.g. "Indeed Easy Apply") is the faithful source value here,
      // not the job's discovery channel.
      source: cell(5) || String(job.channel ?? ""),
      collectedAt: stamp,
      appliedAt: dateSubmitted,
      employerConfirmed: true,
      stage: APP_STAGES.has(ledgerStage) ? ledgerStage : "applied",
      nextAction: cell(15) || null,
      nextActionDue: cell(16) || null,
      interviewAt: null,
      notes: `Historical import via APPLICATION_IMPORTED (${cs.taskId}); approval recorded in the Engine decision. Pre-tracking submission recorded in ledger row ${ledgerRowId}; ledger evidence: ${cell(11)}`,
      version: 1,
      updatedAt: stamp,
    };
    appsData.applications.push(application);
    writeFileSync(path.join(dataDir, "applications.json"), canonicalJson({ ...appsData, version: appsData.version + 1, updatedAt: stamp }), "utf-8");
    writeChangelog(baseDir, stamp, "application-imported", "applications.json", appsData.version, `${cs.taskId} imported ${jobId} <- ledger ${ledgerRowId} (${cell(2)}, submitted ${dateSubmitted})`);
    summary = `APPLICATION_IMPORTED ${jobId} <- ledger ${ledgerRowId}`;
  });
  if (!result.ok) return result;
  return { ok: true, summary };
}
