import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { expandApplicationSubmitted, type ChangeSetInput } from "./expand";

const temps: string[] = [];
afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

const TODAY = "2026-10-31";
const HEADER = "id,date_submitted,company,role,req_url,channel,score,role_family,resume_version,employment_type,submission_status,evidence,stage,last_contact_date,recruiter,next_action,next_action_date,jd_snapshot_path,notes";

function changeset(overrides: Partial<ChangeSetInput> = {}): ChangeSetInput {
  return {
    taskId: "apply-20261031-001",
    event: "APPLICATION_SUBMITTED",
    createdAt: "2026-10-31T20:00:00Z",
    payload: { jobId: "test-job", resumeVersion: "v20261031-base" },
    evidence: [
      { kind: "employer-confirmation", text: "Greenhouse confirmation email" },
      { kind: "user-approval", text: "user approved in chat" },
    ],
    ...overrides,
  };
}

const REGISTRY_YAML = `version: 2
events:
  - name: "APPLICATION_SUBMITTED"
    description: "test"
    requiresApproval: true
    writes:
      - "data/jobs.json"
      - "data/applications.json"
      - "data/mirror/ledger.csv"
      - "data/changelog.json"
      - "data/daily.json"
    handler: "expandApplicationSubmitted"
`;

function fixture(opts: { job?: Record<string, unknown>; resumeFile?: boolean; evidence?: ChangeSetInput["evidence"] } = {}): string {
  const base = mkdtempSync(path.join(tmpdir(), "engine-expand-"));
  temps.push(base);
  mkdirSync(path.join(base, "data", "mirror"), { recursive: true });
  mkdirSync(path.join(base, "data", "resume-files"), { recursive: true });
  // FR-3: registry-driven expand requires lib/engine/registry.yaml in baseDir.
  mkdirSync(path.join(base, "lib", "engine"), { recursive: true });
  writeFileSync(path.join(base, "lib", "engine", "registry.yaml"), REGISTRY_YAML);
  const job = {
    id: "test-job",
    company: "Test Co",
    role: "Full Stack Developer",
    channel: "LinkedIn",
    location: "Remote",
    remote: "remote",
    salaryPosted: null,
    salaryAnswer: null,
    matchPoints: [],
    redFlags: [],
    conclusion: "apply",
    status: "approved",
    jdKind: "full",
    url: "https://example.com/job",
    ...(opts.job ?? {}),
  };
  writeFileSync(path.join(base, "data", "jobs.json"), JSON.stringify({ jobs: [job], version: 3, updatedAt: "2026-10-31T00:00:00Z" }));
  writeFileSync(path.join(base, "data", "applications.json"), JSON.stringify({ applications: [], version: 2, updatedAt: "2026-10-31T00:00:00Z" }));
  writeFileSync(
    path.join(base, "data", "resume-versions.json"),
    JSON.stringify({
      versions: [{ version: "v20261031-base", jobId: "base", file: "data/resume-files/test.pdf", createdAt: "2026-10-31T00:00:00Z", note: "" }],
      selected: { base: "v20261031-base" },
      version: 1,
      updatedAt: "2026-10-31T00:00:00Z",
    }),
  );
  if (opts.resumeFile !== false) writeFileSync(path.join(base, "data", "resume-files", "test.pdf"), "fake pdf content");
  writeFileSync(
    path.join(base, "data", "mirror", "ledger.csv"),
    `${HEADER}\n5,${TODAY},Old Co,Old Role,,LinkedIn,,,,,confirmed,evidence,applied,,,,,,\n`,
  );
  writeFileSync(
    path.join(base, "data", "daily.json"),
    JSON.stringify({ days: { [TODAY]: { discovery: 0, screening: 0, tailoring: 0, review: 0, apply: 1 } }, version: 1, updatedAt: "2026-10-31T00:00:00Z" }),
  );
  return base;
}

describe("engine expand dry-run (temp dirs only)", () => {
  it("expands an approved, full-JD application", () => {
    const r = expandApplicationSubmitted(fixture(), changeset(), { today: TODAY });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.expansion.job.status).toBe("applied");
    expect(r.expansion.jobsFileVersion).toBe(4);
    expect(r.expansion.application.id).toBe(`${TODAY}-test-job`);
    expect(r.expansion.application.ledgerRowId).toBe("6");
    expect(r.expansion.application.employerConfirmed).toBe(true);
    expect(r.expansion.ledgerRow[0]).toBe("6");
    expect(r.expansion.ledgerRow.length).toBe(19);
    expect(r.expansion.ledgerRow[10]).toBe("confirmed");
    expect(r.expansion.dailyApplyPreview).toBe(2);
    expect(r.expansion.resumePdfSha256.length).toBe(64);
  });

  it("refuses a job that is not approved", () => {
    const r = expandApplicationSubmitted(fixture({ job: { status: "screening" } }), changeset(), { today: TODAY });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.includes("not-approved"))).toBe(true);
  });

  it("refuses when jdKind is missing", () => {
    const base = fixture();
    const jobsPath = path.join(base, "data", "jobs.json");
    const jobs = JSON.parse(readFileSync(jobsPath, "utf-8")) as { jobs: Record<string, unknown>[] };
    delete jobs.jobs[0].jdKind;
    writeFileSync(jobsPath, JSON.stringify(jobs));
    const r = expandApplicationSubmitted(base, changeset(), { today: TODAY });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.includes("jd-not-full"))).toBe(true);
  });

  it("refuses when the resume PDF is missing", () => {
    const r = expandApplicationSubmitted(fixture({ resumeFile: false }), changeset(), { today: TODAY });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.includes("resume-file-missing"))).toBe(true);
  });

  it("refuses when employer evidence is missing", () => {
    const r = expandApplicationSubmitted(fixture(), changeset({ evidence: [{ kind: "user-approval", text: "ok" }] }), { today: TODAY });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.includes("E_EVIDENCE_MISSING"))).toBe(true);
  });
});
