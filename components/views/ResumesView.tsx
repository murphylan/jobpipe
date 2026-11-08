"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import type { ResumeFileEntry, ResumeBlock, ResumeVersionsFile } from "../../lib/datafiles";
import { buildResumeDependencies, visibleResumeRows } from "../../lib/resume-tree";

const KIND_LABEL: Record<string, string> = { file: "PDF 文件", version: "引用版本", block: "提取构件", group: "待核查" };

export default function ResumesView({ files, blocks, versions, jobs }: {
  files: ResumeFileEntry[];
  blocks: ResumeBlock[];
  versions: ResumeVersionsFile;
  jobs: { id: string; company?: string; role?: string }[];
}) {
  const tree = useMemo(() => buildResumeDependencies(files, versions, blocks), [files, versions, blocks]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<string | null>(null);
  const names = useMemo(() => new Map(jobs.map(job => [job.id, job])), [jobs]);
  const rows = visibleResumeRows(tree, collapsed);
  const toggle = (id: string) => setCollapsed(previous => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const collapseAll = () => {
    const ids = new Set<string>();
    const visit = (nodes: typeof tree) => nodes.forEach(node => { if (node.children.length) ids.add(node.id); visit(node.children); });
    visit(tree);
    setCollapsed(ids);
  };
  return <div className="content">
    <div className="head">
      <div className="hicon"><FileText size={24} strokeWidth={1.6} /></div>
      <div><div className="t"><h1>Resumes</h1></div>
        <p>简历依赖关系 · {files.length} 份 PDF · {tree.reduce((count, node) => count + node.children.filter(child => child.kind === "version").length, 0)} 个版本 · {blocks.length} 个构件</p>
      </div>
    </div>
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
      <span style={{ flex: 1, color: "#64748b", fontSize: 13 }}>PDF 文件 → 引用版本 → 提取构件</span>
      <button className="btn" onClick={() => setCollapsed(new Set())}>全部展开</button>
      <button className="btn" onClick={collapseAll}>全部收起</button>
    </div>
    <div style={{ background: "#fff", border: "1px solid #dbe7f3", borderRadius: 12, overflowX: "auto" }}>
      <table style={{ width: "100%", minWidth: 860, borderCollapse: "collapse", textAlign: "left", fontSize: 13 }} aria-label="简历依赖关系">
        <thead><tr style={{ background: "#f8fafc", color: "#64748b" }}>
          {["简历 / 依赖项", "类型", "对应岗位", "引用 / 状态", "操作"].map(label => <th key={label} style={{ padding: "12px 16px", fontWeight: 500, borderBottom: "1px solid #e2e8f0" }}>{label}</th>)}
        </tr></thead>
        <tbody>
          {!rows.length && <tr><td colSpan={5} style={{ padding: 28, color: "#64748b", textAlign: "center" }}>暂无简历文件、版本或构件。</td></tr>}
          {rows.map(({ node, depth }) => {
            const job = node.jobId ? names.get(node.jobId) : undefined;
            return <tr key={node.id} style={{ borderBottom: "1px solid #eef3f9", background: depth === 0 ? "#fcfdff" : "#fff" }}>
              <td style={{ padding: "12px 16px", maxWidth: 420 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start", paddingLeft: depth * 24 }}>
                  {node.children.length ? <button aria-label={`${collapsed.has(node.id) ? "展开" : "收起"} ${node.label}`} aria-expanded={!collapsed.has(node.id)} onClick={() => toggle(node.id)} style={{ border: 0, background: "transparent", padding: 0, cursor: "pointer", color: "#64748b", flexShrink: 0 }}>
                    {collapsed.has(node.id) ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
                  </button> : <span style={{ width: 18, flexShrink: 0, color: "#94a3b8" }}>{depth ? "└" : ""}</span>}
                  <div style={{ minWidth: 0, overflowWrap: "anywhere" }}><div style={{ color: "#0f172a", fontWeight: depth === 0 ? 600 : 500 }}>{node.label}</div><div style={{ marginTop: 4, color: "#64748b", fontSize: 12 }}>{node.detail || "未记录说明"}</div></div>
                </div>
              </td>
              <td style={{ padding: "12px 16px", whiteSpace: "nowrap", color: "#64748b" }}>{KIND_LABEL[node.kind]}</td>
              <td style={{ padding: "12px 16px" }}>{node.jobId === "base" ? "基础简历" : job ? <>{job.company}<div style={{ color: "#64748b", fontSize: 12 }}>{job.role}</div></> : node.jobId || "—"}</td>
              <td style={{ padding: "12px 16px", color: "#475569" }}>
                {node.file ? <>{node.file.totalRefs} 次引用<div style={{ color: "#64748b", fontSize: 12 }}>版本 {node.file.recordRefs} · 投递 {node.file.applicationRefs} · 台账 {node.file.ledgerRefs}</div></> : node.selected ? "已选用" : "—"}
              </td>
              <td style={{ padding: "12px 16px", whiteSpace: "nowrap" }}>{node.fileName && <>
                <button className="btn" onClick={() => setPreview(node.fileName!)}>预览</button>{" "}
                <a href={`/api/resume-file?path=${encodeURIComponent(node.fileName)}&download=1`}>下载</a>
              </>}</td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
    <p style={{ color: "#64748b", fontSize: 12, marginTop: 12 }}>仅展示已记录的文件引用和构件来源；未记录基础版与定制版的派生关系时，不推测父版本。引用次数包含版本、投递及台账记录。</p>
    {preview && <div role="dialog" aria-modal="true" aria-label={`预览 ${preview}`} style={{ position: "fixed", inset: 0, background: "#0f172a66", zIndex: 100, display: "flex", justifyContent: "flex-end" }} onClick={() => setPreview(null)}>
      <div style={{ width: "min(850px, 94vw)", height: "100%", background: "white", display: "flex", flexDirection: "column" }} onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === "Escape") setPreview(null); }}>
        <div style={{ padding: 16, display: "flex", alignItems: "center", gap: 12 }}><strong style={{ flex: 1, overflowWrap: "anywhere" }}>{preview}</strong><button className="btn" autoFocus onClick={() => setPreview(null)}>关闭</button></div>
        <iframe title={`简历预览 ${preview}`} src={`/api/resume-file?path=${encodeURIComponent(preview)}`} style={{ flex: 1, border: 0, width: "100%" }} />
      </div>
    </div>}
  </div>;
}
