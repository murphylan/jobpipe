"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import DetailDrawer from "./DetailDrawer";

import { buildReconciliationCleanupCommand, type ReconciliationIssue } from "../lib/reconciliation-command";
export type { ReconciliationIssue } from "../lib/reconciliation-command";

export default function ReconciliationNotice({ issues }: { issues: ReconciliationIssue[] }) {
  const [open, setOpen] = useState(false);
  const [command, setCommand] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopyStatus("已复制，请粘贴给 Muse。尚未执行清理。");
    } catch { setCopyStatus("复制失败，请在下方文本框中选择并手动复制。"); }
  };
  if (!issues.length) return null;
  const errors = issues.filter(issue => issue.severity === "red").length;
  return <>
    <button className={`reconciliation-notice${errors ? " has-errors" : ""}`} onClick={() => setOpen(true)} aria-haspopup="dialog">
      <AlertTriangle size={15} aria-hidden="true" />
      <span>数据核对：{issues.length} 项提醒{errors > 0 ? `（${errors} 项异常）` : ""}</span>
      <span className="reconciliation-notice-link">查看</span>
    </button>
    {open && <DetailDrawer title={`数据核对 · ${issues.length} 项提醒`} onClose={() => setOpen(false)}>
      <p style={{ color: "#64748b", fontSize: 13 }}>以下问题来自真实记录核对，不表示 Muse 正在运行。每 30 秒更新一次。</p>
      <div style={{ margin: "16px 0" }}>
        <button className="btn" onClick={() => {
          setCommand(buildReconciliationCleanupCommand(issues, new Date().toISOString()));
          setCopyStatus("");
        }}>生成清空命令</button>
        <p style={{ color: "#64748b", fontSize: 12 }}>生成给 Muse 的核查与清理指令，不直接删除数据。涉及删除时需确认具体范围。</p>
        {command && <>
          <textarea aria-label="给 Muse 的告警清理指令" readOnly value={command} rows={12} style={{ width: "100%", boxSizing: "border-box", padding: 10, fontSize: 12, lineHeight: 1.6 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}><button className="btn" onClick={() => void copyCommand()}>复制给 Muse</button><span role="status" style={{ fontSize: 12, color: "#64748b" }}>{copyStatus}</span></div>
        </>}
      </div>
      {issues.map((issue, index) => <section key={`${issue.type}:${index}`} style={{ borderBottom: "1px solid #e2e8f0", padding: "16px 0", overflowWrap: "anywhere" }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 14, color: issue.severity === "red" ? "#991b1b" : "#92400e" }}>{issue.title}</h3>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: "#475569", whiteSpace: "pre-wrap" }}>{issue.detail}</p>
      </section>)}
    </DetailDrawer>}
  </>;
}
