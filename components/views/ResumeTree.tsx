"use client";

import { useMemo, useState } from "react";
import { GitBranch, ChevronRight, ChevronDown } from "lucide-react";

type VNode = {
  version: string;
  jobId: string;
  company: string;
  role: string;
  file: string | null;
  fileExists?: boolean;
  createdAt: string;
  note: string;
  selected: boolean;
  basedOn: string | null;
  isRoot: boolean;
  children: VNode[];
};

const baseName = (file: string | null) =>
  file ? file.split("/").pop() || file : null;

export default function ResumeTree({
  versions,
  jobs,
}: {
  versions: { versions: any[]; selected: Record<string, string> };
  jobs: { id: string; company?: string; role?: string }[];
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<string | null>(null);

  const names = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);

  const tree = useMemo(() => {
    const baseVersions = versions.versions
      .filter((v) => v.jobId === "base")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const mk = (v: any, isRoot: boolean, basedOn: string | null): VNode => {
      const j = names.get(v.jobId);
      return {
        version: v.version,
        jobId: v.jobId,
        company: isRoot ? "基础简历" : j?.company || v.jobId,
        role: isRoot ? "ROOT" : j?.role || "-",
        file: v.file,
        fileExists: v.fileExists,
        createdAt: v.createdAt,
        note: v.note,
        selected: versions.selected[v.jobId] === v.version,
        basedOn,
        isRoot,
        children: [],
      };
    };

    const roots = baseVersions.map((v, i) =>
      mk(v, true, i > 0 ? baseVersions[i - 1].version : null)
    );
    for (let i = 1; i < roots.length; i++) {
      roots[i - 1].children.push(roots[i]);
    }

    const latest = roots[roots.length - 1];
    const derived = versions.versions
      .filter((v) => v.jobId !== "base")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((v) => mk(v, false, latest ? latest.version : null));
    if (latest) latest.children.push(...derived);

    return roots[0] || null;
  }, [versions, names]);

  const toggle = (ver: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(ver)) n.delete(ver);
      else n.add(ver);
      return n;
    });

  const expandAll = () =>
    setExpanded(new Set(versions.versions.map((v: any) => v.version)));

  const renderNode = (node: VNode, depth: number, isLast: boolean, prefix: string) => {
    const isExp = expanded.has(node.version);
    const hasKids = node.children.length > 0;
    const bn = baseName(node.file);
    const missing = !bn || node.fileExists === false;
    const key = `${node.jobId}/${node.version}`;
    const showPrev = preview === key;
    const connector = depth === 0 ? "" : isLast ? "└── " : "├── ";
    const childPrefix = depth === 0 ? "" : isLast ? "    " : "│   ";

    return (
      <div key={node.version}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            padding: "10px 14px",
            borderBottom: "1px solid #f1f5f9",
            background: node.isRoot && depth === 0 ? "linear-gradient(135deg,#eff6ff 0%,#ffffff 70%)" : "#fff",
          }}
        >

          <span
            className="mono"
            style={{ fontSize: 12, color: "#cbd5e1", whiteSpace: "pre", paddingTop: 3, userSelect: "none" }}
          >
            {prefix}{connector}
          </span>
          {hasKids ? (
            <button
              onClick={() => toggle(node.version)}
              title={isExp ? "收起" : "展开"}
              style={{ background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 6, cursor: "pointer", padding: 3, color: "#475569", lineHeight: 0 }}
            >
              {isExp ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
          ) : (
            <span style={{ width: 22 }} />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {node.isRoot && depth === 0 && (
                <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", color: "#fff", background: "linear-gradient(135deg,#2563eb,#1d4ed8)", padding: "3px 8px", borderRadius: 6 }}>
                  BASE
                </span>
              )}
              <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                {node.version}
              </span>
              {node.selected && (
                <span style={{ fontSize: 10, fontWeight: 700, color: "#16a34a", background: "#dcfce7", padding: "2px 8px", borderRadius: 999 }}>
                  已选用
                </span>
              )}
              {missing && (
                <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", background: "#dc2626", padding: "2px 8px", borderRadius: 999 }}>
                  PDF 缺失
                </span>
              )}
              {hasKids && (
                <span style={{ fontSize: 11, color: "#94a3b8" }}>{node.children.length} 个子版本</span>
              )}
            </div>
            {!node.isRoot && (
              <div style={{ fontSize: 13, marginTop: 3 }}>
                <b style={{ color: "#0f172a" }}>{node.company}</b>
                <span style={{ color: "#64748b" }}> · {node.role}</span>
              </div>
            )}
            {node.basedOn && (
              <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#94a3b8", marginTop: 3 }}>
                <GitBranch size={11} />
                <span>基于 <span className="mono" style={{ color: "#64748b" }}>{node.basedOn}</span></span>
              </div>
            )}
            <div style={{ fontSize: 12, color: "#475569", marginTop: 4, lineHeight: 1.5 }}>
              {node.note || "—"}
            </div>

            <div className="mono" style={{ fontSize: 11, color: "#94a3b8", marginTop: 3 }}>
              {(node.createdAt || "").slice(0, 10)}
            </div>
            {!missing && (
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <button
                  onClick={() => setPreview(showPrev ? null : key)}
                  style={{ fontSize: 12, padding: "5px 14px", border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", color: "#2563eb", fontWeight: 500, cursor: "pointer" }}
                >
                  {showPrev ? "收起预览" : "预览"}
                </button>
                <a
                  href={`/api/resume-file?path=${encodeURIComponent(bn || "")}&download=1`}
                  style={{ fontSize: 12, padding: "5px 14px", border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", color: "#2563eb", fontWeight: 500, textDecoration: "none" }}
                >
                  下载
                </a>
              </div>
            )}
            {showPrev && !missing && (
              <div style={{ marginTop: 10 }}>
                <iframe
                  title={node.version}
                  src={`/api/resume-file?path=${encodeURIComponent(bn || "")}`}
                  style={{ width: "100%", height: 480, border: "1px solid #e2e8f0", borderRadius: 10 }}
                />
              </div>
            )}
          </div>
        </div>
        {isExp &&
          hasKids &&
          node.children.map((c, i) =>
            renderNode(c, depth + 1, i === node.children.length - 1, prefix + childPrefix)
          )}
      </div>
    );
  };

  if (!tree) {
    return (
      <div style={{ padding: 28, textAlign: "center", color: "#94a3b8", fontSize: 14 }}>
        暂无简历版本
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginBottom: 8 }}>
        <button
          onClick={expandAll}
          style={{ fontSize: 12, padding: "5px 12px", border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", color: "#475569", cursor: "pointer" }}
        >
          全部展开
        </button>
        <button
          onClick={() => setExpanded(new Set())}
          style={{ fontSize: 12, padding: "5px 12px", border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", color: "#475569", cursor: "pointer" }}
        >
          全部收起
        </button>
      </div>
      <div style={{ background: "#fff", border: "1px solid #dbe7f3", borderRadius: 12, overflow: "hidden" }}>
        {renderNode(tree, 0, true, "")}
      </div>
      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 8, textAlign: "center" }}>
        倒挂树 · BASE 为基础简历置顶，子版本向下分叉 · 每个版本注明基于哪个父版本
      </div>
    </div>
  );
}
