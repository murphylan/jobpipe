import { describe, expect, it } from "vitest";
import { filterJobs, searchJobs, findDuplicateJobs, applyScreeningUpdate, type Job } from "./jobs";

const j = (o: Partial<Job>): Job => ({
  id: "x", company: "Acme", role: "Backend Engineer",
  channel: "Other", location: "Remote", remote: "remote",
  salaryPosted: null, salaryAnswer: null,
  matchPoints: [], redFlags: [],
  conclusion: "pending", status: "screening", ...o,
});

const JOBS = [
  j({ id: "job-a", company: "Camunda", role: "Senior Backend", status: "applied" }),
  j({ id: "job-b", company: "Travoom", role: "Backend Engineer", status: "screening" }),
  j({ id: "job-c", company: "Samsara", role: "Backend Engineer", status: "dropped" }),
];

describe("filterJobs", () => {
  it("returns everything for 'all'", () => {
    expect(filterJobs(JOBS, "all")).toHaveLength(3);
  });
  it("filters by status", () => {
    expect(filterJobs(JOBS, "applied").map((x) => x.id)).toEqual(["job-a"]);
    expect(filterJobs(JOBS, "screening").map((x) => x.id)).toEqual(["job-b"]);
  });
  it("returns [] when nothing matches", () => {
    expect(filterJobs(JOBS, "approved")).toEqual([]);
  });
  it("does not mutate the input", () => {
    filterJobs(JOBS, "applied");
    expect(JOBS).toHaveLength(3);
  });
});

describe("searchJobs", () => {
  it("matches company case-insensitively", () => {
    expect(searchJobs(JOBS, "camunda").map((x) => x.id)).toEqual(["job-a"]);
    expect(searchJobs(JOBS, "CAMUNDA").map((x) => x.id)).toEqual(["job-a"]);
  });
  it("matches role", () => {
    expect(searchJobs(JOBS, "senior").map((x) => x.id)).toEqual(["job-a"]);
  });
  it("matches id", () => {
    expect(searchJobs(JOBS, "job-b").map((x) => x.id)).toEqual(["job-b"]);
  });
  it("blank keyword returns everything", () => {
    expect(searchJobs(JOBS, "  ")).toHaveLength(3);
  });
  it("returns [] on no match", () => {
    expect(searchJobs(JOBS, "zzz")).toEqual([]);
  });
});

describe("findDuplicateJobs", () => {
  it("detects same URL", () => {
    const jobs = [j({ id: "a", url: "https://x.com/1" }), j({ id: "b", url: "https://x.com/1" }), j({ id: "c", url: "https://x.com/2" })];
    const dupes = findDuplicateJobs(jobs);
    expect(dupes).toHaveLength(1);
    expect(dupes[0].map((x) => x.id).sort()).toEqual(["a", "b"]);
  });
  it("detects same company+role (case-insensitive)", () => {
    const jobs = [j({ id: "a", company: "Acme", role: "Backend" }), j({ id: "b", company: "ACME", role: "backend" })];
    expect(findDuplicateJobs(jobs)).toHaveLength(1);
  });
  it("returns [] when no duplicates", () => {
    const jobs = [j({ id: "a", url: "https://x.com/1" }), j({ id: "b", url: "https://x.com/2" })];
    expect(findDuplicateJobs(jobs)).toEqual([]);
  });
});

describe("applyScreeningUpdate", () => {
  it("protects approved status from screening overwrite", () => {
    const job = j({ id: "a", status: "approved", conclusion: "apply" });
    const updated = applyScreeningUpdate(job, { status: "screening", conclusion: "drop", matchPoints: ["x"] });
    expect(updated.status).toBe("approved");
    expect(updated.conclusion).toBe("apply");
    expect(updated.matchPoints).toEqual(["x"]);
  });
  it("protects applied status", () => {
    const job = j({ id: "a", status: "applied" });
    const updated = applyScreeningUpdate(job, { status: "dropped" });
    expect(updated.status).toBe("applied");
  });
  it("allows full update for screening status", () => {
    const job = j({ id: "a", status: "screening" });
    const updated = applyScreeningUpdate(job, { status: "approved", conclusion: "apply" });
    expect(updated.status).toBe("approved");
    expect(updated.conclusion).toBe("apply");
  });
});
