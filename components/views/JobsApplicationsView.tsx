"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Briefcase, ChevronDown } from "lucide-react";
import { filterJobs, searchJobs, type Job, type JobStatus } from "../../lib/jobs";
import type { Application, DailyFile, DailyTargetsFile } from "../../lib/datafiles";
import { REPLIED, INTERVIEW } from "../../lib/ledger";
import JobDrawer from "./JobDrawer";

const PAGE_SIZE = 15;

function interactionLabel(stage: string): { text: string; color: string; bg: string } {
  const s = (stage || "").toLowerCase();
  if (s.includes("reject")) return { text: "已拒绝", color: "#dc2626", bg: "#fef2f2" };
  if (s === "offer") return { text: "已发 Offer", color: "#15803d", bg: "#f0fdf4" };
  if (s === "interview") return { text: "面试中", color: "#7c3aed", bg: "#f5f3ff" };
  if (s === "screen") return { text: "已确认", color: "#1d4ed8", bg: "#eff6ff" };
  if (s === "replied") return { text: "已回复", color: "#1d4ed8", bg: "#eff6ff" };
  if (s === "applied") return { text: "已投递", color: "#475569", bg: "#f8fafc" };
  return { text: stage || "-", color: "#64748b", bg: "#f8fafc" };
}

type InteractionFilter = "all" | "waiting" | "replied" | "interview" | "offer" | "rejected" | "none";
const INTERACTION_FILTERS: [InteractionFilter, string][] = [
  ["all", "全部"],
  ["waiting", "等确认"],
  ["replied", "有回复"],
  ["interview", "面试中"],
  ["offer", "已发Offer"],
  ["rejected", "已拒绝"],
  ["none", "未投递"],
];

const JOB_STATUS_FILTERS: (JobStatus | "all")[] = ["all", "new", "screening", "approved", "applied", "dropped"];
const JOB_STATUS_LABELS: Record<string, string> = {
  all: "全部",
  new: "待筛选",
  screening: "筛选中",
  approved: "待投递",
  applied: "已投递",
  dropped: "已丢弃",
};

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "0%");

export default function JobsApplicationsView({ jobs, apps, daily, targets, today, onJobClick }: {
  jobs: Job[];
  apps: Application[];
  daily: DailyFile;
  targets: DailyTargetsFile;
  today: string;
  onJobClick?: (jobId: string) => void;
}) {
  const [kw, setKw] = useState("");
  const [jobStatus, setJobStatus] = useState<JobStatus | "all">("all");
  const [interaction, setInteraction] = useState<InteractionFilter>("all");
  const [channel, setChannel] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [drawerJob, setDrawerJob] = useState<Job | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const openedLink = useRef(false);
  useEffect(() => {
    if (openedLink.current) return;
    const id = new URLSearchParams(window.location.search).get("jobId");
    const job = jobs.find((job) => job.id === id);
    if (job) { openedLink.current = true; setDrawerJob(job); }
  }, [jobs]);

  const appByJobId = useMemo(() => new Map(apps.map((a) => [a.jobId, a])), [apps]);
  const channels = useMemo(() => ["all", ...Array.from(new Set(jobs.map((j) => j.channel).filter(Boolean))).sort()], [jobs]);

  const list = useMemo(() => {
    let base = searchJobs(filterJobs(jobs, jobStatus), kw);
    if (channel !== "all") base = base.filter((j) => j.channel === channel);
    if (interaction !== "all") {
      base = base.filter((j) => {
        const app = appByJobId.get(j.id);
        const s = (app?.stage || "").toLowerCase();
        if (interaction === "none") return !app;
        if (!app) return false;
        if (interaction === "waiting") return s === "applied";
        if (interaction === "replied") return s === "replied" || s === "screen";
        if (interaction === "interview") return s === "interview";
        if (interaction === "offer") return s === "offer";
        if (interaction === "rejected") return s.includes("reject");
        return true;
      });
    }
    return [...base].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  }, [jobs, jobStatus, kw, channel, interaction, appByJobId]);

  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = list.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const funnel = useMemo(() => {
    const total = apps.length;
    const replied = apps.filter((a) => REPLIED.has(a.stage)).length;
    const interviews = apps.filter((a) => INTERVIEW.has(a.stage)).length;
    const offers = apps.filter((a) => a.stage === "offer").length;
    return { total, replied, interviews, offers };
  }, [apps]);

  const dates = useMemo(() => Object.keys(daily.days).sort().slice(-7), [daily]);
  const max = Math.max(1, ...dates.map((d) => Math.max(targets.targets[d] ?? 20, daily.days[d].apply)));
  const histRows = useMemo(() => [...dates].reverse().map((d) => {
    const plan = targets.targets[d] ?? 20;
    const confirmed = daily.days[d].apply;
    const dayApps = apps.filter((a) => (a.appliedAt || "").slice(0, 10) === d);
    return { d, plan, confirmed, replies: dayApps.filter((a) => REPLIED.has(a.stage)).length, interviews: dayApps.filter((a) => INTERVIEW.has(a.stage)).length };
  }), [dates, daily, targets, apps]);

  const openDrawer = (job: Job) => { setDrawerJob(job); if (onJobClick) onJobClick(job.id); };

  return (
    <div className="content">
      <div className="head">
        <div className="hicon"><Briefcase size={24} strokeWidth={1.6} /></div>
        <div><div className="t"><h1>Jobs & Applications</h1></div><p>All-in-one: jobs, applications & history · Click a row for details</p></div>
      </div>
      <div style={{ display: "flex", gap: 20, marginBottom: 12, alignItems: "stretch" }}>
          {[
            { label: "投递", value: funnel.total, color: "#2563eb", bg: "#dbeafe" },
            { label: "有回复", value: funnel.replied, color: "#16a34a", bg: "#dcfce7", pct: pct(funnel.replied, funnel.total) },
            { label: "面试", value: funnel.interviews, color: "#9333ea", bg: "#f3e8ff", pct: pct(funnel.interviews, funnel.total) },
            { label: "Offer", value: funnel.offers, color: "#d97706", bg: "#fef3c7", pct: pct(funnel.offers, funnel.total) },
          ].map((f, i) => {
            const w = funnel.total > 0 ? Math.max(6, Math.round((f.value / funnel.total) * 100)) : 6;
            return (
              <div key={f.label} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, background: "#fff", border: "1px solid #dbe7f3", borderRadius: 12, padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12, color: "#64748b", display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: f.color, display: "inline-block" }} />
                    {f.label}
                  </span>
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>{i > 0 ? f.pct : ""}</span>
                </div>
                <div style={{ fontSize: 26, fontWeight: 800, color: "#0f172a", lineHeight: 1 }}>{f.value}</div>
                <div style={{ height: 8, borderRadius: 4, background: "#f1f5f9", overflow: "hidden" }}>
                  <div style={{ width: `${w}%`, height: "100%", borderRadius: 4, background: `linear-gradient(90deg, ${f.color}, ${f.color}cc)`, transition: "width 0.4s ease" }} />
                </div>
              </div>
            );
          })}
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <div style={{ position: "relative", flex: "1 1 220px", minWidth: 180 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2" strokeLinecap="round" style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
              <circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" />
            </svg>
            <input value={kw} onChange={(e) => { setKw(e.target.value); setPage(1); }} placeholder="搜索公司 / 职位…" style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px 9px 34px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 13, outline: "none", background: "#f8fafc" }} onFocus={(e) => { e.currentTarget.style.borderColor = "#93c5fd"; e.currentTarget.style.background = "#fff"; }} onBlur={(e) => { e.currentTarget.style.borderColor = "#e2e8f0"; e.currentTarget.style.background = "#f8fafc"; }} />
          </div>
          <select value={channel} onChange={(e) => { setChannel(e.target.value); setPage(1); }} style={{ padding: "9px 32px 9px 12px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 13, background: "#fff", appearance: "none", backgroundImage: "url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2394a3b8%22 stroke-width=%222.5%22><path d=%22m6 9 6 6 6-6%22/></svg>')", backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center", cursor: "pointer" }}>
            {channels.map((c) => <option key={c} value={c}>{c === "all" ? "全部渠道" : c}</option>)}
          </select>
          <select value={jobStatus} onChange={(e) => { setJobStatus(e.target.value as JobStatus | "all"); setPage(1); }} style={{ padding: "9px 32px 9px 12px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 13, background: "#fff", appearance: "none", backgroundImage: "url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2394a3b8%22 stroke-width=%222.5%22><path d=%22m6 9 6 6 6-6%22/></svg>')", backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center", cursor: "pointer" }}>
            {JOB_STATUS_FILTERS.map((s) => <option key={s} value={s}>{JOB_STATUS_LABELS[s]}</option>)}
          </select>
          <select value={interaction} onChange={(e) => { setInteraction(e.target.value as InteractionFilter); setPage(1); }} style={{ padding: "9px 32px 9px 12px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 13, background: "#fff", appearance: "none", backgroundImage: "url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2394a3b8%22 stroke-width=%222.5%22><path d=%22m6 9 6 6 6-6%22/></svg>')", backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center", cursor: "pointer" }}>
            {INTERACTION_FILTERS.map(([v, l]) => <option key={v} value={v}>交互：{l}</option>)}
          </select>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#475569", background: "#f1f5f9", padding: "5px 12px", borderRadius: 999 }}>{list.length} 条</span>
      </div>
      <style>{`.jobs-table .tr-body:hover { background: #e8f1fb; }`}</style>
      <div className="jobs-table" style={{ marginBottom: 12, overflowX: "auto", background: "#fff", border: "1px solid #dbe7f3", borderRadius: 12 }}>
        <div className="inner" style={{ padding: 0 }}>
          <div className="tr th mono" style={{ display: "grid", gridTemplateColumns: "36px 2.2fr 0.8fr 0.9fr 1fr 1fr 0.9fr", columnGap: 12, padding: "10px 12px", fontSize: 13, color: "#666", fontWeight: 400, borderBottom: "2px solid #dbe7f3", background: "#fff" }}>
            <span>#</span><span>公司 / 职位</span><span>渠道</span><span>投递状态</span><span>交互阶段</span><span>简历</span><span>更新</span>
          </div>
          {pageItems.map((job, idx) => {
            const app = appByJobId.get(job.id);
            const ia = interactionLabel(app?.stage || "");
            return (
              <div key={job.id} className="tr tr-body" onClick={() => openDrawer(job)} style={{ display: "grid", gridTemplateColumns: "36px 2.2fr 0.8fr 0.9fr 1fr 1fr 0.9fr", columnGap: 12, padding: "10px 12px", cursor: "pointer", borderBottom: "1px solid #eef3f9", fontSize: 14 }}>
                <span className="mono" style={{ fontSize: 12, color: "#94a3b8" }}>{(safePage - 1) * PAGE_SIZE + idx + 1}</span>
                <span style={{ minWidth: 0, verticalAlign: "top" }}>
                  <b style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "#2563eb", fontSize: 14, fontWeight: 600 }} title={job.company}>{job.company}</b>
                  <small style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "#64748b", fontSize: 12 }} title={job.role}>{job.role}</small>
                </span>
                <span style={{ fontSize: 14, verticalAlign: "top" }}>{job.channel || "-"}</span>
                <span style={{ fontSize: 14, verticalAlign: "top" }}>{JOB_STATUS_LABELS[job.status] || job.status}</span>
                <span style={{ verticalAlign: "top" }}><span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: 12, color: ia.color, background: ia.bg }}>{ia.text}</span></span>
                <span className="mono" style={{ fontSize: 12, verticalAlign: "top" }}>{app?.resumeVersion || "-"}</span>
                <span className="mono" style={{ fontSize: 13, color: "#666", verticalAlign: "top", whiteSpace: "nowrap" }}>{(job.updatedAt || "").slice(0, 10)}</span>
              </div>
            );
          })}
          {!pageItems.length && <div className="empty" style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>没有匹配的记录</div>}
        </div>
      </div>
      {totalPages > 1 && (
        <div className="pager mono" style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "center", padding: "4px 0 12px" }}>
          <button disabled={safePage <= 1} onClick={() => setPage(safePage - 1)} style={{ padding: "6px 12px", border: "1px solid #e2e8f0", borderRadius: 6, background: "#fff", cursor: safePage <= 1 ? "default" : "pointer" }}>← Prev</button>
          <span style={{ fontSize: 13 }}>{safePage} / {totalPages}</span>
          <button disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)} style={{ padding: "6px 12px", border: "1px solid #e2e8f0", borderRadius: 6, background: "#fff", cursor: safePage >= totalPages ? "default" : "pointer" }}>Next →</button>
        </div>
      )}
      <div className="panel" style={{ marginBottom: 12, borderRadius: 6 }}>
        <button onClick={() => setHistoryOpen(!historyOpen)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", background: "none", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#475569" }}>
          <span>历史战绩 · 近7天计划 vs 实际</span>
          <ChevronDown size={16} style={{ transform: historyOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
        </button>
        {historyOpen && (
          <div className="inner">
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", height: 120, marginBottom: 12 }}>
              {dates.map((d) => (
                <div key={d} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 80 }}>
                    <div title={`计划 ${targets.targets[d] ?? 20}`} style={{ width: 14, height: `${Math.round((100 * (targets.targets[d] ?? 20)) / max)}%`, background: "#eceae5", borderRadius: "2px 2px 0 0" }} />
                    <div title={`实际 ${daily.days[d].apply}`} style={{ width: 14, height: `${Math.round((100 * daily.days[d].apply) / max)}%`, background: "#1a7f37", borderRadius: "2px 2px 0 0" }} />
                  </div>
                  <span style={{ fontSize: 10, color: "#64748b" }}>{d.slice(5)}</span>
                </div>
              ))}
            </div>
            <div className="tr th mono" style={{ gridTemplateColumns: "1fr 0.6fr 0.6fr 0.6fr 0.7fr 0.7fr", fontSize: 11, color: "#64748b", padding: "6px 0", borderBottom: "1px solid #e2e8f0" }}>
              <span>日期</span><span>计划</span><span>完成</span><span>达成率</span><span>回复</span><span>面试</span>
            </div>
            {histRows.map((r) => (
              <div key={r.d} className="tr" style={{ gridTemplateColumns: "1fr 0.6fr 0.6fr 0.6fr 0.7fr 0.7fr", fontSize: 13, padding: "6px 0", borderBottom: "1px solid #f1f5f9" }}>
                <span className="mono">{r.d}{r.d === today ? " · 进行中" : ""}</span>
                <span className="mono">{r.plan}</span>
                <span className="mono">{r.confirmed}</span>
                <span className="mono">{pct(r.confirmed, r.plan)}</span>
                <span className="mono">{r.replies}</span>
                <span className="mono">{r.interviews}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <JobDrawer job={drawerJob} onClose={() => setDrawerJob(null)} application={drawerJob ? appByJobId.get(drawerJob.id) ?? null : null} />
    </div>
  );
}
