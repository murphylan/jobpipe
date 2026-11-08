// Shared, read-only business/runtime projection. No sample fallback or writes.
export type BusinessStage = "discovery" | "screening" | "tailoring" | "apply" | "review" | "confirmed" | "closed";
export type TaskJob = { id: string; company: string; role: string; status: string; channel?: string };
export type TaskApplication = { id: string; jobId: string; stage: string; appliedAt: string | null; employerConfirmed: boolean; ledgerRowId?: string | null; resumeVersion?: string; nextAction?: string | null; nextActionDue?: string | null };
export type TaskRuntime = { status: "running" | "waiting" | "interrupted" | "failed" | "done" | "idle"; detail: string; source: "activity" | "live-signal" | "waiting" | "none"; activityId?: string; waitingId?: string; updatedAt?: string };
export type BusinessTask = { jobId: string; company: string; role: string; channel: string; businessStage: BusinessStage; unfinished: boolean; resumeVersion?: string; appliedAt?: string | null; runtime: TaskRuntime; href: string };
export const TERMINAL_APPLICATION_STAGES = ["offer", "rejected", "rejected_after_contact", "withdrawn", "ghosted"];
const terminal = new Set(TERMINAL_APPLICATION_STAGES);
export function businessStage(job: TaskJob, app: TaskApplication | undefined, tailored: boolean): BusinessStage {
  if (job.status === "dropped" || (app && terminal.has(app.stage))) return "closed";
  if (job.status === "applied" || app?.appliedAt) {
    return !app || !app.appliedAt || job.status !== "applied" || !app.employerConfirmed || app.nextAction ? "review" : "confirmed";
  }
  if (job.status === "approved") return tailored ? "apply" : "tailoring";
  if (job.status === "screening") return "screening";
  return "discovery";
}
export const BUSINESS_STAGE_LABELS: Record<BusinessStage, string> = {
  discovery: "待筛选", screening: "筛选中", tailoring: "待定制简历", apply: "待投递", review: "待复查/跟进", confirmed: "已确认", closed: "已结束",
};
function chicagoDate(iso: string): string {
  // A business date has no timezone; converting midnight UTC would move it to the previous day.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const date = new Date(`${iso}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : "";
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}
export function pendingTasks(tasks: BusinessTask[], limit = Infinity, today?: string): BusinessTask[] {
  const rank: Record<BusinessStage, number> = { apply: 0, tailoring: 1, screening: 2, discovery: 3, review: 4, confirmed: 5, closed: 6 };
  // Today 口径（2026-11-07 用户定版）：已投递的任务只在投递当日（Chicago 日期）留在
  // Today；非当日已投递一律下线（仍在 Jobs 页）。未投递的遗留任务不受日期限制。
  const inTodayScope = (t: BusinessTask) => {
    if (!today || !t.appliedAt) return true;
    const submitted = chicagoDate(t.appliedAt);
    return submitted === "" || submitted === today;
  };
  return tasks.filter((t) => t.unfinished && inTodayScope(t)).sort((a, b) => rank[a.businessStage] - rank[b.businessStage] || a.jobId.localeCompare(b.jobId)).slice(0, Math.max(0, limit));
}
export function freshRuntimeCount(runningActivities: readonly unknown[], tasks: BusinessTask[]): number {
  return runningActivities.length + tasks.filter((task) => task.runtime.status === "running" && !task.runtime.activityId).length;
}
