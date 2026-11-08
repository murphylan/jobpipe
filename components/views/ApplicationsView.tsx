"use client";

import { useMemo, useState } from "react";
import { Send } from "lucide-react";
import type { Application } from "../../lib/datafiles";
import { TERMINAL_APPLICATION_STAGES as TERMINAL_STAGES } from "../../lib/task-state";
import type { Job } from "../../lib/jobs";

type F = "all" | "replied" | "interview" | "waiting";
const FILTERS: [F, string][] = [
  ["all", "All"],
  ["replied", "Replied"],
  ["interview", "Interview"],
  ["waiting", "Waiting"],
];
const DOT = (stage: string) =>
  stage === "interview" || stage === "offer" ? "k" : stage === "replied" || stage === "screen" ? "w" : stage === "applied" ? "" : "n";

export default function ApplicationsView({
  apps,
  jobs,
  onJobClick,
}: {
  apps: Application[];
  jobs: Job[];
  onJobClick?: (jobId: string) => void;
}) {
  const [f, setF] = useState<F>("all");
  const names = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);
  const list = useMemo(
    () =>
      apps
        .filter((a) => {
          if (f === "all") return true;
          if (f === "replied") return a.stage === "replied" || a.stage === "screen" || a.stage === "rejected_after_contact";
          if (f === "interview") return a.stage === "interview" || a.stage === "offer";
          return a.stage === "applied";
        })
        .sort((a, b) => (b.appliedAt || "").localeCompare(a.appliedAt || "")),
    [apps, f],
  );

  return (
    <div className="content">
      <div className="head">
        <div className="hicon">
          <Send size={24} strokeWidth={1.6} />
        </div>
        <div>
          <div className="t">
            <h1>Applications</h1>
          </div>
          <p>投递跟踪 · 以 applications.json 为准；以雇主确认页/确认邮件为准才算 confirmed</p>
        </div>
      </div>
      <div className="panel">
        <div className="ph mono">
          All applications · {apps.length}
          <span className="r chips">
            {FILTERS.map(([k, l]) => (
              <button key={k} className={f === k ? "on" : ""} onClick={() => setF(k)}>
                {l}
              </button>
            ))}
          </span>
        </div>
        <div className="inner">
          <div className="tr apps th mono">
            <span>Date</span>
            <span>Company / role</span>
            <span>Resume</span>
            <span>Stage</span>
            <span>Ledger</span>
            <span>Next action</span>
            <span>Interview</span>
          </div>
          {list.map((a) => {
            const j = names.get(a.jobId);
            const terminal = (TERMINAL_STAGES as string[]).includes(a.stage);
            return (
              <div className="tr apps" key={a.id}>
                <span className="mono d">{(a.appliedAt || a.collectedAt).slice(0, 10).slice(5)}</span>
                <span className="co">
                  {j && onJobClick ? (
                    <button className="jlink" onClick={() => onJobClick(j.id)} title="在 Jobs 中查看该职位">
                      <b>{j.company}</b>
                      <small>{j.role}</small>
                    </button>
                  ) : (
                    <>
                      <b>{j?.company || a.jobId}</b>
                      <small>{j?.role || ""}</small>
                    </>
                  )}
                  <small style={{ color: "#888" }}>{a.source}</small>
                </span>
                <span className="ver">{a.resumeVersion || "-"}</span>
                <span>
                  <span className="pill">
                    <i className={`dot ${DOT(a.stage)}`} />
                    {a.stage.replaceAll("_", " ")}
                  </span>
                  {a.employerConfirmed && <span className="sel" title="雇主已确认">✓</span>}
                </span>
                <span className="mono" title={a.ledgerRowId || "未关联"}>
                  {a.ledgerRowId ? <span className="sel">已关联</span> : <span style={{ color: "#888" }}>未关联</span>}
                </span>
                <span>{terminal ? "-" : (a.nextAction || "-")}{!terminal && a.nextActionDue ? <small className="mono"> · {a.nextActionDue.slice(5)}</small> : null}</span>
                <span className="mono">{a.interviewAt ? a.interviewAt.slice(0, 10) : "-"}</span>
              </div>
            );
          })}
          {!list.length && <div className="empty">No applications match.</div>}
        </div>
      </div>
    </div>
  );
}
