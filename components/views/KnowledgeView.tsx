"use client";

import { useEffect, useState } from "react";
import { BookOpen, Plus, Search } from "lucide-react";
import type { Quirk } from "../../lib/datafiles";
import type { KnowledgeEntry } from "../../lib/knowledge";
import { fetchJson, pollInForeground } from "../../lib/polling";
import KnowledgeDrawer, { type KnowledgeSelection, type KnowledgeValues } from "./KnowledgeDrawer";

type Pending = { taskId: string; entryId?: string };

export default function KnowledgeView({ quirks }: { quirks: Quirk[] }) {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [tab, setTab] = useState<"knowledge" | "quirks">("knowledge");
  const [selection, setSelection] = useState<KnowledgeSelection | null>(null);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const busy = submitting || !!pending;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const params = new URLSearchParams({ archived: String(showArchived) });
    if (q.trim()) params.set("q", q.trim());
    fetchJson<{ entries: KnowledgeEntry[] }>(`/api/knowledge?${params}`, controller.signal).then(result => {
      if (!controller.signal.aborted) { setEntries(result.entries); setError(""); }
    }).catch(() => { if (!controller.signal.aborted) setError("读不到知识库，请重试"); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [q, showArchived, refresh]);

  useEffect(() => {
    if (!pending) return;
    const poller = pollInForeground(async signal => {
      try {
        const result = await fetchJson<{ receipt?: { status: string; summary?: string; errors?: string[] }; status?: string; summary?: string; errors?: string[] }>(`/api/receipts/${encodeURIComponent(pending.taskId)}`, signal);
        const receipt = result.receipt ?? result;
        if (signal.aborted || !["committed", "verified", "rejected", "failed"].includes(receipt.status ?? "")) return;
        setPending(null);
        if (receipt.status === "rejected" || receipt.status === "failed") {
          const message = receipt.errors?.some(item => item.includes("E_CONFLICT")) ? "条目已发生变化，请关闭后重新打开再编辑。" : receipt.errors?.join("；") || receipt.summary || "Engine 处理失败";
          setFormError(message); setError(message); setNotice("请求未生效");
        } else {
          setNotice("Engine 已保存"); setFormError("");
          setSelection(current => {
            if (current?.kind === "add" && !pending.entryId) return null;
            if (current?.kind === "entry" && current.entry.id === pending.entryId) return null;
            return current;
          });
        }
        setRefresh(value => value + 1);
      } catch { /* A missing Receipt remains queued; never claim completion. */ }
    }, 2000);
    return poller.stop;
  }, [pending]);

  const submit = async (url: string, payload: unknown, entryId?: string) => {
    if (busy) return;
    setSubmitting(true); setFormError(""); setError(""); setNotice("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error("提交失败，请检查内容后重试");
      const queued = await response.json() as { taskId: string };
      setPending({ taskId: queued.taskId, entryId }); setNotice("已提交，等待 Engine 处理");
    } catch (error) { setFormError(error instanceof Error ? error.message : "提交失败"); }
    finally { setSubmitting(false); }
  };
  const save = async (values: KnowledgeValues) => {
    if (selection?.kind === "entry") await submit("/api/knowledge", { action: "update", id: selection.entry.id, expectedUpdatedAt: selection.entry.updatedAt, ...values }, selection.entry.id);
    else if (selection?.kind === "add") await submit("/api/knowledge", values);
  };
  const open = (next: KnowledgeSelection) => { setFormError(""); setSelection(next); };
  const query = q.toLowerCase().trim();
  const visibleQuirks = quirks.filter(item => [item.trigger, item.action, item.source].some(text => text.toLowerCase().includes(query)));
  const drawerKey = selection?.kind === "entry" ? selection.entry.id : selection?.kind === "quirk" ? selection.quirk.id : "add";

  return <div className="content knowledge-page">
    <div className="head">
      <div className="hicon"><BookOpen size={24} strokeWidth={1.6} /></div>
      <div><div className="t"><h1>Knowledge</h1></div><p>决定、偏好与个人信息</p></div>
      <div className="acts"><button className="btn knowledge-primary" onClick={() => open({ kind: "add" })} disabled={busy}><Plus size={16} />添加 Knowledge</button></div>
    </div>
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" className="knowledge-error">{error}</p>}
    <section className="knowledge-list">
      <div className="knowledge-toolbar">
        <div className="knowledge-tabs">
          <button aria-pressed={tab === "knowledge"} className={tab === "knowledge" ? "active" : ""} onClick={() => setTab("knowledge")}>知识条目</button>
          <button aria-pressed={tab === "quirks"} className={tab === "quirks" ? "active" : ""} onClick={() => setTab("quirks")}>系统经验 · 只读</button>
        </div>
        <div className="knowledge-filters">
          <label className="knowledge-search"><Search size={15} /><input aria-label="搜索知识" placeholder="搜索标题、内容或标签" value={q} onChange={event => setQ(event.target.value)} /></label>
          {tab === "knowledge" && <select aria-label="条目状态" value={String(showArchived)} onChange={event => setShowArchived(event.target.value === "true")}><option value="false">未归档</option><option value="true">已归档</option></select>}
        </div>
      </div>
      <div className="knowledge-list-head"><span>条目</span><span>{tab === "knowledge" ? "标签" : "来源"}</span><span>更新时间</span></div>
      <ul className="knowledge-rows" aria-label={tab === "knowledge" ? "知识条目" : "系统经验"}>
        {tab === "knowledge" ? !loading && !error && entries.map(entry => <li key={entry.id}>
          <button className="knowledge-row" onClick={() => open({ kind: "entry", entry })}>
            <span className="knowledge-summary"><strong>{entry.title}</strong><span>{entry.body}</span></span>
            <span className="knowledge-tags">{entry.tags.length ? entry.tags.map(tag => <span key={tag}>{tag}</span>) : "—"}</span>
            <time dateTime={entry.updatedAt}>{entry.updatedAt.slice(0, 10)}</time>
          </button>
        </li>) : visibleQuirks.map(quirk => <li key={quirk.id}>
          <button className="knowledge-row" onClick={() => open({ kind: "quirk", quirk })}>
            <span className="knowledge-summary"><strong>{quirk.trigger}</strong><span>{quirk.action}</span></span><span className="knowledge-source">{quirk.source || "—"}</span><time dateTime={quirk.updatedAt}>{quirk.updatedAt.slice(0, 10)}</time>
          </button>
        </li>)}
      </ul>
      {tab === "knowledge" && loading ? <div className="knowledge-empty" role="status">正在加载…</div> : tab === "knowledge" && error ? <div className="knowledge-empty"><button className="btn" onClick={() => setRefresh(value => value + 1)}>重新加载</button></div> : !(tab === "knowledge" ? entries.length : visibleQuirks.length) && <div className="knowledge-empty">{q ? "没有匹配的条目" : tab === "quirks" ? "暂无系统经验" : showArchived ? "暂无已归档条目" : "暂无知识，点击右上角添加 Knowledge"}</div>}
    </section>
    {selection && <KnowledgeDrawer key={`${selection.kind}-${drawerKey}`} selection={selection} busy={busy} error={formError} onClose={() => setSelection(null)} onSave={save} onArchive={entry => submit("/api/knowledge/archive", { id: entry.id, archived: !entry.archived }, entry.id)} />}
  </div>;
}
