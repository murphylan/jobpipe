import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "../app/api/reconciliation/route";
let base: string;
const previous = process.env.PIPELINE_DIR;
beforeEach(() => { base = mkdtempSync(path.join(tmpdir(), "jobpipe-recon-")); mkdirSync(path.join(base, "data/engine"), { recursive: true }); process.env.PIPELINE_DIR = base; });
afterEach(() => { if (previous === undefined) delete process.env.PIPELINE_DIR; else process.env.PIPELINE_DIR = previous; rmSync(base, { recursive: true, force: true }); });
const write = (name: string, value: unknown) => writeFileSync(path.join(base, "data", name), JSON.stringify(value));
describe("reconciliation uses real association and canonical engine heartbeat", () => {
  it("reads the configured root, identifies old inbox including subdirectories, and is read-only", async () => {
    write("engine/heartbeat.json", { updatedAt: new Date().toISOString(), status: "running", pid: process.pid });
    for (const sub of ["inbox", "inbox/decisions", "inbox/muse-live"]) {
      mkdirSync(path.join(base, "data", sub), { recursive: true });
      const file = path.join(base, "data", sub, "old.json"); writeFileSync(file, "{}"); utimesSync(file, new Date(0), new Date(0));
    }
    const before = readFileSync(path.join(base, "data/engine/heartbeat.json"), "utf8");
    const response = await GET(); const body = await response.json();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body.issues.find((i: { type: string }) => i.type === "backlog").detail).toContain("3 个文件");
    expect(body.issues.find((i: { type: string }) => i.type === "backlog").detail).toContain("引擎在线");
    expect(readFileSync(path.join(base, "data/engine/heartbeat.json"), "utf8")).toBe(before);
  });
  it("reports linked apply completion without valid same-job business proof", async () => {
    write("jobs.json", { jobs: [{ id: "j", company: "C", role: "R", status: "approved" }] });
    write("activity.json", { activities: [{ activityId: "a", jobId: "j", kind: "applying", stage: "apply", title: "Fixture", status: "done", createdAt: new Date().toISOString(), startedAt: "", finishedAt: "", refs: ["invalid"], note: "", taskId: "t" }] });
    const body = await (await GET()).json();
    expect(body.issues).toEqual(expect.arrayContaining([expect.objectContaining({ type: "mismatch", severity: "red", jobId: "j" })]));
  });
  it("reports missing association rather than declaring historical activity reconciled", async () => {
    write("activity.json", { activities: [{ activityId: "a", kind: "other", title: "Legacy", status: "done", createdAt: new Date().toISOString(), startedAt: "", finishedAt: "", refs: [], note: "", taskId: "t" }] });
    const before = readFileSync(path.join(base, "data/activity.json"), "utf8");
    const body = await (await GET()).json();
    expect(body.issues.some((i: { type: string }) => i.type === "unlinked")).toBe(true);
    expect(readFileSync(path.join(base, "data/activity.json"), "utf8")).toBe(before);
  });
  it("does not flag batch-stage activities that legitimately have no jobId", async () => {
    write("activity.json", { activities: [{ activityId: "b", kind: "other", stage: "discovery", scope: "batch", title: "Batch discovery", status: "done", createdAt: new Date().toISOString(), startedAt: "", finishedAt: "", refs: [], note: "", taskId: "t" }] });
    const body = await (await GET()).json();
    expect(body.issues.some((i: { type: string }) => i.type === "unlinked")).toBe(false);
  });
  it("still flags apply-stage activities without a jobId", async () => {
    write("activity.json", { activities: [{ activityId: "c", kind: "applying", stage: "apply", title: "Apply run", status: "done", createdAt: new Date().toISOString(), startedAt: "", finishedAt: "", refs: [], note: "", taskId: "t" }] });
    const body = await (await GET()).json();
    expect(body.issues.some((i: { type: string }) => i.type === "unlinked")).toBe(true);
  });
  it("does not infer batch scope for unlinked screening activities", async () => {
    write("activity.json", { activities: [{ activityId: "single", kind: "screening", stage: "screening", title: "Screen one job", status: "done", createdAt: new Date().toISOString(), startedAt: "", finishedAt: "", refs: [], note: "", taskId: "single" }] });
    const body = await (await GET()).json();
    expect(body.issues.some((issue: { type: string }) => issue.type === "unlinked")).toBe(true);
  });

});
