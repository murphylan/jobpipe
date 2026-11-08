import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { processInboxOnce } from "./daemon";
import type { ChangeSetInput } from "./expand";
import { applyApplicationSubmitted } from "./apply";
import { shadowCompare } from "./shadow";
import { chicagoToday } from "../ledger";

const temps: string[] = [];
afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

// 夹具日期必须跟真实芝加哥日期走：写死 2026-10-31 的版本在芝加哥进入 11-01 后全挂（影子展开按真实时钟算 today）。
const TODAY = chicagoToday();
const HEADER = "id,date_submitted,company,role,req_url,channel,score,role_family,resume_version,employment_type,submission_status,evidence,stage,last_contact_date,recruiter,next_action,next_action_date,jd_snapshot_path,notes";

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

function fixture(): string {
  const base = mkdtempSync(path.join(tmpdir(), "engine-decisions-"));
  temps.push(base);
  mkdirSync(path.join(base, "data", "inbox", "decisions"), { recursive: true });
  mkdirSync(path.join(base, "data", "mirror"), { recursive: true });
  mkdirSync(path.join(base, "data", "resume-files"), { recursive: true });
  // FR-3: registry-driven expand requires lib/engine/registry.yaml in baseDir.
  mkdirSync(path.join(base, "lib", "engine"), { recursive: true });
  writeFileSync(path.join(base, "lib", "engine", "registry.yaml"), REGISTRY_YAML);
  writeFileSync(path.join(base, "data", "profile.json"), JSON.stringify({ version: 2, updatedAt: "2026-10-31T00:00:00Z", legalFirstName: "Taylor", email: "applicant@example.com" }));
  writeFileSync(path.join(base, "data", "changelog.json"), JSON.stringify({ entries: [], version: 1, updatedAt: "2026-10-31T00:00:00Z" }));
  writeFileSync(path.join(base, "data", "jobs.json"), JSON.stringify({ jobs: [{ id: "test-job", company: "Test Co", role: "Full Stack Developer", channel: "LinkedIn", location: "Remote", remote: "remote", salaryPosted: null, salaryAnswer: null, matchPoints: [], redFlags: [], conclusion: "apply", status: "approved", jdKind: "full", url: "https://example.com/job" }], version: 3, updatedAt: "2026-10-31T00:00:00Z" }));
  writeFileSync(path.join(base, "data", "applications.json"), JSON.stringify({ applications: [], version: 2, updatedAt: "2026-10-31T00:00:00Z" }));
  writeFileSync(path.join(base, "data", "resume-versions.json"), JSON.stringify({ versions: [{ version: "v20261031-base", jobId: "base", file: "data/resume-files/test.pdf", createdAt: "2026-10-31T00:00:00Z", note: "" }], selected: { base: "v20261031-base" }, version: 1, updatedAt: "2026-10-31T00:00:00Z" }));
  writeFileSync(path.join(base, "data", "resume-files", "test.pdf"), "fake pdf content");
  writeFileSync(path.join(base, "data", "mirror", "ledger.csv"), `${HEADER}\n5,${TODAY},Old Co,Old Role,,LinkedIn,,,,,confirmed,evidence,applied,,,,,,\n`);
  writeFileSync(path.join(base, "data", "daily.json"), JSON.stringify({ days: { [TODAY]: { discovery: 0, screening: 0, tailoring: 0, review: 0, apply: 1 } }, version: 1, updatedAt: "2026-10-31T00:00:00Z" }));
  return base;
}

function oldFile(full: string, content: string): void {
  writeFileSync(full, content);
  const past = new Date(Date.now() - 10000);
  utimesSync(full, past, past);
}

describe("engine decisions and shadow (temp dirs only)", () => {
  it("an approved decision applies a held PROFILE_CHANGED", () => {
    const base = fixture();
    oldFile(path.join(base, "data", "inbox", "prof-001.json"), JSON.stringify({ taskId: "prof-001", event: "PROFILE_CHANGED", createdAt: "2026-11-01T10:00:00Z", payload: { legalFirstName: "Alex" } }));
    const first = processInboxOnce(base);
    expect(first.some((r) => r.taskId === "prof-001" && r.outcome === "pending")).toBe(true);
    oldFile(path.join(base, "data", "inbox", "decisions", "prof-001.json"), JSON.stringify({ taskId: "prof-001", approved: true, quote: "yes, change it", decidedAt: "2026-11-01T11:00:00Z" }));
    const second = processInboxOnce(base);
    expect(second.some((r) => r.taskId === "prof-001" && r.outcome === "committed")).toBe(true);
    const profile = JSON.parse(readFileSync(path.join(base, "data", "profile.json"), "utf-8"));
    expect(profile.legalFirstName).toBe("Alex");
    expect(existsSync(path.join(base, "data", "processed", "prof-001.json"))).toBe(true);
    expect(existsSync(path.join(base, "data", "processed", "decision-prof-001.json"))).toBe(true);
    const receipt = JSON.parse(readFileSync(path.join(base, "data", "receipts", "prof-001.json"), "utf-8"));
    expect(receipt.status).toBe("committed");
  });

  it("a denied decision rejects the held event", () => {
    const base = fixture();
    oldFile(path.join(base, "data", "inbox", "prof-002.json"), JSON.stringify({ taskId: "prof-002", event: "PROFILE_CHANGED", createdAt: "2026-11-01T10:00:00Z", payload: { legalFirstName: "Alex" } }));
    processInboxOnce(base);
    oldFile(path.join(base, "data", "inbox", "decisions", "prof-002.json"), JSON.stringify({ taskId: "prof-002", approved: false, quote: "no", decidedAt: "2026-11-01T11:00:00Z" }));
    const second = processInboxOnce(base);
    expect(second.some((r) => r.taskId === "prof-002" && r.outcome === "rejected")).toBe(true);
    expect(existsSync(path.join(base, "data", "rejected", "prof-002.json"))).toBe(true);
    const profile = JSON.parse(readFileSync(path.join(base, "data", "profile.json"), "utf-8"));
    expect(profile.legalFirstName).toBe("Taylor");
  });

  it("shadow comparison is empty when the direct write matches the expansion", () => {
    const base = fixture();
    const snapshot = mkdtempSync(path.join(tmpdir(), "engine-shadow-snap-"));
    temps.push(snapshot);
    cpSync(path.join(base, "data"), path.join(snapshot, "data"), { recursive: true });
    // FR-3: shadow expansion needs registry.yaml in the snapshot too.
    mkdirSync(path.join(snapshot, "lib", "engine"), { recursive: true });
    cpSync(path.join(base, "lib", "engine", "registry.yaml"), path.join(snapshot, "lib", "engine", "registry.yaml"));
    const cs: ChangeSetInput = {
      taskId: "apply-20261031-001", event: "APPLICATION_SUBMITTED", createdAt: "2026-10-31T20:00:00Z",
      payload: { jobId: "test-job", resumeVersion: "v20261031-base" },
      evidence: [{ kind: "employer-confirmation", text: "Greenhouse confirmation email" }, { kind: "user-approval", text: "user approved in chat" }],
    };
    const applied = applyApplicationSubmitted(base, cs, { today: TODAY });
    expect(applied.ok).toBe(true);
    const report = shadowCompare(snapshot, base, cs);
    expect(report.differences).toEqual([]);
  });

  it("shadow comparison flags a direct write that diverges", () => {
    const base = fixture();
    const snapshot = mkdtempSync(path.join(tmpdir(), "engine-shadow-snap-"));
    temps.push(snapshot);
    cpSync(path.join(base, "data"), path.join(snapshot, "data"), { recursive: true });
    const cs: ChangeSetInput = {
      taskId: "apply-20261031-001", event: "APPLICATION_SUBMITTED", createdAt: "2026-10-31T20:00:00Z",
      payload: { jobId: "test-job", resumeVersion: "v20261031-base" },
      evidence: [{ kind: "employer-confirmation", text: "Greenhouse confirmation email" }, { kind: "user-approval", text: "user approved in chat" }],
    };
    const report = shadowCompare(snapshot, base, cs);
    expect(report.differences.length).toBeGreaterThan(0);
  });
});
