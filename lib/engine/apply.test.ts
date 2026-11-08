import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyApplicationSubmitted } from "./apply";
import { processInboxOnce } from "./daemon";
import type { ChangeSetInput } from "./expand";
import { chicagoToday } from "../ledger";

const temps: string[] = [];
afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

// 夹具日期必须跟真实芝加哥日期走：写死 2026-10-31 的版本在芝加哥进入 11-01 后全挂（daemon 与影子对账按真实时钟算 today）。
const TODAY = chicagoToday();
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

function fixture(jobStatus = "approved"): string {
  const base = mkdtempSync(path.join(tmpdir(), "engine-apply-"));
  temps.push(base);
  mkdirSync(path.join(base, "data", "mirror"), { recursive: true });
  mkdirSync(path.join(base, "data", "resume-files"), { recursive: true });
  mkdirSync(path.join(base, "data", "inbox"), { recursive: true });
  // FR-3: registry-driven expand requires lib/engine/registry.yaml in baseDir.
  mkdirSync(path.join(base, "lib", "engine"), { recursive: true });
  writeFileSync(path.join(base, "lib", "engine", "registry.yaml"), REGISTRY_YAML);
  const job = {
    id: "test-job", company: "Test Co", role: "Full Stack Developer", channel: "LinkedIn",
    location: "Remote", remote: "remote", salaryPosted: null, salaryAnswer: null,
    matchPoints: [], redFlags: [], conclusion: "apply", status: jobStatus, jdKind: "full", url: "https://example.com/job",
  };
  writeFileSync(path.join(base, "data", "jobs.json"), JSON.stringify({ jobs: [job], version: 3, updatedAt: "2026-10-31T00:00:00Z" }));
  writeFileSync(path.join(base, "data", "applications.json"), JSON.stringify({ applications: [], version: 2, updatedAt: "2026-10-31T00:00:00Z" }));
  writeFileSync(path.join(base, "data", "resume-versions.json"), JSON.stringify({
    versions: [{ version: "v20261031-base", jobId: "base", file: "data/resume-files/test.pdf", createdAt: "2026-10-31T00:00:00Z", note: "" }],
    selected: { base: "v20261031-base" }, version: 1, updatedAt: "2026-10-31T00:00:00Z",
  }));
  writeFileSync(path.join(base, "data", "resume-files", "test.pdf"), "fake pdf content");
  writeFileSync(path.join(base, "data", "mirror", "ledger.csv"), `${HEADER}\n5,${TODAY},Old Co,Old Role,,LinkedIn,,,,,confirmed,evidence,applied,,,,,,\n`);
  writeFileSync(path.join(base, "data", "daily.json"), JSON.stringify({ days: { [TODAY]: { discovery: 0, screening: 0, tailoring: 0, review: 0, apply: 1 } }, version: 1, updatedAt: "2026-10-31T00:00:00Z" }));
  writeFileSync(path.join(base, "data", "changelog.json"), JSON.stringify({ entries: [], version: 1, updatedAt: "2026-10-31T00:00:00Z" }));
  return base;
}

describe("engine apply (temp dirs only)", () => {
  it("writes job, application, ledger row, changelog, and daily", () => {
    const base = fixture();
    const r = applyApplicationSubmitted(base, changeset(), { today: TODAY });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const jobs = JSON.parse(readFileSync(path.join(base, "data", "jobs.json"), "utf-8"));
    expect(jobs.jobs[0].status).toBe("applied");
    expect(jobs.version).toBe(4);
    const apps = JSON.parse(readFileSync(path.join(base, "data", "applications.json"), "utf-8"));
    expect(apps.applications).toHaveLength(1);
    expect(apps.applications[0].id).toBe(`${TODAY}-test-job`);
    const ledger = readFileSync(path.join(base, "data", "mirror", "ledger.csv"), "utf-8").trim().split("\n");
    expect(ledger).toHaveLength(3);
    expect(ledger[2].split(",")[0]).toBe("6");
    const daily = JSON.parse(readFileSync(path.join(base, "data", "daily.json"), "utf-8"));
    expect(daily.days[TODAY].apply).toBe(2);
    const changelog = JSON.parse(readFileSync(path.join(base, "data", "changelog.json"), "utf-8"));
    expect(changelog.entries).toHaveLength(1);
    expect(existsSync(path.join(base, "data", ".journal", "apply-20261031-001.json"))).toBe(false);
  });

  it("guard failure writes nothing", () => {
    const base = fixture("screening");
    const r = applyApplicationSubmitted(base, changeset(), { today: TODAY });
    expect(r.ok).toBe(false);
    const jobs = JSON.parse(readFileSync(path.join(base, "data", "jobs.json"), "utf-8"));
    expect(jobs.jobs[0].status).toBe("screening");
    const apps = JSON.parse(readFileSync(path.join(base, "data", "applications.json"), "utf-8"));
    expect(apps.applications).toHaveLength(0);
  });

  it("daemon commits an APPLICATION_SUBMITTED inbox file end to end", () => {
    const base = fixture();
    const inboxFile = path.join(base, "data", "inbox", "apply-20261031-001.json");
    writeFileSync(inboxFile, JSON.stringify(changeset()));
    const past = new Date(Date.now() - 10000);
    utimesSync(inboxFile, past, past);
    const results = processInboxOnce(base);
    expect(results[0].outcome).toBe("committed");
    expect(existsSync(path.join(base, "data", "receipts", "apply-20261031-001.json"))).toBe(true);
    expect(existsSync(path.join(base, "data", "processed", "apply-20261031-001.json"))).toBe(true);
    const daily = JSON.parse(readFileSync(path.join(base, "data", "daily.json"), "utf-8"));
    expect(daily.days[TODAY].apply).toBe(2);
  });
});
