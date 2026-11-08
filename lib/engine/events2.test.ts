import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { processInboxOnce } from "./daemon";
import type { GenericChangeSet } from "./events";
import { applyScreened, applyTailored, applyUserDecided } from "./events2";

const temps: string[] = [];
afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

const TODAY = "2026-10-31";

function job(id: string, status: string): Record<string, unknown> {
  return {
    id, company: "Test Co", role: "Full Stack Developer", channel: "LinkedIn",
    location: "Remote", remote: "remote", salaryPosted: null, salaryAnswer: null,
    matchPoints: [], redFlags: [], conclusion: "pending", status, url: "https://example.com/job",
  };
}

function fixture(): string {
  const base = mkdtempSync(path.join(tmpdir(), "engine-events2-"));
  temps.push(base);
  mkdirSync(path.join(base, "data", "resume-files"), { recursive: true });
  mkdirSync(path.join(base, "data", "inbox"), { recursive: true });
  writeFileSync(path.join(base, "data", "jobs.json"), JSON.stringify({ jobs: [job("new-job", "new"), job("approved-job", "approved")], version: 3, updatedAt: "2026-10-31T00:00:00Z" }));
  writeFileSync(path.join(base, "data", "applications.json"), JSON.stringify({ applications: [], version: 2, updatedAt: "2026-10-31T00:00:00Z" }));
  writeFileSync(path.join(base, "data", "resume-versions.json"), JSON.stringify({
    versions: [{ version: "v20261031-base", jobId: "base", file: "data/resume-files/base.pdf", createdAt: "2026-10-31T00:00:00Z", note: "" }],
    selected: { base: "v20261031-base" }, version: 1, updatedAt: "2026-10-31T00:00:00Z",
  }));
  mkdirSync(path.join(base, "data/inbox/evidence"), { recursive: true });
  writeFileSync(path.join(base, "data/inbox/evidence/tailored.pdf"), "%PDF-1.4 fixture");
  writeFileSync(path.join(base, "data", "daily.json"), JSON.stringify({ days: { [TODAY]: { discovery: 0, screening: 0, tailoring: 0, review: 0, apply: 0 } }, version: 1, updatedAt: "2026-10-31T00:00:00Z" }));
  writeFileSync(path.join(base, "data", "changelog.json"), JSON.stringify({ entries: [], version: 1, updatedAt: "2026-10-31T00:00:00Z" }));
  return base;
}

describe("engine stage 3 events, second batch (temp dirs only)", () => {
  it("SCREENED apply moves a new job to approved without changing historical daily counts", () => {
    const base = fixture();
    const cs: GenericChangeSet = { taskId: "scr-001", event: "SCREENED", createdAt: "2026-10-31T10:00:00Z", payload: { jobId: "new-job", conclusion: "apply", matchPoints: ["full-stack match"] } };
    expect(applyScreened(base, cs).ok).toBe(true);
    const jobs = JSON.parse(readFileSync(path.join(base, "data", "jobs.json"), "utf-8"));
    expect(jobs.jobs[0].status).toBe("approved");
    expect(jobs.jobs[0].conclusion).toBe("apply");
    const daily = JSON.parse(readFileSync(path.join(base, "data", "daily.json"), "utf-8"));
    expect(daily.days[TODAY].screening).toBe(0);
  });

  it("SCREENED on an approved job is rejected and writes nothing", () => {
    const base = fixture();
    const cs: GenericChangeSet = { taskId: "scr-002", event: "SCREENED", createdAt: "2026-10-31T10:00:00Z", payload: { jobId: "approved-job", conclusion: "drop" } };
    expect(applyScreened(base, cs).ok).toBe(false);
    const jobs = JSON.parse(readFileSync(path.join(base, "data", "jobs.json"), "utf-8"));
    expect(jobs.jobs[1].status).toBe("approved");
  });

  it("TAILORED registers the version without changing historical daily counts; duplicate is rejected", () => {
    const base = fixture();
    const cs: GenericChangeSet = { taskId: "tai-001", event: "TAILORED", createdAt: "2026-10-31T10:00:00Z", payload: { jobId: "approved-job", resumeVersion: "v20261031-approved-job", file: "data/inbox/evidence/tailored.pdf" } };
    expect(applyTailored(base, cs).ok).toBe(true);
    const rv = JSON.parse(readFileSync(path.join(base, "data", "resume-versions.json"), "utf-8"));
    expect(rv.versions).toHaveLength(2);
    expect(rv.versions[1].file).toBe("data/resume-files/tai-001.pdf");
    expect(readFileSync(path.join(base, rv.versions[1].file), "utf-8")).toBe("%PDF-1.4 fixture");
    expect(applyTailored(base, cs).ok).toBe(false);
    const daily = JSON.parse(readFileSync(path.join(base, "data", "daily.json"), "utf-8"));
    expect(daily.days[TODAY].tailoring).toBe(0);
  });

  it("USER_DECIDED drop needs a user-approval entry without changing historical daily counts", () => {
    const base = fixture();
    const noEvidence: GenericChangeSet = { taskId: "dec-001", event: "USER_DECIDED", createdAt: "2026-10-31T10:00:00Z", payload: { jobId: "approved-job", decision: "drop" } };
    expect(applyUserDecided(base, noEvidence).ok).toBe(false);
    const cs: GenericChangeSet = { ...noEvidence, taskId: "dec-002", evidence: [{ kind: "user-approval", text: "user said drop it" }] };
    expect(applyUserDecided(base, cs).ok).toBe(true);
    const jobs = JSON.parse(readFileSync(path.join(base, "data", "jobs.json"), "utf-8"));
    expect(jobs.jobs[1].status).toBe("dropped");
    const daily = JSON.parse(readFileSync(path.join(base, "data", "daily.json"), "utf-8"));
    expect(daily.days[TODAY].review).toBe(0);
  });

  it("daemon commits a SCREENED inbox file end to end", () => {
    const base = fixture();
    const inboxFile = path.join(base, "data", "inbox", "scr-001.json");
    writeFileSync(inboxFile, JSON.stringify({ taskId: "scr-001", event: "SCREENED", createdAt: "2026-10-31T10:00:00Z", payload: { jobId: "new-job", conclusion: "apply" } }));
    const past = new Date(Date.now() - 10000);
    utimesSync(inboxFile, past, past);
    const results = processInboxOnce(base);
    expect(results[0].outcome).toBe("committed");
    expect(existsSync(path.join(base, "data", "receipts", "scr-001.json"))).toBe(true);
    expect(existsSync(path.join(base, "data", "processed", "scr-001.json"))).toBe(true);
  });
});
