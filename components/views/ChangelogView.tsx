"use client";

import { useMemo, useState } from "react";
import { ScrollText } from "lucide-react";
import type { ChangelogFile } from "../../lib/datafiles";

const PAGE_SIZE = 20;

type ChangelogEntry = NonNullable<ChangelogFile["entries"]>[number];
type JobLite = { id: string; company: string; role: string };

// 操作列人话化（2026-11-08 用户定版）：引擎生成的备注是机器格式
//（taskId + 英文动词 + jobId），页面展示时翻译成中文句子，并把 jobId 换成
// 「公司 — 职位」；早期人工写的中文备注原样显示。原始备注保留在 title 里备查。
const ACTION_LABELS: Record<string, { label: string; bg: string; fg: string }> = {
  discovered: { label: "发现岗位", bg: "#e0e7ff", fg: "#3730a3" },
  screened: { label: "筛选", bg: "#e0e7ff", fg: "#3730a3" },
  tailored: { label: "定制简历", bg: "#fef3c7", fg: "#92400e" },
  "application-submitted": { label: "提交投递", bg: "#d1fae5", fg: "#065f46" },
  "followup-received": { label: "收到回复", bg: "#d1fae5", fg: "#065f46" },
  "user-decided": { label: "用户决定", bg: "#ffedd5", fg: "#9a3412" },
  "agent-activity": { label: "执行动态", bg: "#f1f5f9", fg: "#475569" },
  "agent-waiting": { label: "等待提问", bg: "#fef3c7", fg: "#92400e" },
  "waiting-answered": { label: "等待已答复", bg: "#f1f5f9", fg: "#475569" },
  "waiting-parked": { label: "等待已暂放", bg: "#f1f5f9", fg: "#475569" },
  "profile-changed": { label: "资料变更", bg: "#ede9fe", fg: "#5b21b6" },
  "knowledge-changed": { label: "知识更新", bg: "#ede9fe", fg: "#5b21b6" },
  "activity-deleted": { label: "删除记录", bg: "#fee2e2", fg: "#991b1b" },
  "history-deleted": { label: "删除记录", bg: "#fee2e2", fg: "#991b1b" },
};

const SCREEN_OUTCOME: Record<string, string> = { apply: "决定投递", drop: "放弃", pending: "待定" };
const DECISION_TEXT: Record<string, string> = { drop: "放弃", apply: "投递", hold: "暂缓" };
const RUN_STATUS: Record<string, string> = { running: "进行中", done: "已完成", failed: "失败", waiting: "等待用户" };

export function humanNote(e: ChangelogEntry, jobLabel: (id: string) => string): string {
  const note = (e.note || "").trim();
  if (!note) return ACTION_LABELS[e.action]?.label ?? e.action ?? "";
  // 人工中文备注（早期记录）本身可读，原样显示
  if (/[^\x00-\x7F]/.test(note) && e.action !== "history-deleted") return note;
  const t = note.split(/\s+/);
  switch (e.action) {
    case "discovered":
      if (t[1] === "discovered" && t[2]) return `发现新岗位：${jobLabel(t[2])}`;
      break;
    case "screened":
      if (t[1] === "screened" && t[2]) return `完成筛选：${jobLabel(t[2])}，结论 ${SCREEN_OUTCOME[t[4]] ?? t[4] ?? ""}`.trim();
      break;
    case "tailored":
      if (t[1] === "tailored" && t[2]) return `为 ${jobLabel(t[2])} 定制简历${t[4] ? `（${t[4]}）` : ""}`;
      break;
    case "application-submitted": {
      if (t[1]) {
        const m = note.match(/ledger\s+(\d+)/);
        return `提交投递：${jobLabel(t[1])}${m ? `（台账第 ${m[1]} 行）` : ""}`;
      }
      break;
    }
    case "user-decided":
      if (t[1] === "decided" && t[2]) return `用户决定：${DECISION_TEXT[t[4]] ?? t[4] ?? ""} ${jobLabel(t[2])}`.trim();
      break;
    case "agent-activity":
      if (t[2]) return `一次执行运行的状态更新：${RUN_STATUS[t[2]] ?? t[2]}`;
      break;
    case "agent-waiting":
      return "执行方提出问题，等待用户答复";
    case "waiting-answered":
      return "用户已答复执行方的问题";
    case "waiting-parked":
      return "问题已暂放（未答复）";
    case "profile-changed": {
      const i = note.indexOf("fields:");
      if (i >= 0) return `更新个人资料字段：${note.slice(i + 7).trim()}`;
      return "更新个人资料";
    }
    case "activity-deleted":
      return "删除了一条运行记录";
    case "history-deleted":
      return "按用户授权删除了部分历史记录";
  }
  return note;
}

export default function ChangelogView({ changelog, jobs }: { changelog: ChangelogFile; jobs?: JobLite[] }) {
  const [page, setPage] = useState(1);
  const [kw, setKw] = useState("");

  const jobMap = useMemo(() => new Map((jobs || []).map((j) => [j.id, j])), [jobs]);
  const jobLabel = (id: string) => {
    const j = jobMap.get(id);
    return j ? `${j.company} — ${j.role}` : id;
  };

  const filtered = useMemo(() => {
    const entries = [...(changelog.entries || [])].reverse();
    if (!kw.trim()) return entries;
    const q = kw.trim().toLowerCase();
    return entries.filter((e) =>
      (e.note || "").toLowerCase().includes(q) ||
      humanNote(e, jobLabel).toLowerCase().includes(q) ||
      (e.action || "").toLowerCase().includes(q) ||
      (e.target || "").toLowerCase().includes(q)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changelog, kw, jobMap]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="content">
      <div className="head">
        <div className="hicon"><ScrollText size={24} strokeWidth={1.6} /></div>
        <div><div className="t"><h1>Changelog</h1></div><p>数据操作审计 · 数据的黑匣子记录仪</p></div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <div style={{ position: "relative", flex: "1 1 220px", minWidth: 180 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2" strokeLinecap="round" style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
            <circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" />
          </svg>
          <input value={kw} onChange={(e) => { setKw(e.target.value); setPage(1); }} placeholder="搜索操作 / 备注…" style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px 9px 34px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 13, outline: "none", background: "#f8fafc" }} />
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#475569", background: "#f1f5f9", padding: "5px 12px", borderRadius: 999 }}>{filtered.length} 条</span>
      </div>

      <style>{`.jobs-table .tr-body:hover { background: #e8f1fb; }`}</style>
      <div className="jobs-table" style={{ marginBottom: 12, overflowX: "auto", background: "#fff", border: "1px solid #dbe7f3", borderRadius: 12 }}>
        <div className="inner" style={{ padding: 0 }}>
          <div className="tr th mono" style={{ display: "grid", gridTemplateColumns: "150px 1fr 120px", columnGap: 12, padding: "10px 12px", fontSize: 13, color: "#666", fontWeight: 400, borderBottom: "2px solid #dbe7f3", background: "#fff" }}>
            <span>时间</span><span>操作</span><span>版本</span>
          </div>
          {pageItems.map((e, i) => {
            const meta = ACTION_LABELS[e.action];
            return (
              <div key={`${e.at}-${i}`} className="tr tr-body" style={{ display: "grid", gridTemplateColumns: "150px 1fr 120px", columnGap: 12, padding: "10px 12px", borderBottom: "1px solid #eef3f9", fontSize: 14 }}>
                <span className="mono" style={{ fontSize: 12, color: "#94a3b8", whiteSpace: "nowrap" }}>{e.at.slice(0, 16).replace("T", " ")}</span>
                <span style={{ fontSize: 14, color: "#334155", display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  {meta && <span style={{ flexShrink: 0, fontSize: 11, background: meta.bg, color: meta.fg, borderRadius: 999, padding: "2px 8px" }}>{meta.label}</span>}
                  <span title={e.note || ""} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{humanNote(e, jobLabel)}</span>
                </span>
                <span className="mono" style={{ fontSize: 12, color: "#94a3b8" }}>v{e.version ?? "-"}</span>
              </div>
            );
          })}
          {!pageItems.length && <div className="empty" style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>暂无变更记录</div>}
        </div>
      </div>
      {totalPages > 1 && (
        <div className="pager mono" style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "center", padding: "4px 0 12px" }}>
          <button disabled={safePage <= 1} onClick={() => setPage(safePage - 1)} style={{ padding: "6px 12px", border: "1px solid #e2e8f0", borderRadius: 6, background: "#fff", cursor: safePage <= 1 ? "default" : "pointer" }}>← Prev</button>
          <span style={{ fontSize: 13 }}>{safePage} / {totalPages}</span>
          <button disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)} style={{ padding: "6px 12px", border: "1px solid #e2e8f0", borderRadius: 6, background: "#fff", cursor: safePage >= totalPages ? "default" : "pointer" }}>Next →</button>
        </div>
      )}
    </div>
  );
}
