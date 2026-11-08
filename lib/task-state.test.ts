import { describe, expect, it } from "vitest";
import { businessStage, freshRuntimeCount, pendingTasks, type BusinessTask, type TaskApplication } from "./task-state";
const job = { id: "j", company: "C", role: "R", status: "new" };
const app: TaskApplication = { id: "a", jobId: "j", stage: "todo", appliedAt: null, employerConfirmed: false };
describe("shared business stages (separate from runtime)", () => {
  it("counts fresh legacy signals without inventing activity events or double-counting linked runs", () => {
    const tasks = [{ runtime: { status: "running", activityId: "a" } }, { runtime: { status: "running", source: "live-signal" } }, { runtime: { status: "interrupted" } }] as BusinessTask[];
    expect(freshRuntimeCount([{}], tasks)).toBe(2);
  });
  it.each([
    ["new", false, "discovery"], ["screening", false, "screening"], ["approved", false, "tailoring"], ["approved", true, "apply"], ["dropped", true, "closed"],
  ])("maps %s / tailored=%s to %s", (status, tailored, expected) => {
    expect(businessStage({ ...job, status: status as string }, undefined, tailored as boolean)).toBe(expected);
  });
  it("does not infer submission from a selected or tailored resume", () => {
    expect(businessStage({ ...job, status: "approved" }, app, true)).toBe("apply");
  });
  it("does not declare partial application/job updates complete", () => {
    expect(businessStage({ ...job, status: "applied" }, undefined, true)).toBe("review");
    expect(businessStage({ ...job, status: "approved" }, { ...app, appliedAt: "2026-11-06", employerConfirmed: true }, true)).toBe("review");
  });
  it("includes submitted unconfirmed and follow-up work, excludes terminal applications", () => {
    expect(businessStage(job, { ...app, appliedAt: "2026-11-06", stage: "applied" }, true)).toBe("review");
    expect(businessStage(job, { ...app, appliedAt: "2026-11-06", employerConfirmed: true, nextAction: "Follow up" }, true)).toBe("review");
    expect(businessStage({ ...job, status: "applied" }, { ...app, appliedAt: "2026-11-06", employerConfirmed: true }, true)).toBe("confirmed");
    for (const stage of ["rejected", "rejected_after_contact", "withdrawn", "ghosted", "offer"])
      expect(businessStage(job, { ...app, stage }, true)).toBe("closed");
  });
  it("only limits Today display; Activity may retain the entire unfinished backlog", () => {
    const tasks = ["a", "b", "c"].map((jobId) => ({ jobId, businessStage: "apply", unfinished: true })) as BusinessTask[];
    expect(pendingTasks(tasks, 2)).toHaveLength(2);
    expect(pendingTasks(tasks)).toHaveLength(3);
  });
});

 it("keeps a date-only business submission on its literal business date", () => {
  const task: BusinessTask = { jobId: "date-job", company: "Fixture", role: "Engineer", channel: "Other", businessStage: "review", unfinished: true, appliedAt: "2026-10-30", runtime: { status: "idle", detail: "", source: "none" }, href: "/jobs-applications" };
  expect(pendingTasks([task], 20, "2026-10-30")).toHaveLength(1);
  expect(pendingTasks([task], 20, "2026-10-29")).toHaveLength(0);
  expect(pendingTasks([{ ...task, appliedAt: "2026-10-30T01:00:00Z" }], 20, "2026-10-29")).toHaveLength(1);
});
