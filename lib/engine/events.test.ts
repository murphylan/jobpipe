import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { processInboxOnce } from "./daemon";
import { applyDiscovered, applyFollowupReceived, type GenericChangeSet } from "./events";

const temps: string[] = [];
afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

const TODAY = "2026-10-31";
const HEADER = "id,date_submitted,company,role,req_url,channel,score,role_family,resume_version,employment_type,submission_status,evidence,stage,last_contact_date,recruiter,next_action,next_action_date,jd_snapshot_path,notes";

function fixture(): string {
  const base = mkdtempSync(path.join(tmpdir(), "engine-events-"));
  temps.push(base);
  mkdirSync(path.join(base, "data", "mirror"), { recursive: true });
  mkdirSync(path.join(base, "data", "inbox"), { recursive: true });
  const job = {
    id: "test-job", company: "Test Co", role: "Full Stack Developer", channel: "LinkedIn",
    location: "Remote", remote: "remote", salaryPosted: null, salaryAnswer: null,
    matchPoints: [], redFlags: [], conclusion: "apply", status: "applied", jdKind: "full", url: "https://example.com/job",
  };
  writeFileSync(path.join(base, "data", "jobs.json"), JSON.stringify({ jobs: [job], version: 3, updatedAt: "2026-10-31T00:00:00Z" }));
  writeFileSync(path.join(base, "data", "applications.json"), JSON.stringify({
    applications: [{ id: `${TODAY}-test-job`, jobId: "test-job", ledgerRowId: "6", resumeVersion: "v20261031-base", source: "LinkedIn", collectedAt: "2026-10-31T20:00:00Z", appliedAt: "2026-10-31T20:00:00Z", employerConfirmed: true, stage: "applied", nextAction: "等回复 · 7 天后跟进", nextActionDue: "2026-11-07", interviewAt: null, notes: "", version: 1, updatedAt: "2026-10-31T20:00:00Z" }],
    version: 2, updatedAt: "2026-10-31T00:00:00Z",
  }));
  writeFileSync(path.join(base, "data", "mirror", "ledger.csv"), `${HEADER}\n6,${TODAY},Test Co,Full Stack Developer,https://example.com/job,LinkedIn,,LinkedIn,v20261031-base,,confirmed,Greenhouse confirmation email,applied,${TODAY},,等回复 · 7 天后跟进,2026-11-07,,\n`);
  writeFileSync(path.join(base, "data", "daily.json"), JSON.stringify({ days: { [TODAY]: { discovery: 0, screening: 0, tailoring: 0, review: 0, apply: 1 } }, version: 1, updatedAt: "2026-10-31T00:00:00Z" }));
  writeFileSync(path.join(base, "data", "changelog.json"), JSON.stringify({ entries: [], version: 1, updatedAt: "2026-10-31T00:00:00Z" }));
  return base;
}

describe("engine stage 3 events (temp dirs only)", () => {
  it("FOLLOWUP_RECEIVED updates the ledger row and the application, nothing else", () => {
    const base = fixture();
    const cs: GenericChangeSet = {
      taskId: "follow-001", event: "FOLLOWUP_RECEIVED", createdAt: "2026-11-01T10:00:00Z",
      payload: { ledgerRowId: "6", stage: "interview", lastContactDate: "2026-11-01", nextAction: "准备面试", nextActionDate: "2026-11-05" },
      evidence: [{ kind: "employer-message", text: "Recruiter invited to interview" }],
    };
    const r = applyFollowupReceived(base, cs);
    expect(r.ok).toBe(true);
    const ledger = readFileSync(path.join(base, "data", "mirror", "ledger.csv"), "utf-8").trim().split("\n");
    const row = ledger[1].split(",");
    expect(row[12]).toBe("interview");
    expect(row[13]).toBe("2026-11-01");
    expect(row[15]).toBe("准备面试");
    const apps = JSON.parse(readFileSync(path.join(base, "data", "applications.json"), "utf-8"));
    expect(apps.applications[0].stage).toBe("interview");
    expect(apps.applications[0].nextActionDue).toBe("2026-11-05");
  });

  it("FOLLOWUP_RECEIVED on a missing ledger row writes nothing", () => {
    const base = fixture();
    const cs: GenericChangeSet = {
      taskId: "follow-002", event: "FOLLOWUP_RECEIVED", createdAt: "2026-11-01T10:00:00Z",
      payload: { ledgerRowId: "99", stage: "interview" },
      evidence: [{ kind: "employer-message", text: "x" }],
    };
    const r = applyFollowupReceived(base, cs);
    expect(r.ok).toBe(false);
    const apps = JSON.parse(readFileSync(path.join(base, "data", "applications.json"), "utf-8"));
    expect(apps.applications[0].stage).toBe("applied");
  });

  it("DISCOVERED appends a new job without rewriting historical daily counts", () => {
    const base = fixture();
    const cs: GenericChangeSet = {
      taskId: "disc-001", event: "DISCOVERED", createdAt: "2026-11-01T10:00:00Z",
      payload: { job: { id: "new-job", company: "New Co", role: "Full Stack Developer", channel: "LinkedIn", url: "https://example.com/new", location: "Remote", remote: "remote", salaryPosted: null, salaryAnswer: null, matchPoints: [], redFlags: [], conclusion: "pending" } },
    };
    const r = applyDiscovered(base, cs);
    expect(r.ok).toBe(true);
    const jobs = JSON.parse(readFileSync(path.join(base, "data", "jobs.json"), "utf-8"));
    expect(jobs.jobs).toHaveLength(2);
    expect(jobs.jobs[1].status).toBe("new");
    const daily = JSON.parse(readFileSync(path.join(base, "data", "daily.json"), "utf-8"));
    expect(daily.days["2026-11-01"]).toBeUndefined();
    expect(applyDiscovered(base, cs).ok).toBe(false);
  });

  it("daemon commits a DISCOVERED inbox file end to end", () => {
    const base = fixture();
    const inboxFile = path.join(base, "data", "inbox", "disc-001.json");
    writeFileSync(inboxFile, JSON.stringify({
      taskId: "disc-001", event: "DISCOVERED", createdAt: "2026-11-01T10:00:00Z",
      payload: { job: { id: "new-job", company: "New Co", role: "Full Stack Developer", channel: "LinkedIn", url: "https://example.com/new", location: "Remote", remote: "remote", salaryPosted: null, salaryAnswer: null, matchPoints: [], redFlags: [], conclusion: "pending" } },
    }));
    const past = new Date(Date.now() - 10000);
    utimesSync(inboxFile, past, past);
    const results = processInboxOnce(base);
    expect(results[0].outcome).toBe("committed");
    expect(existsSync(path.join(base, "data", "receipts", "disc-001.json"))).toBe(true);
    expect(existsSync(path.join(base, "data", "processed", "disc-001.json"))).toBe(true);
  });
});
