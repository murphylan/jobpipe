import { describe, expect, it } from "vitest";
import {
  checkLedgerFieldCount,
  dailyFileSchema,
  jobsFileSchema,
  applicationsFileSchema,
  changelogFileSchema,
} from "./schema";

const baseJob = {
  id: "test-job",
  company: "Test Co",
  role: "Full Stack Developer",
  channel: "LinkedIn",
  location: "Remote",
  remote: "remote",
  salaryPosted: null,
  salaryAnswer: null,
  matchPoints: ["Java"],
  redFlags: [],
  conclusion: "apply" as const,
  status: "screening" as const,
};

describe("engine schema", () => {
  it("accepts a valid jobs file and keeps unknown fields", () => {
    const parsed = jobsFileSchema.parse({
      jobs: [{ ...baseJob, jdMissing: "alert-only" }],
      version: 1,
      updatedAt: "2026-11-01T00:00:00Z",
    });
    expect(parsed.jobs[0].jdMissing).toBe("alert-only");
  });

  it("rejects duplicate job ids", () => {
    expect(() =>
      jobsFileSchema.parse({
        jobs: [baseJob, baseJob],
        version: 1,
        updatedAt: "2026-11-01T00:00:00Z",
      }),
    ).toThrow();
  });

  it("rejects an illegal job status", () => {
    expect(() =>
      jobsFileSchema.parse({
        jobs: [{ ...baseJob, status: "hired" }],
        version: 1,
        updatedAt: "2026-11-01T00:00:00Z",
      }),
    ).toThrow();
  });

  it("accepts an applications file and rejects duplicate application ids", () => {
    const app = {
      id: "2026-11-01-test",
      jobId: "test-job",
      ledgerRowId: null,
      resumeVersion: "v20261031-base",
      source: "LinkedIn",
      collectedAt: "2026-11-01T00:00:00Z",
      appliedAt: null,
      employerConfirmed: false,
      stage: "todo" as const,
      nextAction: null,
      nextActionDue: null,
      interviewAt: null,
      notes: "",
      version: 1,
      updatedAt: "2026-11-01T00:00:00Z",
    };
    expect(
      applicationsFileSchema.parse({ applications: [app], version: 1, updatedAt: "2026-11-01T00:00:00Z" }),
    ).toBeTruthy();
    expect(() =>
      applicationsFileSchema.parse({ applications: [app, app], version: 1, updatedAt: "2026-11-01T00:00:00Z" }),
    ).toThrow();
  });

  it("accepts daily and changelog files with version/updatedAt", () => {
    expect(
      dailyFileSchema.parse({
        days: { "2026-10-31": { discovery: 1, screening: 1, tailoring: 0, review: 0, apply: 0 } },
        version: 3,
        updatedAt: "2026-10-31T20:40:00Z",
      }),
    ).toBeTruthy();
    expect(
      changelogFileSchema.parse({
        entries: [{ at: "2026-11-01T00:00:00Z", action: "test", target: "jobs.json", version: 1, note: "" }],
        version: 32,
        updatedAt: "2026-10-31T20:40:00Z",
      }),
    ).toBeTruthy();
  });

  it("ledger field counts: 19 valid, 18 known drift, 17 invalid", () => {
    expect(checkLedgerFieldCount(new Array(19).fill(""))).toEqual({ ok: true, knownDrift: false });
    expect(checkLedgerFieldCount(new Array(18).fill(""))).toEqual({ ok: true, knownDrift: true });
    expect(checkLedgerFieldCount(new Array(17).fill("")).ok).toBe(false);
  });
});
