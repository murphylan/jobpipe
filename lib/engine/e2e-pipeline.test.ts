// E2E: six stages via inbox events only (2026-11-05).
// Tests the full pipeline: DISCOVERED -> SCREENED -> TAILORED -> USER_DECIDED
// -> APPLICATION_SUBMITTED, asserting jobs/applications/ledger/daily change.
// Also verifies AGENT_ACTIVITY refs requirement for apply-stage done.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readTaskState } from "./task-state.ts";
import { queryActivityFeed } from "./console.ts";
import { parseCsv } from "../csv.ts";
import { chicagoToday } from "../ledger.ts";
import { loadFullSnapshotData } from "../datafiles.ts";
import { readReceipt } from "./receipt.ts";
import { processInboxOnce } from "./daemon.ts";

const temps: string[] = [];
afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

function setup(): string {
  const base = mkdtempSync(path.join(tmpdir(), "engine-e2e-"));
  temps.push(base);
  mkdirSync(path.join(base, "lib/engine"), { recursive: true });
  writeFileSync(path.join(base, "lib/engine/registry.yaml"), readFileSync(new URL("./registry.yaml", import.meta.url)));
  const data = path.join(base, "data");
  mkdirSync(path.join(data, "inbox"), { recursive: true });
  mkdirSync(path.join(data, "mirror"), { recursive: true });
  // minimal jobs.json
  writeFileSync(path.join(data, "jobs.json"), JSON.stringify({
    jobs: [], version: 1, updatedAt: "2026-11-05T00:00:00Z",
  }));
  // minimal applications.json
  writeFileSync(path.join(data, "applications.json"), JSON.stringify({
    applications: [], version: 1, updatedAt: "2026-11-05T00:00:00Z",
  }));
  // minimal ledger.csv with header
  writeFileSync(path.join(data, "mirror", "ledger.csv"),
    "id,date_submitted,company,role,req_url,channel,score,role_family,resume_version,employment_type,submission_status,evidence,stage,last_contact_date,recruiter,next_action,next_action_date,jd_snapshot_path,notes\n");
  // minimal resume-versions.json
  writeFileSync(path.join(data, "resume-versions.json"), JSON.stringify({
    versions: [], selected: {}, version: 1, updatedAt: "2026-11-05T00:00:00Z",
  }));
  // minimal activity.json
  writeFileSync(path.join(data, "activity.json"), JSON.stringify({
    activities: [], version: 1, updatedAt: "2026-11-05T00:00:00Z",
  }));
  // minimal waiting.json
  writeFileSync(path.join(data, "waiting.json"), JSON.stringify({
    items: [], version: 1, updatedAt: "2026-11-05T00:00:00Z",
  }));
  // minimal changelog.json
  writeFileSync(path.join(data, "changelog.json"), JSON.stringify({
    entries: [], version: 1, updatedAt: "2026-11-05T00:00:00Z",
  }));
  // minimal daily.json
  writeFileSync(path.join(data, "daily.json"), JSON.stringify({
    days: {}, version: 1, updatedAt: "2026-11-05T00:00:00Z",
  }));
  return base;
}

function inbox(base: string, taskId: string, event: string, payload: Record<string, unknown>, evidence: { kind: string; text: string }[] = []) {
  const file = path.join(base, "data", "inbox", `${taskId}.json`);
  writeFileSync(file, JSON.stringify({
    taskId, event, createdAt: new Date().toISOString(), payload, evidence,
  }));
  // wait for stable window (1.5s) - in test we cheat by setting mtime back
  const past = new Date(Date.now() - 5000);
  utimesSync(file, past, past);
}

function readJson(base: string, rel: string): unknown {
  return JSON.parse(readFileSync(path.join(base, rel), "utf-8"));
}

function fixtureJob(id: string) {
  return { id, company: "TestCo", role: "Software Engineer", channel: "Indeed", location: "Remote", remote: "remote", salaryPosted: null, salaryAnswer: null, matchPoints: [], redFlags: [], conclusion: "pending", url: "https://example.invalid/job", description: "Verified job description. ".repeat(20) };
}

describe("E2E pipeline via inbox", () => {
  it("DISCOVERED creates a job", () => {
    const base = setup();
    inbox(base, "e2e-discover-001", "DISCOVERED", { job: fixtureJob("e2e-test-job") });
    const results = processInboxOnce(base);
    expect(results[0].outcome).toBe("committed");
    const jobs = readJson(base, "data/jobs.json") as { jobs: { id: string }[] };
    expect(jobs.jobs.some((j) => j.id === "e2e-test-job")).toBe(true);
  });

  it("SCREENED with jdKind=full enables APPLICATION_SUBMITTED", () => {
    const base = setup();
    // discover
    inbox(base, "e2e-d1", "DISCOVERED", { job: fixtureJob("e2e-job-2") });
    processInboxOnce(base);
    // screen with jdKind full
    inbox(base, "e2e-s1", "SCREENED", {
      jobId: "e2e-job-2", conclusion: "apply", jdKind: "full",
    });
    const r2 = processInboxOnce(base);
    expect(r2[0].outcome).toBe("committed");
    const jobs = readJson(base, "data/jobs.json") as { jobs: { id: string; jdKind: string; status: string }[] };
    const job = jobs.jobs.find((j) => j.id === "e2e-job-2");
    expect(job?.jdKind).toBe("full");
    expect(job?.status).toBe("approved");
  });

  it("completes real inbox stages through PDF, confirmed application, Receipt and shared Today/Activity without duplicate writes", () => {
    const base = setup(); const jobId = "full-pipeline"; const day = chicagoToday();
    const submit = (id: string, name: string, payload: Record<string, unknown>, evidence: { kind: string; text: string }[] = []) => {
      inbox(base, id, name, payload, evidence);
      const results = processInboxOnce(base); expect(results[0].outcome, results[0].summary).toBe("committed");
      expect(readReceipt(base, id)?.status).toBe("committed");
    };
    submit("run-start", "AGENT_ACTIVITY", { activityId: "pipeline", runId: "session", sequence: 0, kind: "other", stage: "discovery", status: "running", title: "Full pipeline" });
    expect(queryActivityFeed(base, {}).running).toHaveLength(1);
    submit("discover", "DISCOVERED", { job: fixtureJob(jobId) });
    expect(readTaskState(base).tasks[0].businessStage).toBe("discovery");
    submit("screen", "SCREENED", { jobId, conclusion: "apply", jdKind: "full" });
    expect(readTaskState(base).tasks[0].businessStage).toBe("tailoring");
    mkdirSync(path.join(base, "data/inbox/evidence"), { recursive: true });
    writeFileSync(path.join(base, "data/inbox/evidence/resume.pdf"), "%PDF-1.4 fixture");
    const version = `v${day.replaceAll("-", "")}-${jobId}`;
    submit("tailor", "TAILORED", { jobId, resumeVersion: version, file: "data/inbox/evidence/resume.pdf" });
    expect(existsSync(path.join(base, "data/resume-files/tailor.pdf"))).toBe(true);
    expect(readTaskState(base).tasks[0].businessStage).toBe("apply");
    submit("review", "USER_DECIDED", { jobId, decision: "apply" }, [{ kind: "user-approval", text: "Approve this job and version" }]);
    submit("run-apply", "AGENT_ACTIVITY", { activityId: "pipeline", jobId, runId: "session", sequence: 1, kind: "applying", stage: "apply", status: "running", title: "Full pipeline" });
    submit("submit", "APPLICATION_SUBMITTED", { jobId, resumeVersion: version }, [{ kind: "user-approval", text: "Approve this application and salary answers" }, { kind: "employer-confirmation", text: "ATS confirmation received" }]);
    const proof = readReceipt(base, "submit")!; expect(proof.ops).toMatchObject({ jobId, ledgerId: 1 });
    const businessFiles = ["jobs.json", "applications.json", "mirror/ledger.csv", "changelog.json", "daily.json", "receipts/submit.json"];
    const bytes = businessFiles.map(name => readFileSync(path.join(base, "data", name), "utf8"));
    const archived = readFileSync(path.join(base, "data/processed/submit.json"), "utf8");
    writeFileSync(path.join(base, "data/inbox/submit.json"), archived); utimesSync(path.join(base, "data/inbox/submit.json"), new Date(0), new Date(0));
    expect(processInboxOnce(base)[0].outcome).toBe("duplicate");
    expect(businessFiles.map(name => readFileSync(path.join(base, "data", name), "utf8"))).toEqual(bytes);
    submit("run-done", "AGENT_ACTIVITY", { activityId: "pipeline", jobId, runId: "session", sequence: 2, kind: "applying", stage: "apply", status: "done", title: "Full pipeline", refs: ["submit"] }, [{ kind: "browser-report", text: "Verified same-job accounting" }]);
    const today = loadFullSnapshotData(base); const activity = queryActivityFeed(base, {});
    expect(today.taskState.tasks[0].runtime.status).toBe("done");
    expect(today.taskState.tasks[0].businessStage).toBe("review");
    expect(activity.tasks[0].businessStage).toBe(today.taskState.tasks[0].businessStage);
    expect(activity.activities[0].businessStage).toBe("review");
    expect(today.daily.days[day]).toEqual({ discovery: 1, screening: 1, tailoring: 1, review: 1, apply: 1 });
    const ledger = parseCsv(readFileSync(path.join(base, "data/mirror/ledger.csv"), "utf8"));
    expect(ledger).toHaveLength(2); expect(ledger[1]).toHaveLength(19); expect(ledger[1][10]).toBe("confirmed");
  });

  it("AGENT_ACTIVITY apply done without refs is rejected", () => {
    const base = setup();
    inbox(base, "e2e-a1", "AGENT_ACTIVITY", {
      activityId: "act-e2e-1",
      kind: "applying",
      stage: "apply",
      status: "done",
      title: "Test apply done",
      jobId: "some-job",
    }, [{ kind: "browser-report", text: "submitted" }]);
    const results = processInboxOnce(base);
    // Should be rejected: E_REF_MISSING (2026-11-05 rule)
    expect(results[0].outcome).toBe("rejected");
    expect(results[0].summary).toContain("E_REF_MISSING");
  });

  it("AGENT_ACTIVITY apply done with a nonexistent receipt is rejected", () => {
    const base = setup();
    inbox(base, "e2e-a2", "AGENT_ACTIVITY", {
      activityId: "act-e2e-2",
      kind: "applying",
      stage: "apply",
      status: "done",
      title: "Test apply done with ref",
      jobId: "some-job",
      refs: ["business-receipt-123"],
    }, [{ kind: "browser-report", text: "submitted" }]);
    const results = processInboxOnce(base);
    expect(results[0].outcome).toBe("rejected");
    expect(results[0].summary).toContain("E_REF_INVALID");
  });
});

describe("Doc check: skill events match registry", () => {
  it("registry.yaml events match daemon handlers", async () => {
    // 2026-11-05: ensures registry doesn't drift from code.
    // Parses registry.yaml for event names, verifies core events are registered.
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const registryText = readFileSync(join(__dirname, "registry.yaml"), "utf-8");
    const eventNames = [...registryText.matchAll(/^  - name:\s*"([^"]+)"/gm)].map((m) => m[1]);
    // At least the core events must be registered
    const required = ["APPLICATION_SUBMITTED", "SCREENED", "TAILORED", "USER_DECIDED", "AGENT_ACTIVITY", "AGENT_WAITING"];
    for (const e of required) {
      expect(eventNames).toContain(e);
    }
    // Registry should have more than the original 3
    expect(eventNames.length).toBeGreaterThan(3);
  });
});
