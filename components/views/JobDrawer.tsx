"use client";

import { X } from "lucide-react";
import type { Job } from "../../lib/jobs";

export default function JobDrawer({ job, onClose, application }: {
  job: Job | null;
  onClose: () => void;
  // FR-26: 岗位合页 - 传入关联的申请记录
  application?: { id: string; stage: string; appliedAt?: string | null } | null;
}) {
  if (!job) return null;
  return (
    <>
      <div className="drawer-mask" onClick={onClose} />
      <aside className="drawer">
        <div className="dhead">
          <div>
            <h2>{job.company}</h2>
            <p>{job.role}</p>
          </div>
          <button className="dx" onClick={onClose} title="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="dbody">
          <div className="dsec">
            <h3>基本信息</h3>
            <div className="dgrid">
              <span>状态</span><b>{job.status}</b>
              <span>结论</span><b>{job.conclusion}</b>
              <span>渠道</span><b>{job.channel}</b>
              <span>地点</span><b>{job.location} · {job.remote}</b>
              <span>日期</span><b className="mono">{job.updatedAt ? job.updatedAt.slice(0, 10) : "-"}</b>
              <span>公布薪资</span><b className="mono">{job.salaryPosted || "-"}</b>
              <span>应答薪资</span><b className="mono">{job.salaryAnswer ? `$${job.salaryAnswer.toLocaleString()}` : "-"}</b>
              <span>职位 ID</span><b className="mono d-id">{job.id}</b>
              {job.url ? (
                <>
                  <span>原帖链接</span>
                  <b><a href={job.url} target="_blank" rel="noopener noreferrer">查看原帖 ↗</a></b>
                </>
              ) : (
                <>
                  <span>原帖链接</span>
                  <b style={{ color: "#888" }}>暂无原帖链接（Discovery 时未抓取）</b>
                </>
              )}
            </div>
          </div>
          {!!job.matchPoints.length && (
            <div className="dsec">
              <h3>匹配点 ({job.matchPoints.length})</h3>
              <ul className="dlist ok">
                {job.matchPoints.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}
          {!!job.redFlags.length && (
            <div className="dsec">
              <h3>风险点 ({job.redFlags.length})</h3>
              <ul className="dlist warn">
                {job.redFlags.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          {!job.matchPoints.length && !job.redFlags.length && (
            <div className="dsec">
              <p className="dmut">暂无匹配点 / 风险点记录</p>
            </div>
          )}
          {job.description ? (
            <div className="dsec">
              <h3>职位描述</h3>
              <div className="ddesc">{job.description}</div>
            </div>
          ) : (
            <div className="dsec">
              <p className="dmut">暂无职位描述（Discovery 时未抓取）</p>
            </div>
          )}
          {/* FR-26: 岗位合页 - 投递状态 */}
          <div className="dsec">
            <h3>投递状态</h3>
            {application ? (
              <div className="dgrid">
                <span>申请 ID</span><b className="mono">{application.id}</b>
                <span>阶段</span><b>{application.stage}</b>
                <span>投递时间</span><b className="mono">{application.appliedAt ? application.appliedAt.slice(0, 16).replace("T", " ") : "-"}</b>
              </div>
            ) : (
              <p className="dmut">尚未投递</p>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
