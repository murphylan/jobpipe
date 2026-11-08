import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { businessStage, pendingTasks, type BusinessTask, type TaskApplication, type TaskJob, type TaskRuntime } from "../task-state.ts";
import { ACTIVITY_LEASE_MS, runtimeStatus } from "./activity-lifecycle.ts";
import { parseCsv } from "../csv.ts";
export function readBusinessArray<T>(base: string, name: string, key: string): T[] {
  const file = path.join(base, "data", name);
  if (!existsSync(file)) return [];
  const data = JSON.parse(readFileSync(file, "utf8"));
  if (!data || !Array.isArray(data[key]) || data[key].some((entry: unknown) => !entry || typeof entry !== "object" || Array.isArray(entry)))
    throw new Error(`${name}: invalid ${key}`);
  return data[key];
}
type Activity = { activityId: string; jobId?: string; status: string; createdAt: string; taskId: string; note?: string; leaseExpiresAt?: string };
type Waiting = { waitingId: string; jobId?: string; sourceActivityId: string | null; status: string; createdAt: string; answeredAt?: string; question: string };
export function readTaskState(base: string, nowMs = Date.now()): { tasks: BusinessTask[]; issues: string[] } {
  const issues: string[] = [];
  const read = <T>(name: string, key: string) => {
    try { return readBusinessArray<T>(base, name, key); } catch (e) { issues.push(String(e)); return []; }
  };
  const jobs = read<TaskJob>("jobs.json", "jobs");
  const apps = read<TaskApplication>("applications.json", "applications");
  const versions = read<{ jobId: string; version: string; createdAt?: string }>("resume-versions.json", "versions");
  const activities = read<Activity>("activity.json", "activities");
  const waiting = read<Waiting>("waiting.json", "items");
  // 时间兜底（2026-11-08 用户定版）：无单岗位运行记录时，列表时间列用该岗位最近一次
  // 业务事件（发现/筛选/定制简历等）的时间显示，避免整批运行的岗位时间列为空。
  // 数据源：changelog 中 note 以空格分词含 jobId 的业务条目 + 简历版本的 createdAt。
  const changelog = read<{ at: string; note?: string }>("changelog.json", "entries");
  const latestBizAt = new Map<string, string>();
  const bumpBiz = (jobId: string, at: string) => {
    if (!/^\d{4}-\d{2}-\d{2}T/.test(at)) return;
    const prev = latestBizAt.get(jobId);
    if (!prev || Date.parse(at) > Date.parse(prev)) latestBizAt.set(jobId, at);
  };
  for (const v of versions) if (v && v.jobId && v.createdAt) bumpBiz(v.jobId, v.createdAt);
  const jobIds = new Set(jobs.map((j) => j && j.id).filter(Boolean) as string[]);
  for (const e of changelog) {
    if (!e || typeof e.at !== "string" || typeof e.note !== "string") continue;
    for (const token of e.note.split(/\s+/)) if (jobIds.has(token)) bumpBiz(token, e.at);
  }
  let confirmedLedgerIds = new Set<string>();
  // 投影兜底（2026-11-08 用户定版）：无申请记录的历史投递，用 ledger 已确认行的
  // date_submitted 作为 appliedAt 兜底（按公司+职位归一化匹配），使 Today 日期口径生效。
  const confirmedLedgerDates = new Map<string, string>();
  const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  try {
    const ledger = path.join(base, "data/mirror/ledger.csv");
    if (existsSync(ledger)) {
      const rows = parseCsv(readFileSync(ledger, "utf8")).slice(1).filter((row) => row[10] === "confirmed");
      confirmedLedgerIds = new Set(rows.map((row) => row[0]));
      for (const row of rows) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(row[1] ?? "")) continue;
        const key = `${normKey(row[2] ?? "")}|${normKey(row[3] ?? "")}`;
        if (!confirmedLedgerDates.has(key)) confirmedLedgerDates.set(key, row[1]);
      }
    }
  } catch { issues.push("ledger.csv: unreadable"); }
  const ledgerDateFallback = (job: TaskJob): string | null => {
    const d = confirmedLedgerDates.get(`${normKey(job.company)}|${normKey(job.role)}`);
    return d ? `${d}T12:00:00Z` : null;
  };
  const latest = new Map<string, Activity>();
  for (const a of activities) if (a && typeof a.activityId === "string") latest.set(a.activityId, a);
  const byJob = new Map<string, Activity>();
  for (const a of latest.values()) if (a.jobId) {
    const previous = byJob.get(a.jobId);
    if (!previous || Date.parse(a.createdAt) >= Date.parse(previous.createdAt)) byJob.set(a.jobId, a);
  }
  let live: Record<string, { state: string; detail: string; updatedAt: string }> = {};
  try {
    const file = path.join(base, "data/muse-live.json");
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      if (!parsed || !parsed.live || typeof parsed.live !== "object" || Array.isArray(parsed.live)) throw new Error("invalid live map");
      live = parsed.live;
    }
  } catch { issues.push("muse-live.json: unreadable"); }
  const tasks = jobs.filter((j) => j && typeof j.id === "string").map((job): BusinessTask => {
    const matches = apps.filter((a) => a.jobId === job.id);
    const app = matches.findLast((a) => !!a.appliedAt) ?? matches.at(-1);
    const version = versions.findLast((v) => v.jobId === job.id);
    let stage = businessStage(job, app, !!version);
    if (stage === "confirmed" && (!app?.ledgerRowId || !confirmedLedgerIds.has(app.ledgerRowId))) stage = "review";
    const a = byJob.get(job.id);
    let runtime: TaskRuntime = { status: "idle", detail: "无运行信号", source: "none" };
    if (a) runtime = { status: runtimeStatus(a, nowMs) as TaskRuntime["status"], detail: a.note ?? "", source: "activity", activityId: a.activityId, updatedAt: a.createdAt };
    else if (live[job.id] && typeof live[job.id] === "object") {
      const signal = live[job.id];
      const fresh = Number.isFinite(Date.parse(signal.updatedAt)) && nowMs >= Date.parse(signal.updatedAt) && nowMs - Date.parse(signal.updatedAt) < ACTIVITY_LEASE_MS;
      runtime = { status: signal.state === "waiting_user" ? "waiting" : fresh ? "running" : "interrupted", detail: signal.detail, source: "live-signal", updatedAt: signal.updatedAt };
    }
    const waits = waiting.filter((w) => w && (w.jobId === job.id || (w.sourceActivityId && activities.some((entry) => entry.activityId === w.sourceActivityId && entry.jobId === job.id))));
    const open = waits.findLast((w) => w.status === "open");
    if (open) runtime = { ...runtime, status: "waiting", source: "waiting", waitingId: open.waitingId, detail: open.question };
    else if (!(runtime.source === "activity" && (runtime.status === "done" || runtime.status === "failed"))) {
      // 终态锁定（2026-11-07 定版）：活动已 done/failed 时，迟到的 waiting 答复
      // 不得把运行时状态改写回 waiting——业务终态优先于运行时推断。
      const answered = waits.findLast((w) => w.status === "answered" || w.status === "parked");
      if (answered && (runtime.status === "waiting" || Date.parse(answered.answeredAt ?? answered.createdAt) >= Date.parse(runtime.updatedAt ?? "1970-01-01T00:00:00Z")))
        runtime = { ...runtime, status: "waiting", source: "waiting", waitingId: answered.waitingId, detail: answered.status === "answered" ? "已答复，等待 Agent 续跑信号" : "已暂放，尚未续跑" };
    }
    if (!runtime.updatedAt) {
      const bizAt = latestBizAt.get(job.id);
      if (bizAt) runtime = { ...runtime, updatedAt: bizAt };
    }
    return { jobId: job.id, company: job.company, role: job.role, channel: job.channel ?? "", businessStage: stage,
      unfinished: !["confirmed", "closed"].includes(stage), appliedAt: app?.appliedAt ?? (job.status === "applied" ? ledgerDateFallback(job) : null), resumeVersion: app?.resumeVersion || version?.version,
      runtime, href: `/jobs-applications?jobId=${encodeURIComponent(job.id)}` };
  });
  return { tasks: [...pendingTasks(tasks), ...tasks.filter((t) => !t.unfinished)], issues };
}
