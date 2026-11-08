"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Briefcase } from "lucide-react";
import { filterJobs, searchJobs, type Job, type JobStatus } from "../../lib/jobs";
import JobDrawer from "./JobDrawer";

const FILTERS: (JobStatus | "all")[] = ["all", "new", "screening", "approved", "applied", "dropped"];
const LABELS: Record<(typeof FILTERS)[number], string> = {
  all: "All",
  new: "Pending",
  screening: "Screening",
  approved: "Approved",
  applied: "Applied",
  dropped: "Dropped",
};
const DOT: Record<JobStatus, string> = { new: "k", screening: "w", approved: "", applied: "", dropped: "n" };

const PAGE_SIZE = 15;

type SortKey = "date" | "company" | "status" | "channel" | "location" | "salary" | "conclusion";
const SORTS: Record<SortKey, (j: Job) => string> = {
  date: (j) => j.updatedAt || "",
  company: (j) => `${j.company} ${j.role}`.toLowerCase(),
  status: (j) => j.status,
  channel: (j) => j.channel.toLowerCase(),
  location: (j) => `${j.location} ${j.remote}`.toLowerCase(),
  salary: (j) => j.salaryPosted || "",
  conclusion: (j) => j.conclusion,
};
const COLUMNS: [SortKey, string][] = [
  ["date", "Date"],
  ["company", "Company / role"],
  ["status", "Status"],
  ["channel", "Channel"],
  ["location", "Location"],
  ["salary", "Salary posted"],
  ["conclusion", "Conclusion"],
];

export default function JobsView({ jobs, jobsSource, focusId, apps }: { jobs: Job[]; jobsSource?: string; focusId?: string | null; apps?: { id: string; jobId: string; stage: string; appliedAt?: string | null }[] }) {
  const [status, setStatus] = useState<JobStatus | "all">("all");
  const [kw, setKw] = useState("");
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<1 | -1>(-1); // date desc = newest first
  const [drawerJob, setDrawerJob] = useState<Job | null>(null);
  // FR-26: 岗位合页 - 按 jobId 关联申请记录
  const appByJobId = new Map((apps ?? []).map((a) => [a.jobId, a]));
  const list = useMemo(() => {
    const base = searchJobs(filterJobs(jobs, status), kw);
    const get = SORTS[sortKey];
    return [...base].sort((a, b) => sortDir * get(a).localeCompare(get(b)));
  }, [jobs, status, kw, sortKey, sortDir]);
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = useMemo(
    () => list.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [list, safePage]
  );
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(k);
      setSortDir(k === "date" ? -1 : 1);
    }
    setPage(1);
  };

  useEffect(() => {
    if (focusId) {
      setStatus("all");
      setKw("");
      // B-2: focusId 变化时，算出目标岗位在第几页并跳转，否则 scrollIntoView 找不到元素。
      const idx = list.findIndex((j) => j.id === focusId);
      if (idx >= 0) {
        const targetPage = Math.floor(idx / PAGE_SIZE) + 1;
        setPage(targetPage);
      }
    }
  }, [focusId, list]);

  // Reset to first page when filter/search changes
  useEffect(() => {
    setPage(1);
  }, [status, kw]);

  useEffect(() => {
    if (focusId) {
      const el = rowRefs.current.get(focusId);
      if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [focusId, pageItems]);

  return (
    <div className="content">
      {(jobsSource === "corrupt" || jobsSource === "missing") && (
        <div style={{ background: "#fde8e8", border: "1px solid #e5484d", color: "#8b1a1a", borderRadius: 8, padding: "10px 12px", marginBottom: 12 }}>
          ⚠️ jobs.json {jobsSource === "corrupt" ? "解析失败" : "缺失"}：此处显示为空不是没有职位，是文件读不进来。请先修复 jobs.json 再继续记账。
        </div>
      )}
      <div className="head">
        <div className="hicon">
          <Briefcase size={24} strokeWidth={1.6} />
        </div>
        <div>
          <div className="t">
            <h1>Jobs</h1>
          </div>
          <p>职位库 · Muse 从 triage / review 半自动导入，只读</p>
        </div>
      </div>
      <div className="panel">
        <div className="ph mono">
          All jobs · {jobs.length} · {list.length} shown · page {safePage}/{totalPages}
          <span className="r">
            <span className="chips">
              {FILTERS.map((f) => (
                <button key={f} className={status === f ? "on" : ""} onClick={() => setStatus(f)}>
                  {LABELS[f]}
                </button>
              ))}
            </span>
            <input
              className="srch"
              placeholder="Search company / role…"
              value={kw}
              onChange={(e) => setKw(e.target.value)}
            />
          </span>
        </div>
        <div className="inner">
          <div className="tr jobs th mono">
            {COLUMNS.map(([k, label]) => (
              <span key={k}>
                <button className="sort" onClick={() => toggleSort(k)} title={`按${label}排序`}>
                  {label}
                  {sortKey === k && <span className="arr">{sortDir === 1 ? "↑" : "↓"}</span>}
                </button>
              </span>
            ))}
          </div>
          {pageItems.map((j) => (
            <div
              className={`tr jobs${focusId === j.id ? " hl" : ""}`}
              key={j.id}
              ref={(el) => {
                if (el) rowRefs.current.set(j.id, el);
                else rowRefs.current.delete(j.id);
              }}
            >
              <span className="mono d">{j.updatedAt ? j.updatedAt.slice(5, 10) : "-"}</span>
              <span className="co">
                <button className="jlink" onClick={() => setDrawerJob(j)} title="查看职位详情">
                  <b>{j.company}</b>
                  <small>{j.role}</small>
                </button>
                {/* FR-26: 岗位合页 - 同行显示投递状态 */}
                {(() => {
                  const app = appByJobId.get(j.id);
                  if (!app) return null;
                  return (
                    <small style={{ display: "block", marginTop: 2 }}>
                      <span className="pill" style={{ fontSize: 11 }}>
                        <i className={`dot ${app.stage === "applied" ? "" : app.stage === "rejected" || app.stage === "ghosted" ? "n" : "w"}`} />
                        投递: {app.stage}
                      </span>
                    </small>
                  );
                })()}
              </span>
              <span>
                <span className="pill">
                  <i className={`dot ${DOT[j.status]}`} />
                  {j.status}
                </span>
              </span>
              <span>{j.channel}</span>
              <span>
                {j.location}
                <small style={{ display: "block", color: "var(--mut)" }}>{j.remote}</small>
              </span>
              <span className="mono">{j.salaryPosted || "-"}</span>
              <span>
                <span className="pill">
                  <i className={`dot ${j.conclusion === "apply" ? "" : j.conclusion === "drop" ? "n" : "w"}`} />
                  {j.conclusion}
                </span>
              </span>
            </div>
          ))}
          {!pageItems.length && <div className="empty">No jobs match.</div>}
          {totalPages > 1 && (
            <div className="pager mono">
              <button disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
                ← Prev
              </button>
              <span>
                {safePage} / {totalPages}
              </span>
              <button disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>
                Next →
              </button>
            </div>
          )}
        </div>
      </div>
      <JobDrawer
        job={drawerJob}
        onClose={() => setDrawerJob(null)}
        application={drawerJob ? appByJobId.get(drawerJob.id) ?? null : null}
      />
    </div>
  );
}
