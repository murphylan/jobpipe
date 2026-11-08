import { prepareResumeEvidence, registeredResumeSha256 } from "./resume-evidence.ts";
import { atomicWriteFileSync as writeFileSync } from "./storage.ts";
// Stage 3 events, second batch: SCREENED, TAILORED, USER_DECIDED
// (Doc-00 section 7.6 order). All reuse events.ts commitFiles:
// backup -> journal -> write -> validate -> commit, restore
// on failure. Daily throughput is derived from committed runs by the daemon;
// handlers never increment or rewrite historical daily counts.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { commitFiles, readJsonFile, type EventResult, type GenericChangeSet } from "./events.ts";
import { changelogFileSchema, jobsFileSchema, resumeVersionsFileSchema } from "./schema.ts";
import { canonicalJson } from "./serialize.ts";

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

function findJob(baseDir: string, jobId: string): { jobsData: { jobs: Record<string, unknown>[]; version: number }; job: Record<string, unknown> } {
  const jobsPath = path.join(baseDir, "data", "jobs.json");
  const parsed = jobsFileSchema.safeParse(readJsonFile(jobsPath));
  if (!parsed.success) throw new Error("jobs.json: invalid");
  const jobsData = parsed.data as { jobs: Record<string, unknown>[]; version: number };
  const job = jobsData.jobs.find((j) => j.id === jobId);
  if (!job) throw new Error(`E_GUARD:job-not-found: ${jobId}`);
  return { jobsData, job };
}

function writeJobs(baseDir: string, jobsData: { jobs: Record<string, unknown>[]; version: number }, stamp: string): void {
  writeFileSync(path.join(baseDir, "data", "jobs.json"), canonicalJson({ ...jobsData, version: jobsData.version + 1, updatedAt: stamp }), "utf-8");
}

export function applyScreened(baseDir: string, cs: GenericChangeSet): EventResult {
  const stamp = cs.createdAt;
  const jobId = cs.payload.jobId;
  const conclusion = cs.payload.conclusion;
  if (typeof jobId !== "string" || jobId === "") return { ok: false, errors: ["E_SCHEMA: payload.jobId missing"] };
  if (conclusion !== "apply" && conclusion !== "drop" && conclusion !== "pending")
    return { ok: false, errors: ["E_SCHEMA: payload.conclusion must be apply, drop, or pending"] };
  let summary = "";
  const result = commitFiles(baseDir, cs.taskId, ["jobs.json", "changelog.json", "daily.json"], () => {
    const { jobsData, job } = findJob(baseDir, jobId);
    if (job.status !== "new" && job.status !== "screening")
      throw new Error(`E_GUARD:not-screenable: job ${jobId} is ${String(job.status)}`);
    job.status = conclusion === "drop" ? "dropped" : conclusion === "apply" ? "approved" : "screening";
    job.conclusion = conclusion;
    if (Array.isArray(cs.payload.matchPoints)) job.matchPoints = cs.payload.matchPoints;
    if (Array.isArray(cs.payload.redFlags)) job.redFlags = cs.payload.redFlags;
    if (typeof cs.payload.notes === "string") job.notes = cs.payload.notes;
    if (typeof cs.payload.jdKind === "string") job.jdKind = cs.payload.jdKind;
    if (typeof cs.payload.jdMissing === "string") job.jdMissing = cs.payload.jdMissing;
    writeJobs(baseDir, jobsData, stamp);
    writeChangelog(baseDir, stamp, "screened", "jobs.json", jobsData.version, `${cs.taskId} screened ${jobId} -> ${conclusion}`);
    summary = `SCREENED ${jobId} -> ${conclusion}`;
  });
  if (!result.ok) return result;
  return { ok: true, summary };
}

export function applyTailored(baseDir: string, cs: GenericChangeSet): EventResult {
  const stamp = cs.createdAt;
  const jobId = cs.payload.jobId;
  const resumeVersion = cs.payload.resumeVersion;
  let evidence: ReturnType<typeof prepareResumeEvidence>;
  try { evidence = prepareResumeEvidence(baseDir, cs.taskId, cs.payload.file); }
  catch (e) { return { ok: false, errors: [e instanceof Error ? e.message : String(e)] }; }
  const file = evidence.file;
  if (typeof jobId !== "string" || jobId === "") return { ok: false, errors: ["E_SCHEMA: payload.jobId missing"] };
  if (typeof resumeVersion !== "string" || resumeVersion === "") return { ok: false, errors: ["E_SCHEMA: payload.resumeVersion missing"] };
  let summary = "";
  const result = commitFiles(baseDir, cs.taskId, ["resume-versions.json", "changelog.json", "daily.json", evidence.journalPath], () => {
    findJob(baseDir, jobId);
    const rvPath = path.join(baseDir, "data", "resume-versions.json");
    const parsed = resumeVersionsFileSchema.safeParse(readJsonFile(rvPath));
    if (!parsed.success) throw new Error("resume-versions.json: invalid");
    const rvData = parsed.data as { versions: Record<string, unknown>[]; version: number };
    // Content-addressed reuse (user decision, 2026-11-08): a resume version
    // exists to capture distinct content. When the submitted PDF is
    // byte-identical to an already-registered version's file, reuse that
    // version: no duplicate record, no second copy of the same bytes. The
    // changelog and this summary carry the job -> version link instead.
    const reused = rvData.versions.find((v) => registeredResumeSha256(baseDir, v.file) === evidence.sha256);
    if (reused) {
      writeChangelog(baseDir, stamp, "tailored", "resume-versions.json", rvData.version, `${cs.taskId} tailored ${jobId} -> ${String(reused.version)} (reused identical content sha256 ${evidence.sha256.slice(0, 12)}; proposed ${resumeVersion} not registered)`);
      summary = `TAILORED ${jobId} -> ${String(reused.version)} (reused identical content)`;
      return;
    }
    if (rvData.versions.some((v) => v.version === resumeVersion))
      throw new Error(`E_DUPLICATE: resume version ${resumeVersion} already registered`);
    evidence.promote();
    rvData.versions.push({ version: resumeVersion, jobId, file, createdAt: stamp, note: typeof cs.payload.note === "string" ? cs.payload.note : "" });
    writeFileSync(rvPath, canonicalJson({ ...rvData, version: rvData.version + 1, updatedAt: stamp }), "utf-8");
    writeChangelog(baseDir, stamp, "tailored", "resume-versions.json", rvData.version, `${cs.taskId} tailored ${jobId} -> ${resumeVersion}`);
    summary = `TAILORED ${jobId} -> ${resumeVersion}`;
  });
  if (!result.ok) return result;
  return { ok: true, summary };
}

export function applyUserDecided(baseDir: string, cs: GenericChangeSet): EventResult {
  const stamp = cs.createdAt;
  const jobId = cs.payload.jobId;
  const decision = cs.payload.decision;
  if (typeof jobId !== "string" || jobId === "") return { ok: false, errors: ["E_SCHEMA: payload.jobId missing"] };
  if (decision !== "apply" && decision !== "drop" && decision !== "hold")
    return { ok: false, errors: ["E_SCHEMA: payload.decision must be apply, drop, or hold"] };
  if (!(cs.evidence ?? []).some((e) => e.kind === "user-approval" && e.text !== ""))
    return { ok: false, errors: ["E_EVIDENCE_MISSING: USER_DECIDED needs a user-approval entry"] };
  let summary = "";
  const result = commitFiles(baseDir, cs.taskId, ["jobs.json", "changelog.json", "daily.json"], () => {
    const { jobsData, job } = findJob(baseDir, jobId);
    if (job.status !== "approved" && job.status !== "screening")
      throw new Error(`E_GUARD:not-decidable: job ${jobId} is ${String(job.status)}`);
    job.status = decision === "drop" ? "dropped" : decision === "hold" ? "screening" : "approved";
    job.conclusion = decision === "drop" ? "drop" : decision === "hold" ? "pending" : "apply";
    if (typeof cs.payload.notes === "string") job.notes = cs.payload.notes;
    writeJobs(baseDir, jobsData, stamp);
    writeChangelog(baseDir, stamp, "user-decided", "jobs.json", jobsData.version, `${cs.taskId} decided ${jobId} -> ${decision}`);
    summary = `USER_DECIDED ${jobId} -> ${decision}`;
  });
  if (!result.ok) return result;
  return { ok: true, summary };
}
