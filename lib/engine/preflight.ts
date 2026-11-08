// Preflight check for APPLICATION_SUBMITTED (2026-11-05).
// Tells Muse what's missing BEFORE submitting, instead of
// rejecting one error at a time. Read-only: never writes.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type PreflightResult = {
  ok: boolean;
  jobId: string;
  checks: { name: string; ok: boolean; detail: string }[];
};

function readJson(baseDir: string, rel: string): unknown | null {
  const full = path.join(baseDir, rel);
  if (!existsSync(full)) return null;
  try {
    return JSON.parse(readFileSync(full, "utf-8"));
  } catch {
    return null;
  }
}

export function preflightApplicationSubmitted(baseDir: string, jobId: string): PreflightResult {
  const checks: PreflightResult["checks"] = [];

  // 1. job exists
  const jobsData = readJson(baseDir, "data/jobs.json") as { jobs?: { id: string; status: string; jdKind?: string }[] } | null;
  const job = jobsData?.jobs?.find((j) => j.id === jobId);
  if (!job) {
    checks.push({ name: "job-exists", ok: false, detail: `job ${jobId} not found in jobs.json` });
    return { ok: false, jobId, checks };
  }
  checks.push({ name: "job-exists", ok: true, detail: `found, status=${job.status}` });

  // 2. status == approved
  if (job.status === "approved") {
    checks.push({ name: "status-approved", ok: true, detail: "status is approved" });
  } else {
    checks.push({ name: "status-approved", ok: false, detail: `status is ${job.status}, must be approved (E_GUARD:not-approved)` });
  }

  // 3. jdKind == full
  if (job.jdKind === "full") {
    checks.push({ name: "jdKind-full", ok: true, detail: 'jdKind is "full"' });
  } else {
    checks.push({
      name: "jdKind-full",
      ok: false,
      detail: `jdKind is ${JSON.stringify(job.jdKind ?? null)}, must be "full" (E_GUARD:jd-not-full). Fix: send SCREENED event with jdKind: "full".`,
    });
  }

  // 4. resume version registered for this job
  const rvData = readJson(baseDir, "data/resume-versions.json") as { versions?: { version: string; jobId: string; file: string }[] } | null;
  const versions = (rvData?.versions ?? []).filter((v) => v.jobId === jobId);
  if (versions.length === 0) {
    checks.push({
      name: "resume-registered",
      ok: false,
      detail: `no resume version registered for ${jobId}. Fix: send TAILORED event first.`,
    });
  } else {
    const latest = versions[versions.length - 1];
    const pdfPath = path.join(baseDir, latest.file);
    if (existsSync(pdfPath)) {
      checks.push({ name: "resume-registered", ok: true, detail: `version ${latest.version}, PDF exists` });
    } else {
      checks.push({
        name: "resume-registered",
        ok: false,
        detail: `version ${latest.version} registered but PDF missing at ${latest.file} (E_GUARD:resume-file-missing)`,
      });
    }
  }

  const ok = checks.every((c) => c.ok);
  return { ok, jobId, checks };
}
