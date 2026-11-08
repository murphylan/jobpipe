// TAILORED content-addressed reuse (user decision, 2026-11-08): a resume
// version captures distinct content. Byte-identical PDFs reuse the existing
// version instead of registering a duplicate record and a second file copy.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyTailored } from "./events2";
import type { GenericChangeSet } from "./events";

const temps: string[] = [];
afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

const PDF_A = "%PDF-1.4 fixture-A";
const PDF_B = "%PDF-1.4 fixture-B";
const PDF_C = "%PDF-1.4 fixture-C";

function fixtureJob(id: string) {
  return { id, company: "TestCo", role: "Software Engineer", channel: "Indeed", location: "Remote", remote: "remote", salaryPosted: null, salaryAnswer: null, matchPoints: [], redFlags: [], conclusion: "apply", status: "approved", url: "https://example.invalid/job", description: "Verified job description. ".repeat(20) };
}

function fixture(): string {
  const base = mkdtempSync(path.join(tmpdir(), "engine-resume-dedupe-"));
  temps.push(base);
  const data = path.join(base, "data");
  for (const d of ["inbox/evidence", "resume-files", "mirror"]) mkdirSync(path.join(data, d), { recursive: true });
  const W = (rel: string, v: unknown) => writeFileSync(path.join(data, rel), JSON.stringify(v));
  W("jobs.json", { jobs: [fixtureJob("job-a"), fixtureJob("job-b"), fixtureJob("job-c")], version: 1, updatedAt: "2026-11-08T00:00:00Z" });
  W("applications.json", { applications: [], version: 1, updatedAt: "2026-11-08T00:00:00Z" });
  writeFileSync(path.join(data, "mirror/ledger.csv"), "id,date_submitted,company,role,req_url,channel,score,role_family,resume_version,employment_type,submission_status,evidence,stage,last_contact_date,recruiter,next_action,next_action_date,jd_snapshot_path,notes\n");
  writeFileSync(path.join(data, "resume-files/existing.pdf"), PDF_A);
  W("resume-versions.json", { versions: [{ version: "v-existing", jobId: "job-x", file: "data/resume-files/existing.pdf", createdAt: "2026-11-01T00:00:00Z", note: "" }], selected: {}, version: 1, updatedAt: "2026-11-08T00:00:00Z" });
  W("activity.json", { activities: [], version: 1, updatedAt: "2026-11-08T00:00:00Z" });
  W("waiting.json", { items: [], version: 1, updatedAt: "2026-11-08T00:00:00Z" });
  W("changelog.json", { entries: [], version: 1, updatedAt: "2026-11-08T00:00:00Z" });
  W("daily.json", { days: {}, version: 1, updatedAt: "2026-11-08T00:00:00Z" });
  writeFileSync(path.join(data, "inbox/evidence/a.pdf"), PDF_A);
  writeFileSync(path.join(data, "inbox/evidence/b.pdf"), PDF_B);
  writeFileSync(path.join(data, "inbox/evidence/c.pdf"), PDF_C);
  return base;
}

function tailored(taskId: string, jobId: string, resumeVersion: string, file: string): GenericChangeSet {
  return { taskId, event: "TAILORED", createdAt: "2026-11-08T01:00:00Z", payload: { jobId, resumeVersion, file }, evidence: [] };
}
function versions(base: string): Record<string, unknown>[] {
  return (JSON.parse(readFileSync(path.join(base, "data/resume-versions.json"), "utf-8")) as { versions: Record<string, unknown>[] }).versions;
}
function resumeFiles(base: string): string[] {
  return readdirSync(path.join(base, "data/resume-files")).sort();
}

describe("TAILORED content-addressed reuse", () => {
  it("registers genuinely new content as a new version with a promoted file", () => {
    const base = fixture();
    const r = applyTailored(base, tailored("t-a", "job-a", "v-new-1", "data/inbox/evidence/b.pdf"));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.summary).toBe("TAILORED job-a -> v-new-1");
    expect(versions(base)).toHaveLength(2);
    expect(existsSync(path.join(base, "data/resume-files/t-a.pdf"))).toBe(true);
  });

  it("reuses the existing version when the PDF is byte-identical, writing no record and no file", () => {
    const base = fixture();
    const r = applyTailored(base, tailored("t-b", "job-b", "v-proposed-dup", "data/inbox/evidence/a.pdf"));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.summary).toBe("TAILORED job-b -> v-existing (reused identical content)");
    expect(versions(base)).toHaveLength(1);
    expect(resumeFiles(base)).toEqual(["existing.pdf"]);
    const changelog = JSON.parse(readFileSync(path.join(base, "data/changelog.json"), "utf-8")) as { entries: { note: string }[] };
    expect(changelog.entries.some((e) => e.note.includes("reused identical content"))).toBe(true);
  });

  it("still rejects an existing version name carrying novel content", () => {
    const base = fixture();
    const r = applyTailored(base, tailored("t-c", "job-c", "v-existing", "data/inbox/evidence/c.pdf"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toContain("E_DUPLICATE");
    expect(versions(base)).toHaveLength(1);
    expect(resumeFiles(base)).toEqual(["existing.pdf"]);
  });
});
