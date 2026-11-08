"use client";

import { useState } from "react";
import { Archive, RotateCcw } from "lucide-react";
import DetailDrawer from "../DetailDrawer";
import type { KnowledgeEntry } from "../../lib/knowledge";
import type { Quirk } from "../../lib/datafiles";

export type KnowledgeValues = { title: string; body: string; tags: string[] };
export type KnowledgeSelection = { kind: "add" } | { kind: "entry"; entry: KnowledgeEntry } | { kind: "quirk"; quirk: Quirk };

// 与 Activity 页共用 DetailDrawer 外壳（宽度 / 标题 / 关闭 / 焦点行为一致），
// 正文沿用 Activity 抽屉的排版：状态 pill、13px 灰色小标签、元数据网格（不加粗）。
const PILL = { display: "inline-block", border: "1px solid #dbe7f3", borderRadius: 999, padding: "2px 10px", marginRight: 8, fontSize: 13 };
const LABEL = { fontSize: 13, color: "#666", marginTop: 14, marginBottom: 4 };
const TEXT = { whiteSpace: "pre-wrap" as const, overflowWrap: "anywhere" as const };

export default function KnowledgeDrawer({ selection, busy, error, onClose, onSave, onArchive }: {
  selection: KnowledgeSelection;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (values: KnowledgeValues) => Promise<void>;
  onArchive: (entry: KnowledgeEntry) => Promise<void>;
}) {
  const entry = selection.kind === "entry" ? selection.entry : null;
  const quirk = selection.kind === "quirk" ? selection.quirk : null;
  const [title, setTitle] = useState(entry?.title ?? "");
  const [body, setBody] = useState(entry?.body ?? "");
  const [tags, setTags] = useState(entry?.tags.join(", ") ?? "");
  const readOnly = !!quirk || !!entry?.archived;
  const drawerTitle = quirk ? "系统经验" : entry ? entry.title : "添加 Knowledge";

  return (
    <DetailDrawer title={drawerTitle} onClose={onClose}>
      <div style={{ marginTop: 10 }}>
        <span style={PILL}>{quirk ? "只读" : entry?.archived ? "已归档 · 恢复后可编辑" : entry ? "编辑内容与标签" : "记录决定、偏好与个人信息"}</span>
        {(entry?.tags ?? []).map((tag) => (
          <span key={tag} style={PILL}>{tag}</span>
        ))}
      </div>
      {quirk ? <div>
        <div style={LABEL}>触发条件</div>
        <p style={{ ...TEXT, margin: 0 }}>{quirk.trigger}</p>
        <div style={LABEL}>处理方式</div>
        <p style={{ ...TEXT, margin: 0 }}>{quirk.action}</p>
        <dl className="activity-metadata">
          <dt>来源</dt><dd>{quirk.source}</dd>
          <dt>版本</dt><dd>{quirk.version}</dd>
          <dt>更新时间</dt><dd>{quirk.updatedAt.slice(0, 10)}</dd>
        </dl>
      </div> : <form onSubmit={event => {
        event.preventDefault();
        void onSave({ title: title.trim(), body: body.trim(), tags: [...new Set(tags.split(/[,，]/).map(tag => tag.trim()).filter(Boolean))] });
      }}>
        {error && <p role="alert" className="knowledge-error">{error}</p>}
        <fieldset disabled={busy} className="knowledge-fields">
          <label htmlFor="knowledge-title">标题<input id="knowledge-title" className="knowledge-input" value={title} onChange={event => setTitle(event.target.value)} required readOnly={readOnly} placeholder="例如：账号注册方式" /></label>
          <label htmlFor="knowledge-body">内容<textarea id="knowledge-body" className="knowledge-input" value={body} onChange={event => setBody(event.target.value)} required readOnly={readOnly} rows={12} placeholder="填写已确认的事实、决定或约定" /></label>
          <label htmlFor="knowledge-tags">标签<input id="knowledge-tags" className="knowledge-input" value={tags} onChange={event => setTags(event.target.value)} readOnly={readOnly} placeholder="多个标签用逗号分隔，例如 agent-context" /></label>
        </fieldset>
        {entry && <div className="knowledge-meta">
          <span>创建于 {entry.createdAt.slice(0, 10)}</span><span>更新于 {entry.updatedAt.slice(0, 10)}</span>
          {entry.archivedAt && <span>归档于 {entry.archivedAt.slice(0, 10)}</span>}
        </div>}
        {entry && !entry.archived && <p className="knowledge-hint">保存修改会创建新版本，原条目保留在已归档列表中。</p>}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 20, paddingTop: 14, borderTop: "1px solid #eef3f9" }}>
          {entry && <button className="btn" type="button" disabled={busy} onClick={() => void onArchive(entry)}>{entry.archived ? <RotateCcw size={14} /> : <Archive size={14} />}{entry.archived ? "恢复条目" : "归档"}</button>}
          <span style={{ flex: 1 }} />
          <button className="btn" type="button" onClick={onClose}>关闭</button>
          {!readOnly && <button className="btn knowledge-primary" type="submit" disabled={busy || !title.trim() || !body.trim()}>{busy ? "等待 Engine 处理…" : entry ? "保存修改" : "添加 Knowledge"}</button>}
          {readOnly && busy && <span role="status" className="knowledge-hint">等待 Engine 处理…</span>}
        </div>
      </form>}
    </DetailDrawer>
  );
}
