import { existsSync, utimesSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyApplicationImported } from "./events7";
import { processInboxOnce } from "./daemon";
import { writeDecision } from "./console";
import { writeState } from "./state";
import { detectExternalModifications } from "./external";
import { gitFilesForEvent } from "./git";
import * as storage from "./storage";
import type { GenericChangeSet } from "./events";

const temps: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

const HEADER = "id,date_submitted,company,role,req_url,channel,score,role_family,resume_version,employment_type,submission_status,evidence,stage,last_contact_date,recruiter,next_action,next_action_date,jd_snapshot_path,notes";
const REGISTRY_YAML = `version: 2
events:
  - name: "APPLICATION_IMPORTED"
    description: "test"
    requiresApproval: true
    writes:
      - "data/applications.json"
      - "data/changelog.json"
    handler: "applyApplicationImported"
`;

function ledgerRow(fields: Record<number, string>): string {
  const cells = new Array<string>(19).fill("");
  for (const [idx, value] of Object.entries(fields)) cells[Number(idx)] = value;
  return cells.join(",");
}

function job(id: string, status: string): Record<string, unknown> {
  return {
    id, company: "Example Inc.", role: "Senior Engineer", channel: "Ashby", location: "Remote",
    remote: "remote", salaryPosted: null, salaryAnswer: null, matchPoints: [], redFlags: [],
    conclusion: "apply", status, jdKind: "full", url: "https://example.com/job",
  };
}

function fixture(): string {
  const base = mkdtempSync(path.join(tmpdir(), "engine-events7-"));
  temps.push(base);
  mkdirSync(path.join(base, "data", "inbox"), { recursive: true });
  mkdirSync(path.join(base, "data", "mirror"), { recursive: true });
  mkdirSync(path.join(base, "data", "resume-files"), { recursive: true });
  mkdirSync(path.join(base, "lib", "engine"), { recursive: true });
  writeFileSync(path.join(base, "lib", "engine", "registry.yaml"), REGISTRY_YAML);
  const w = (rel: string, v: unknown) => writeFileSync(path.join(base, "data", rel), JSON.stringify(v));
  w("changelog.json", { entries: [], version: 1, updatedAt: "2026-11-08T00:00:00Z" });
  w("jobs.json", { jobs: [job("job-hist", "applied"), job("job-fresh", "approved")], version: 1, updatedAt: "2026-11-08T00:00:00Z" });
  w("applications.json", { applications: [], version: 1, updatedAt: "2026-11-08T00:00:00Z" });
  w("resume-versions.json", { versions: [{ version: "v1-hist", jobId: "job-hist", file: "data/resume-files/v1.pdf", createdAt: "2026-10-30T00:00:00Z", note: "" }], selected: {}, version: 1, updatedAt: "2026-11-08T00:00:00Z" });
  writeFileSync(path.join(base, "data", "resume-files", "v1.pdf"), "fake pdf content");
  w("profile.json", { version: 3, updatedAt: "2026-11-08T00:00:00Z", email: "a@example.com", workAuth: "Authorized (fixture)" });
  w("knowledge.json", { version: 12, updatedAt: "2026-11-08T00:00:00Z", entries: [], rereads: [] });
  w("quirks.json", { quirks: [], version: 1, updatedAt: "2026-11-08T00:00:00Z" });
  w("daily.json", { days: {}, version: 1, updatedAt: "2026-11-08T00:00:00Z" });
  const rows = [
    // Row 3: the good historical row for job-hist.
    ledgerRow({ 0: "3", 1: "2026-10-30", 2: "Example Inc.", 3: "Senior Engineer", 5: "Ashby", 8: "v1-hist", 10: "confirmed", 11: "Ashby confirmation page", 12: "applied" }),
    // Row 4: same job identity but never confirmed.
    ledgerRow({ 0: "4", 1: "2026-10-30", 2: "Example Inc.", 3: "Senior Engineer", 5: "Ashby", 8: "v1-hist", 10: "submitted", 11: "Ashby confirmation page", 12: "applied" }),
    // Row 5: confirmed, but a different company than the job.
    ledgerRow({ 0: "5", 1: "2026-10-30", 2: "Other Co", 3: "Senior Engineer", 5: "Ashby", 8: "v1-hist", 10: "confirmed", 11: "Ashby confirmation page", 12: "applied" }),
  ];
  writeFileSync(path.join(base, "data", "mirror", "ledger.csv"), `${HEADER}\n${rows.join("\n")}\n`);
  return base;
}

const EVIDENCE = [
  { kind: "employer-confirmation", text: "Ashby confirmation page (ledger row 3)" },
  { kind: "user-approval", text: "User authorized the historical import on 2026-11-09" },
];

function importCs(taskId: string, overrides: Record<string, unknown> = {}, evidence: { kind: string; text: string }[] = EVIDENCE): GenericChangeSet {
  return {
    taskId, event: "APPLICATION_IMPORTED", createdAt: "2026-11-09T05:00:00Z",
    payload: { jobId: "job-hist", ledgerRowId: "3", resumeVersion: "v1-hist", ...overrides },
    evidence,
  };
}

function readJson(base: string, rel: string): any {
  return JSON.parse(readFileSync(path.join(base, "data", rel), "utf-8"));
}

describe("APPLICATION_IMPORTED historical import", () => {
  it("creates the application record from the confirmed ledger row", () => {
    const base = fixture();
    const r = applyApplicationImported(base, importCs("import-1"));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.summary).toContain("ledger 3");
    const apps = readJson(base, "applications.json").applications;
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({
      id: "2026-10-30-job-hist",
      jobId: "job-hist",
      ledgerRowId: "3",
      resumeVersion: "v1-hist",
      source: "Ashby",
      appliedAt: "2026-10-30",
      collectedAt: "2026-11-09T05:00:00Z",
      employerConfirmed: true,
      stage: "applied",
      nextAction: null,
      nextActionDue: null,
      version: 1,
    });
    const changelog = readJson(base, "changelog.json");
    expect(changelog.entries.at(-1).action).toBe("application-imported");
    // The job itself is untouched: still applied, no status flip.
    const jobs = readJson(base, "jobs.json").jobs;
    expect(jobs.find((j: any) => j.id === "job-hist").status).toBe("applied");
  });

  it("rejects a second import of the same ledger row or job", () => {
    const base = fixture();
    expect(applyApplicationImported(base, importCs("import-1")).ok).toBe(true);
    const again = applyApplicationImported(base, importCs("import-2"));
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.errors.join(" ")).toContain("E_DUPLICATE");
    expect(readJson(base, "applications.json").applications).toHaveLength(1);
  });

  it("rejects jobs that are not already applied", () => {
    const base = fixture();
    const r = applyApplicationImported(base, importCs("import-1", { jobId: "job-fresh" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toContain("E_GUARD:not-applied");
  });

  it("rejects a missing ledger row", () => {
    const base = fixture();
    const r = applyApplicationImported(base, importCs("import-1", { ledgerRowId: "99" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toContain("E_GUARD:ledger-row-not-found");
  });

  it("rejects an unconfirmed ledger row", () => {
    const base = fixture();
    const r = applyApplicationImported(base, importCs("import-1", { ledgerRowId: "4" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toContain("E_GUARD:ledger-not-confirmed");
  });

  it("rejects a ledger row whose company does not match the job", () => {
    const base = fixture();
    const r = applyApplicationImported(base, importCs("import-1", { ledgerRowId: "5" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toContain("E_GUARD:ledger-job-mismatch");
  });

  it("rejects a resume version that differs from the ledger row", () => {
    const base = fixture();
    const r = applyApplicationImported(base, importCs("import-1", { resumeVersion: "v9-other" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toContain("E_GUARD:resume-version-mismatch");
  });

  it("requires employer-confirmation and user-approval evidence", () => {
    const base = fixture();
    const noApproval = applyApplicationImported(base, importCs("import-1", {}, [EVIDENCE[0]]));
    expect(noApproval.ok).toBe(false);
    if (!noApproval.ok) expect(noApproval.errors.join(" ")).toContain("E_EVIDENCE_MISSING");
    const noEmployer = applyApplicationImported(base, importCs("import-2", {}, [EVIDENCE[1]]));
    expect(noEmployer.ok).toBe(false);
    if (!noEmployer.ok) expect(noEmployer.errors.join(" ")).toContain("E_EVIDENCE_MISSING");
    expect(readJson(base, "applications.json").applications).toHaveLength(0);
  });
});

function queueImport(base: string, taskId: string) {
  const cs = importCs(taskId); cs.createdAt = new Date(Date.now() - 5000).toISOString();
  const file = path.join(base, "data/inbox", `${taskId}.json`);
  writeFileSync(file, JSON.stringify(cs)); utimesSync(file, new Date(0), new Date(0));
}
function decideImport(base: string, taskId: string, approved: boolean) {
  expect(writeDecision(base, { taskId, approved, quote: approved ? "Approve this exact historical import" : "Decline" }).ok).toBe(true);
  const file = path.join(base, "data/inbox/decisions", `${taskId}.json`);
  utimesSync(file, new Date(0), new Date(0));
}

it("holds an import pending until user approval and processes retries exactly once", () => {
  const base = fixture(); queueImport(base, "approval-import");
  expect(processInboxOnce(base)[0].outcome).toBe("pending");
  expect(readJson(base, "applications.json").applications).toHaveLength(0);
  expect(readJson(base, "receipts/approval-import.json").status).toBe("pending-approval");
  decideImport(base, "approval-import", true);
  expect(processInboxOnce(base).some(result => result.outcome === "committed")).toBe(true);
  expect(readJson(base, "receipts/approval-import.json").status).toBe("committed");
  expect(readJson(base, "applications.json").applications).toHaveLength(1);
  expect(processInboxOnce(base)).toEqual([]);
  expect(readJson(base, "applications.json").applications).toHaveLength(1);
});
it("denied imports leave business records unchanged", () => {
  const base = fixture(); const before = readFileSync(path.join(base, "data/applications.json"), "utf8");
  queueImport(base, "denied-import"); processInboxOnce(base);
  decideImport(base, "denied-import", false); processInboxOnce(base);
  expect(readJson(base, "receipts/denied-import.json").status).toBe("rejected");
  expect(readFileSync(path.join(base, "data/applications.json"), "utf8")).toBe(before);
});
it("does not acknowledge unrelated external edits when committing an approved import", () => {
  const base = fixture(); writeState(base, null);
  const jobs = readJson(base, "jobs.json"); jobs.jobs[0].location = "External edit";
  writeFileSync(path.join(base, "data/jobs.json"), JSON.stringify(jobs));
  queueImport(base, "scoped-import"); processInboxOnce(base); decideImport(base, "scoped-import", true); processInboxOnce(base);
  expect(readJson(base, "receipts/scoped-import.json").status).toBe("committed");
  expect(detectExternalModifications(base).mismatches.join(" ")).toContain("jobs.json");
  const files = gitFilesForEvent("APPLICATION_IMPORTED", "scoped-import");
  expect(files).toContain("applications.json");
  for (const file of ["jobs.json", "mirror/ledger.csv", "attempts.json"]) expect(files).not.toContain(file);
});
it("recovers after a committed receipt without importing a second application", () => {
  const base = fixture(); queueImport(base, "recover-import"); processInboxOnce(base); decideImport(base, "recover-import", true);
  const original = storage.atomicWriteFileSync;
  const spy = vi.spyOn(storage, "atomicWriteFileSync").mockImplementation((file, content, encoding) => {
    if (file === path.join(base, "data/engine/state.json")) throw new Error("fixture crash after receipt");
    return original(file, content, encoding);
  });
  expect(() => processInboxOnce(base)).toThrow("fixture crash after receipt");
  expect(readJson(base, "receipts/recover-import.json").status).toBe("committed");
  spy.mockRestore(); processInboxOnce(base);
  expect(readJson(base, "applications.json").applications).toHaveLength(1);
  expect(existsSync(path.join(base, "data/.journal/recover-import.json"))).toBe(false);
});
