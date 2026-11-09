"use client";

import ReconciliationNotice from "./ReconciliationNotice";

import { fetchJson, pollInForeground } from "../lib/polling";
import { useEffect, useState } from "react";
import { CircleCheck, CircleHelp, FolderOpen } from "lucide-react";
import type { BusinessTask } from "../lib/task-state";
import { freshRuntimeCount, pendingTasks } from "../lib/task-state";
import type { FullSnapshot } from "../lib/datafiles";
import { todayStats } from "../lib/ledger";
import TaskList from "./TaskList";
import JobDrawer from "./views/JobDrawer";

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/Chicago" });
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "0%");

export default function Dashboard({
  snap,
  synced,
  offline,
  note,
  onJobClick,
  onGoActivity,
}: {
  snap: FullSnapshot;
  synced: string;
  offline: boolean;
  note: string;
  onJobClick?: (jobId: string) => void;
  onGoActivity?: () => void;
}) {
  const [helpOpen, setHelpOpen] = useState<null | "run" | "note">(null);
  // 数据源路径 popover 独立 state（2026-11-05）
  const [srcOpen, setSrcOpen] = useState(false);
  // 右侧抽屉：点击任务行查看职位详情（不跳转页面）
  const [drawerJobId, setDrawerJobId] = useState<string | null>(null);
  // Activity 入口的实时信号：与 Activity 页同源（/api/activity 的 running + /api/engine 的心跳），只读。
  const [live, setLive] = useState<{ running: number; runningTitle: string | null; engineOnline: boolean | null; tasks?: BusinessTask[] }>({ running: 0, runningTitle: null, engineOnline: null });
  // 对账红条：检测活动与岗位不一致、收件箱积压、被拒事件（2026-11-05）
  const [recon, setRecon] = useState<{ issues: { type: string; severity: string; title: string; detail: string }[] }>({ issues: [] });
  useEffect(() => {
    const poller = pollInForeground(async signal => {
      try {
        const [a, e] = await Promise.all([
          fetchJson<{ running?: { title: string }[]; tasks?: BusinessTask[] }>("/api/activity", signal),
          fetchJson<{ heartbeat?: { status: string } }>("/api/engine", signal),
        ]);
        if (signal.aborted) return;
        const r = a.running ?? [];
        const count = freshRuntimeCount(r, a.tasks ?? []);
        setLive({ tasks: a.tasks, running: count, runningTitle: count === 1 ? r[0]?.title ?? a.tasks?.find(task => task.runtime.status === "running")?.company ?? null : null, engineOnline: e.heartbeat?.status === "online" });
      } catch { if (!signal.aborted) setLive({ running: 0, runningTitle: null, engineOnline: null }); }
    }, 2000);
    return poller.stop;
  }, []);
  useEffect(() => {
    const poller = pollInForeground(async signal => {
      try {
        const r = await fetchJson<{ issues: { type: string; severity: string; title: string; detail: string }[] }>("/api/reconciliation", signal);
        setRecon(r);
      } catch { if (!signal.aborted) setRecon({ issues: [{ type: "unavailable", severity: "warning", title: "对账暂不可用", detail: "无法确认当前对账结果，等待重新连接。" }] }); }
    }, 30000);
    return poller.stop;
  }, []);

  const { ledger, today } = snap;
  const st = todayStats(ledger, today);
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const plan = snap.dailyTargets.targets[today] ?? 20;
  const confirmedToday = st.today.LinkedIn + st.today.Indeed + st.today.Other;
  // 指标栏口径（2026-11-08 用户定版）：与下方今日待处理列表同源同范围——按列表中各任务
  // 当前所处环节计数，不再用引擎的“今日完成次数”，避免指标与表格内容对不上。
  const visibleTasks = pendingTasks(live.tasks ?? snap.taskState.tasks, plan, today);
  const stageCount = (s: string) => visibleTasks.filter((t) => t.businessStage === s).length;
  const stages = {
    discovery: stageCount("discovery"),
    screening: stageCount("screening"),
    tailoring: stageCount("tailoring"),
    apply: stageCount("apply"),
    review: stageCount("review"),
  };
  // 真实可用存货：从 jobs.json 算，不是从今日动作计数算
  const allJobs = snap.jobs.jobs;
  const approvedAvail = allJobs.filter((j) => j.status === "approved").length;
  const screeningAvail = allJobs.filter((j) => j.status === "screening").length;
  const stockTotal = approvedAvail + screeningAvail;
  const remaining = Math.max(0, plan - confirmedToday);
  const gap = remaining - stockTotal;
  // 2026-11-05 简化：只保留关键数字，去掉冗余 breakdown。
  const noteText = `存货 ${stockTotal} 家（可投 ${approvedAvail} + 待批 ${screeningAvail}），已确认 ${confirmedToday}/${plan}。${gap > 0 ? `缺口 ${gap} 家。` : "存货充足。"}`;
  // Help 图标背后的 popover：点图标展开，再点图标或点空白处关闭；纯 CSS 定位，首屏不读 window。
  const HelpTip = ({ id, text }: { id: "run" | "note"; text: string }) => (
    <span style={{ position: "relative", display: "inline-block" }}>
      <button aria-label="帮助" title="帮助" onClick={() => setHelpOpen(helpOpen === id ? null : id)} style={{ width: 22, height: 22, borderRadius: "50%", border: "1px solid #dbe7f3", background: "#fff", color: "#2563eb", cursor: "pointer", padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <CircleHelp size={16} strokeWidth={1.6} />
      </button>
      {helpOpen === id && (
        <>
          <span style={{ position: "fixed", inset: 0, zIndex: 9 }} onClick={() => setHelpOpen(null)} />
          <span style={{ position: "absolute", top: "100%", left: 0, marginTop: 6, zIndex: 10, background: "#fff", border: "1px solid #dbe7f3", borderRadius: 12, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", padding: "10px 12px", fontSize: 14, lineHeight: 1.6, width: "min(480px, 80vw)", textAlign: "left" }}>{text}</span>
        </>
      )}
    </span>
  );

  return (
    <div className="content" id="today">
      {(snap.jobsSource === "corrupt" || snap.jobsSource === "missing") && (
        <div style={{ background: "#fde8e8", border: "1px solid #e5484d", color: "#8b1a1a", borderRadius: 8, padding: "10px 12px", marginBottom: 12 }}>
          ⚠️ jobs.json {snap.jobsSource === "corrupt" ? "解析失败" : "缺失"}：Jobs 与存货暂不可信（读到空数组），ledger 不受影响。请先修复 jobs.json 再继续记账。
        </div>
      )}
      <div className="head">
        <div className="hicon">
          <CircleCheck size={24} strokeWidth={1.6} />
        </div>
        <div>
          <div className="t">
            <h1>Today&apos;s run</h1>
            <HelpTip id="run" text={`Remote 优先 · $120K+ · LinkedIn/Indeed`} />
            <span className="pill">
              <i className={`dot live${offline ? " n" : ""}`} />
              {offline ? "Offline, retrying" : `Live · synced ${clock(synced)}`}
            </span>
            {note && <span className="pill flash">{note}</span>}
          </div>
        </div>
        <div className="acts">
          {/* 2026-11-05: 数据源路径收进图标，点击展开，界面保持干净 */}
          <button onClick={() => setSrcOpen(!srcOpen)} title="点击查看数据路径" style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", padding: "4px 8px", position: "relative" }}>
            <FolderOpen size={14} strokeWidth={1.6} />
            <span style={{ fontSize: 11, color: snap.source === "live" ? "#1a7f37" : "#92400e" }}>
              {snap.source === "live" ? "live" : snap.source === "sample" ? "sample" : snap.source === "missing" ? "数据缺失" : "数据损坏"}
            </span>
            {srcOpen && (
              <span style={{ position: "absolute", top: "100%", right: 0, marginTop: 6, zIndex: 10, background: "#fff", border: "1px solid #dbe7f3", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", padding: "8px 12px", fontSize: 12, color: "#666", whiteSpace: "nowrap", fontFamily: "monospace" }} onClick={(e) => e.stopPropagation()}>
                {snap.source === "sample" ? "样例数据（非真实）" : snap.dir}
              </span>
            )}
          </button>
          {srcOpen && (
            <span style={{ position: "fixed", inset: 0, zIndex: 9 }} onClick={() => setSrcOpen(false)} />
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13, color: "#666", marginBottom: 12 }}>
        <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: live.running > 0 ? "#2563eb" : "#1a7f37", flexShrink: 0 }} />
        {live.running > 0 ? `Muse 正在干：${live.runningTitle ? `${live.runningTitle}（${live.running} 项进行中）` : `${live.running} 项进行中`}` : "暂无新鲜运行信号"}
        {live.engineOnline === null ? "" : live.engineOnline ? " · 引擎在线" : " · 引擎离线"}
        {onGoActivity ? (
          <button onClick={onGoActivity} style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 13, padding: 0 }}>
            去 Activity 看 →
          </button>
        ) : (
          <a href="/activity" style={{ color: "#2563eb" }}>
            去 Activity 看 →
          </a>
        )}
        <HelpTip id="note" text={noteText} />
        <ReconciliationNotice issues={recon.issues} />
      </div>

      {/* Databricks 风格紧凑指标栏 */}
      <div style={{ display: "flex", alignItems: "stretch", border: "1px solid #e2e8f0", borderRadius: 6, background: "#fff", overflow: "hidden", marginBottom: 12 }}>
        {[
          { label: "PLAN", value: plan, sub: `待处理 ${visibleTasks.length} · 已确认 ${confirmedToday}`, title: `今日目标 ${plan} · 待处理 ${visibleTasks.length}（与下方列表一致） · 已确认 ${confirmedToday} · 存货 ${stockTotal}（可投 ${approvedAvail} + 待批 ${screeningAvail}）`, accent: gap > 0 },
          { label: "发现", value: stages.discovery, sub: "待筛选", title: "待处理列表中待筛选的任务数", pct: pct(stages.discovery, plan) },
          { label: "筛选", value: stages.screening, sub: "筛选中", title: "待处理列表中筛选中的任务数", pct: pct(stages.screening, stages.discovery) },
          { label: "定制简历", value: stages.tailoring, sub: "待定制", title: "待处理列表中待定制简历的任务数", pct: pct(stages.tailoring, stages.screening) },
          { label: "投递", value: stages.apply, sub: "待投递", title: "待处理列表中待投递的任务数", pct: pct(stages.apply, stages.tailoring) },
          { label: "复查", value: stages.review, sub: "待复查/跟进", title: "待处理列表中待复查/跟进的任务数", pct: pct(stages.review, stages.apply) },
          { label: "已确认", value: confirmedToday, sub: "今日确认", title: "今日账本已确认的投递数（客户确认信）", pct: pct(confirmedToday, stages.review) },
        ].map((m, i) => (
          <div key={m.label} style={{ display: "flex", flex: 1, minWidth: 0 }}>
            {i > 0 && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 6px", background: "#f8fafc", borderLeft: "1px solid #e2e8f0", borderRight: "1px solid #e2e8f0" }}>
                <span style={{ fontSize: 10, color: "#059669", fontWeight: 600 }}>{m.pct}</span>
                <span style={{ fontSize: 10, color: "#94a3b8" }}>→</span>
              </div>
            )}
            <div
              title={m.title}
              style={{ flex: 1, minWidth: 0, padding: "10px 14px", background: m.accent ? "#fffbeb" : "#fff", borderLeft: m.accent ? "3px solid #f59e0b" : "none" }}
            >
              <div style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "#64748b", fontWeight: 600, marginBottom: 2 }}>{m.label}</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: "#0f172a", letterSpacing: "-0.02em", lineHeight: 1.1 }}>{m.value}</div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.sub}</div>
            </div>
          </div>
        ))}
      </div>

      {/* 今日待投递：投递流水线，仅未投递项 */}
      <TaskList
        plan={plan}
        tasks={live.tasks ?? snap.taskState.tasks}
        today={today}
        nowMs={Date.parse(synced)}
        onJobClick={(id) => setDrawerJobId(id)}
      />

      {/* 右侧抽屉：任务行点击查看职位详情 */}
      <JobDrawer
        job={drawerJobId ? allJobs.find((j) => j.id === drawerJobId) ?? null : null}
        onClose={() => setDrawerJobId(null)}
        application={drawerJobId ? snap.applications.applications.find((a) => a.jobId === drawerJobId) ?? null : null}
      />
    </div>
  );
}
