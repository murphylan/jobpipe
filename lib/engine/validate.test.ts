import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateDataDir } from "./validate";

const temps: string[] = [];
afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

const HEADER = "id,date_submitted,company,role,req_url,channel,score,role_family,resume_version,employment_type,submission_status,evidence,stage,last_contact_date,recruiter,next_action,next_action_date,jd_snapshot_path,notes";
const TODAY = "2026-10-31";

function job(id = "test-job") {
  return {
    id,
    company: "Test Co",
    role: "Full Stack Developer",
    channel: "LinkedIn",
    location: "Remote",
    remote: "remote",
    salaryPosted: null,
    salaryAnswer: null,
    matchPoints: [],
    redFlags: [],
    conclusion: "apply" as const,
    status: "applied" as const,
  };
}

function app(jobId = "test-job") {
  return {
    id: "2026-10-31-test",
    jobId,
    ledgerRowId: "1",
    resumeVersion: "v20261031-base",
    source: "LinkedIn",
    collectedAt: "2026-10-31T00:00:00Z",
    appliedAt: "2026-10-31T00:00:00Z",
    employerConfirmed: true,
    stage: "applied" as const,
    nextAction: null,
    nextActionDue: null,
    interviewAt: null,
    notes: "",
    version: 1,
    updatedAt: "2026-10-31T00:00:00Z",
  };
}

function ledgerRow(fieldCount: number): string {
  const full = ["1", TODAY, "Test Co", "Full Stack Developer", "", "LinkedIn", "", "", "v20261031-base", "", "confirmed", "evidence", "applied", "", "", "", "", "", "note"];
  return full.slice(0, fieldCount).join(",");
}

function fixture(opts: { jobs?: unknown; apps?: unknown; dailyApply?: number; ledgerFields?: number } = {}): string {
  const base = mkdtempSync(path.join(tmpdir(), "engine-validate-"));
  temps.push(base);
  mkdirSync(path.join(base, "data", "mirror"), { recursive: true });
  const jobs = opts.jobs ?? [job()];
  writeFileSync(path.join(base, "data", "jobs.json"), JSON.stringify({ jobs, version: 1, updatedAt: "2026-10-31T00:00:00Z" }));
  const apps = opts.apps ?? [app()];
  writeFileSync(path.join(base, "data", "applications.json"), JSON.stringify({ applications: apps, version: 1, updatedAt: "2026-10-31T00:00:00Z" }));
  writeFileSync(
    path.join(base, "data", "daily.json"),
    JSON.stringify({ days: { [TODAY]: { discovery: 0, screening: 0, tailoring: 0, review: 0, apply: opts.dailyApply ?? 1 } }, version: 1, updatedAt: "2026-10-31T00:00:00Z" }),
  );
  writeFileSync(path.join(base, "data", "mirror", "ledger.csv"), `${HEADER}\n${ledgerRow(opts.ledgerFields ?? 19)}\n`);
  return base;
}

describe("engine validate (temp dirs only, never real data/)", () => {
  it("valid fixture has no errors", () => {
    const r = validateDataDir(fixture(), TODAY);
    expect(r.errors).toEqual([]);
    expect(r.knownDrift).toEqual([]);
  });

  it("duplicate job ids are errors", () => {
    const r = validateDataDir(fixture({ jobs: [job(), job()] }), TODAY);
    expect(r.errors.some((e) => e.includes("duplicate"))).toBe(true);
  });

  it("orphan applications are errors", () => {
    const r = validateDataDir(fixture({ apps: [app("missing-job")] }), TODAY);
    expect(r.errors.some((e) => e.includes("orphan"))).toBe(true);
  });

  it("daily apply mismatch with ledger is an error", () => {
    const r = validateDataDir(fixture({ dailyApply: 2 }), TODAY);
    expect(r.errors.some((e) => e.includes("daily.json"))).toBe(true);
  });

  it("18-field ledger row is known drift, not an error", () => {
    const r = validateDataDir(fixture({ ledgerFields: 18 }), TODAY);
    expect(r.errors).toEqual([]);
    expect(r.knownDrift.length).toBe(1);
  });

  it("17-field ledger row is an error", () => {
    const r = validateDataDir(fixture({ ledgerFields: 17 }), TODAY);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});
