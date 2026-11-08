"use client";

import { useState } from "react";
import { pendingTasks, BUSINESS_STAGE_LABELS, type BusinessTask } from "../lib/task-state";
import { statusLabel, relativeTime } from "../lib/activity-display";

// 今日待投递列表：投递流水线
// 口径（2026-11-07 用户定版）：未投递任务（含往日遗留）常驻；已投递任务只在投递
// 当日（Chicago 日期）显示，非当日已投递下线到 Jobs 页，不占 20 个坑位。
// 环节：发现 → 筛选 → 定制简历 → 投递（仅展示投递前的状态）
type TaskStage = "discovery" | "screening" | "tailoring" | "apply" | "review" | "confirmed" | "rejected" | "unstarted";

const TASK_STAGES: { key: TaskStage; label: string; color: string }[] = [
  { key: "discovery", label: "发现", color: "#dbe7f3" },
  { key: "screening", label: "筛选", color: "#e0e7ff" },
  { key: "tailoring", label: "定制简历", color: "#fef3c7" },
  { key: "apply", label: "投递", color: "#d1fae5" },
  { key: "review", label: "复查", color: "#fed7aa" },
  { key: "confirmed", label: "已确认", color: "#1a7f37" },
];
// 已拒绝共用终态位置，红色
const REJECTED_COLOR = "#dc2626";
// 列宽（2026-11-08 用户定版）：自适应比例列 + 最小宽度下限。公司/职位不再独占大头，
// 释放的宽度给环节进度与渠道；回复·面试内容短，收窄。表头与行共用同一模板。
const TASK_GRID_COLUMNS = "28px 32px minmax(190px, 1.7fr) minmax(200px, 1.5fr) minmax(120px, 0.85fr) minmax(140px, 0.95fr) minmax(76px, 0.5fr)";

type TaskRow = {
  index: number;
  stage: TaskStage;
  company?: string;
  role?: string;
  channel?: string;
  resumeVersion?: string;
  replyStage?: string;
  jobId?: string;
  needsGmailCheck?: boolean;
  lastAt?: string;
};

type LedgerRow = {
  id: string;
  company: string;
  role: string;
  date_submitted: string;
  submission_status: string;
  stage: string;
  channel: string;
  resume_version: string;
};
type JobRow = { id: string; company: string; role: string; status: string; channel: string };
type AppRow = { id: string; jobId: string; stage: string; appliedAt: string | null; employerConfirmed: boolean; resumeVersion: string };

// 回复·面试列统一中文术语
// 已投递（等回执）→ 已确认（客户发来确认信）/ 已拒绝；准备面试 → 完成面试
function displayReplyStage(r: TaskRow): string {
  if (r.stage === "confirmed") return "已确认";
  if (r.stage === "rejected") return "已拒绝";
  if (r.stage === "unstarted") return "-";
  if (r.needsGmailCheck) return "已投递";
  if (!r.replyStage) return "-";
  const s = r.replyStage.toLowerCase();
  if (s.includes("reject")) return "已拒绝";
  if (s.includes("interview") && (s.includes("schedul") || s.includes("prepar"))) return "准备面试";
  if (s.includes("interview") && (s.includes("complet") || s.includes("done"))) return "完成面试";
  if (s.includes("interview")) return "面试中";
  if (s.includes("offer")) return "已发 Offer";
  if (s === "applied") return "已投递";
  return r.replyStage;
}

export default function TaskList({ plan, tasks, today, nowMs, onJobClick }: {
  plan: number; tasks: BusinessTask[]; today?: string; nowMs: number; onJobClick?: (jobId: string) => void;
}) {
  const byJob = new Map(tasks.map((t) => [t.jobId, t]));
  const rows: TaskRow[] = pendingTasks(tasks, plan, today).map((task, index) => ({
    index, stage: task.businessStage as TaskStage, company: task.company, role: task.role,
    channel: task.channel, resumeVersion: task.resumeVersion, jobId: task.jobId,
    lastAt: task.runtime.updatedAt ?? task.appliedAt ?? undefined,
  }));
  // The parent supplies the serialized snapshot/poll time so SSR and hydration share one clock.
  // 2026-11-05: 空位不再补齐显示——表格只显示有记录的行，无记录不占位。
  // 今日任务只含未投递项，复查过滤已无意义（无已投递项可过滤）
  const visible = rows;
  const pendingCount = rows.filter((r) => r.stage !== "unstarted").length;
  // 环节进度表头的帮助 popover：展示完整 6 阶段
  const [stageHelpOpen, setStageHelpOpen] = useState(false);
  // 批量投递指令生成器：复选框选择 → 一键生成给 Muse 的指令
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [instrOpen, setInstrOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const selectable = visible.filter((r) => r.jobId && r.stage !== "unstarted");
  const toggleSelect = (jobId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  };
  const toggleAll = () => {
    if (selected.size === selectable.length) setSelected(new Set());
    else setSelected(new Set(selectable.map((r) => r.jobId!)));
  };
  // 按当前状态分组，每组给对应的下一步指令
  const STAGE_NEXT_ACTION: Record<string, string> = {
    discovery: "请筛选以下新发现的职位，判断是否值得投递",
    screening: "请完成以下职位的筛选决策（批准进入定制简历，或丢弃）",
    tailoring: "请为以下职位定制简历，投递前仍需用户批准",
    review: "请复查以下职位的回执或处理跟进事项",
    apply: "请投递以下职位",
  };
  const buildInstruction = () => {
    const items = selectable.filter((r) => selected.has(r.jobId!));
    const groups = new Map<string, typeof items>();
    for (const r of items) {
      const key = r.stage;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }
    const stageOrder = ["discovery", "screening", "tailoring", "apply", "review"];
    const lines: string[] = [];
    for (const stage of stageOrder) {
      const group = groups.get(stage);
      if (!group || !group.length) continue;
      const stageLabel = TASK_STAGES.find((s) => s.key === stage)?.label || stage;
      lines.push(`【${stageLabel} → 下一环节】${STAGE_NEXT_ACTION[stage]}：`);
      lines.push("");
      group.forEach((r, i) => {
        lines.push(`${i + 1}. ${r.company} - ${r.role}`);
        lines.push(`   jobId: ${r.jobId} | 渠道: ${r.channel || "-"} | 简历: ${r.resumeVersion || "-"}`);
      });
      lines.push("");
    }
    return lines.join("\n").trim();
  };
  const copyInstruction = async () => {
    try {
      await navigator.clipboard.writeText(buildInstruction());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard API 不可用时静默 */ }
  };

  return (
    <section id="today-tasks" style={{ marginBottom: 12, background: "#fff", borderRadius: 12, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: "1px solid #eef3f9", background: "#fff" }}>
        <span style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 11, letterSpacing: "0.08em", color: "#64748b", fontWeight: 500 }}>今日待处理</span>
          <span className="mono" style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", lineHeight: 1 }}>{pendingCount} <span style={{ fontSize: 13, fontWeight: 400, color: "#94a3b8" }}>/ {plan}</span></span>
        </span>
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {selected.size > 0 && <span style={{ fontSize: 12, color: "#64748b" }}>已选 {selected.size} 项</span>}
          <button
            onClick={() => setInstrOpen(true)}
            disabled={selected.size === 0}
            style={{ fontSize: 13, fontWeight: 600, padding: "6px 14px", border: "none", borderRadius: 8, background: selected.size === 0 ? "#f1f5f9" : "#2563eb", color: selected.size === 0 ? "#64748b" : "#fff", cursor: selected.size === 0 ? "default" : "pointer" }}
          >
            生成投递指令 →
          </button>
        </span>
      </div>
      <div className="inner" style={{ padding: 0 }}>
        <div className="tr th mono" style={{ gridTemplateColumns: TASK_GRID_COLUMNS, columnGap: 12 }}>
          <span style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
            <input
              type="checkbox"
              checked={selectable.length > 0 && selected.size === selectable.length}
              ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < selectable.length; }}
              onChange={toggleAll}
              title={selected.size === selectable.length && selectable.length > 0 ? "清空" : "全选"}
              style={{ width: 15, height: 15, cursor: "pointer", accentColor: "#2563eb" }}
            />
          </span>
          <span>#</span>
          <span>公司 / 职位</span>
          <span style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 4 }}>
            环节进度
            <button
              onClick={(e) => { e.stopPropagation(); setStageHelpOpen(!stageHelpOpen); }}
              title="查看完整 6 个阶段"
              style={{ background: "none", border: "1px solid #cbd5e1", borderRadius: "50%", width: 16, height: 16, fontSize: 10, color: "#64748b", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0, lineHeight: 1 }}
            >?</button>
            {stageHelpOpen && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{ position: "absolute", top: "100%", right: 0, marginTop: 6, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", padding: "12px 14px", zIndex: 50, minWidth: 280 }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: "#0f172a", marginBottom: 8 }}>完整 6 个阶段</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {TASK_STAGES.map((s, i) => (
                    <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                      <span style={{ width: 18, height: 18, borderRadius: "50%", background: s.color, border: "1px solid #cbd5e1", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#475569", flexShrink: 0 }}>{i + 1}</span>
                      <span style={{ fontWeight: 600, color: "#0f172a" }}>{s.label}</span>
                      <span style={{ color: "#64748b" }}>
                        {s.key === "discovery" && "发现候选职位"}
                        {s.key === "screening" && "筛选 shortlist"}
                        {s.key === "tailoring" && "定制简历"}
                        {s.key === "apply" && "投递（Muse sessions）"}
                        {s.key === "review" && "复查：查邮件回执，可多次"}
                        {s.key === "confirmed" && "已确认：客户发来确认信"}
                      </span>
                    </div>
                  ))}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                    <span style={{ width: 18, height: 18, borderRadius: "50%", background: REJECTED_COLOR, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#fff", flexShrink: 0 }}>×</span>
                    <span style={{ fontWeight: 600, color: "#dc2626" }}>已拒绝</span>
                    <span style={{ color: "#64748b" }}>终态（任何阶段都可能）</span>
                  </div>
                </div>
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #f1f5f9", fontSize: 11, color: "#94a3b8" }}>今日任务仅展示投递前的阶段（1–4）</div>
              </div>
            )}
          </span>
          <span>渠道</span>
          <span>简历</span>
          <span>回复·面试</span>
        </div>
        {visible.map((r) => (
          <div
            className="tr"
            key={r.index}
            onClick={() => r.jobId && onJobClick?.(r.jobId)}
            style={{
              gridTemplateColumns: TASK_GRID_COLUMNS,
              columnGap: 12,
              background: r.stage === "unstarted" ? "#f8fafc" : undefined,
              opacity: r.stage === "unstarted" ? 0.6 : 1,
              cursor: r.jobId ? "pointer" : "default",
            }}
            title={r.company && r.role ? `${r.company} - ${r.role}（点击查看详情）` : undefined}
          >
            <span onClick={(e) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              {r.jobId && r.stage !== "unstarted" ? (
                <input
                  type="checkbox"
                  checked={selected.has(r.jobId)}
                  onChange={() => toggleSelect(r.jobId!)}
                  style={{ width: 15, height: 15, cursor: "pointer", accentColor: "#2563eb" }}
                />
              ) : null}
            </span>
            <span className="mono">{r.index + 1}</span>
            <span className="co" style={{ minWidth: 0, overflow: "hidden" }}>
              {r.company ? (
                <span style={{ display: "block", minWidth: 0 }}>
                  <span style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
                    <b style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "#2563eb", fontSize: 14 }} title={r.company}>{r.company}</b>
                  </span>
                  <small style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "#64748b", fontSize: 12 }} title={r.role || ""}>{r.role}</small>
                </span>
              ) : (
                <span style={{ color: "#999" }}>—</span>
              )}
            </span>
            <span>
              {r.stage === "unstarted" ? (
                <span style={{ color: "#999", fontSize: 13 }}>未开始</span>
              ) : (() => {
                // 已拒绝共用终态位置（第6格），显示红色
                const effectiveStage = r.stage === "rejected" ? "confirmed" : r.stage;
                const activeIdx = TASK_STAGES.findIndex((x) => x.key === effectiveStage);
                const stageLabel = r.jobId ? BUSINESS_STAGE_LABELS[byJob.get(r.jobId)!.businessStage] : r.stage;
                const labelColor = r.stage === "rejected" ? "#dc2626" : r.needsGmailCheck ? "#c2410c" : "#666";
                return (
                  <div style={{ position: "relative", paddingTop: 16 }}>
                    {(() => {
                      const task = r.jobId ? byJob.get(r.jobId) : undefined;
                      const lv = task?.runtime;
                      if (!lv || lv.status === "idle") return null;
                      const isWaiting = lv.status === "waiting";
                      return (
                        <div style={{ position: "absolute", top: 0, left: 0, right: 0, textAlign: "center" }}>
                          <small
                            title={lv.detail}
                            style={{
                              whiteSpace: "nowrap",
                              fontSize: 10,
                              color: isWaiting ? "#92400e" : "#1d4ed8",
                              background: isWaiting ? "#fef3c7" : "#eff6ff",
                              borderRadius: 10,
                              padding: "2px 8px",
                              letterSpacing: "0.02em",
                            }}
                          >
                            本次运行：{statusLabel(lv.status)}
                          </small>
                        </div>
                      );
                    })()}
                    <div style={{ display: "flex", gap: 2, marginBottom: 2 }}>
                      {TASK_STAGES.map((s) => {
                        const thisIdx = TASK_STAGES.findIndex((x) => x.key === s.key);
                        const done = thisIdx < activeIdx;
                        const current = thisIdx === activeIdx;
                        const isRejectedTerminal = r.stage === "rejected" && current;
                        return (
                          <div
                            key={s.key}
                            title={isRejectedTerminal ? "已拒绝" : s.label}
                            style={{
                              flex: 1,
                              height: 6,
                              borderRadius: 3,
                              background: done || current ? (isRejectedTerminal ? REJECTED_COLOR : s.color) : "#e5e7eb",
                              border: current ? "1px solid #333" : "none",
                              opacity: done ? 0.9 : 1,
                            }}
                          />
                        );
                      })}
                    </div>
                    {/* 阶段文字居中对齐到当前段下方 */}
                    <div style={{ position: "relative", height: 18 }}>
                      <small
                        style={{
                          position: "absolute",
                          left: `${(activeIdx / TASK_STAGES.length) * 100}%`,
                          width: `${100 / TASK_STAGES.length}%`,
                          textAlign: "center",
                          fontSize: 12,
                          color: labelColor,
                          whiteSpace: "nowrap",
                          overflow: "visible",
                        }}
                      >
                        {stageLabel}
                        {r.needsGmailCheck && " ⚠️"}
                      </small>
                    </div>
                  </div>
                );
              })()}
            </span>
            <span>
              <span style={{ display: "block", fontSize: 13 }}>{r.channel || "-"}</span>
              <small style={{ display: "block", color: "#94a3b8", fontSize: 11, marginTop: 1 }}>{r.lastAt ? relativeTime(r.lastAt, nowMs) : "-"}</small>
            </span>
            <span className="mono" style={{ fontSize: 12 }}>{r.resumeVersion || "-"}</span>
            <span style={{ fontSize: 13 }}>{displayReplyStage(r)}</span>
          </div>
        ))}
        {!visible.length && (
          <div className="empty">
            {"No tasks."}
          </div>
        )}
      </div>
      {/* 批量投递指令 Modal */}
      {instrOpen && (
        <div
          onClick={() => setInstrOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "#fff", borderRadius: 10, maxWidth: 560, width: "100%", maxHeight: "80vh", display: "flex", flexDirection: "column", overflow: "hidden" }}
          >
            <div style={{ padding: "14px 18px", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <b style={{ fontSize: 14 }}>投递指令 · 已选 {selected.size} 项</b>
              <button onClick={() => setInstrOpen(false)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#64748b" }}>×</button>
            </div>
            <pre style={{ margin: 0, padding: "16px 18px", fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word", overflowY: "auto", flex: 1, background: "#f8fafc", fontFamily: "inherit" }}>
              {buildInstruction()}
            </pre>
            <div style={{ padding: "12px 18px", borderTop: "1px solid #e2e8f0", display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setInstrOpen(false)} style={{ padding: "8px 16px", border: "1px solid #e2e8f0", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 13 }}>关闭</button>
              <button onClick={copyInstruction} style={{ padding: "8px 20px", border: "none", borderRadius: 6, background: "#2563eb", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                {copied ? "已复制 ✓" : "复制指令"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
