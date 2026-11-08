"use client";

import { useCallback, useEffect, useState } from "react";
import { Cpu } from "lucide-react";

// Client-side mirrors of lib/engine/console.ts shapes. The
// server module itself (node:fs) must never be imported here.
type Heartbeat = { status: "online" | "offline" | "missing"; ageMs: number | null; updatedAt: string | null; error?: string };
type EngineStatus = {
  heartbeat: Heartbeat;
  lastTaskId: string | null;
  stateUpdatedAt: string | null;
  validation: { errors: string[]; warnings: string[]; knownDrift: string[]; sources: Record<string, string> };
  external: { stateMissing: boolean; mismatches: string[] };
  today: string;
  todayRow: Record<string, number> | null;
};
type RunRecord = { taskId: string; event: string; status: string; summary: string; finishedAt: string };
type Receipt = { taskId: string; event: string; status: string; createdAt: string; summary: string; errors?: string[]; ops?: Record<string, unknown> };
type RunDetail = { run: RunRecord | null; receipt: Receipt | null; receiptMd: string | null };

type Tab = "status" | "runs" | "pending" | "registry";
const TABS: [Tab, string][] = [
  ["status", "状态"],
  ["runs", "Runs"],
  ["pending", "待批"],
  ["registry", "注册表"],
];
const PAGE_SIZE = 15;

const RED_BANNER = { background: "#fde8e8", border: "1px solid #e5484d", color: "#8b1a1a", borderRadius: 8, padding: "10px 12px", marginBottom: 12 };

/** Collapse identical messages to one line with a count (e.g. one 18-field-row note per ledger row). */
function dedupeCount(arr: string[]): [string, number][] {
  const m = new Map<string, number>();
  for (const s of arr) m.set(s, (m.get(s) ?? 0) + 1);
  return [...m.entries()];
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json() as Promise<T>;
}

export default function EngineView() {
  const [tab, setTab] = useState<Tab>("status");
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [statusErr, setStatusErr] = useState("");
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [runsTotal, setRunsTotal] = useState(0);
  const [runsPage, setRunsPage] = useState(1);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [pending, setPending] = useState<Receipt[]>([]);
  const [registry, setRegistry] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<Record<string, string>>({});
  const [decided, setDecided] = useState<string[]>([]);
  const [decideErr, setDecideErr] = useState<Record<string, string>>({});
  // FR-21: console write token, fetched from /api/console-token on mount.
  const [consoleToken, setConsoleToken] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await getJson<EngineStatus>("/api/engine"));
      setStatusErr("");
    } catch {
      setStatus(null);
      setStatusErr("引擎状态读不到：看板服务异常");
    }
  }, []);
  const loadPending = useCallback(async () => {
    try {
      const j = await getJson<{ pending: Receipt[] }>("/api/decisions");
      setPending(j.pending);
    } catch {
      /* 下一轮轮询再试，不刷屏 */
    }
  }, []);
  const loadRuns = useCallback(async (page: number) => {
    try {
      const j = await getJson<{ runs: RunRecord[]; total: number }>(`/api/runs?page=${page}`);
      setRuns(j.runs);
      setRunsTotal(j.total);
    } catch {
      /* 下一轮再试 */
    }
  }, []);

  useEffect(() => {
    loadStatus();
    loadPending();
    loadRuns(1);
    // FR-21: fetch the console write token for approval POSTs.
    getJson<{ token: string }>("/api/console-token")
      .then((j) => setConsoleToken(j.token))
      .catch(() => setConsoleToken(null));
    const t = setInterval(() => {
      loadStatus();
      loadPending();
    }, 5000);
    return () => clearInterval(t);
  }, [loadStatus, loadPending, loadRuns]);

  useEffect(() => {
    if (tab === "registry" && registry === null) {
      getJson<{ text: string }>("/api/registry")
        .then((j) => setRegistry(j.text))
        .catch(() => setRegistry("注册表读不到。"));
    }
  }, [tab, registry]);

  const openRun = async (taskId: string) => {
    try {
      setDetail(await getJson<RunDetail>(`/api/runs/${encodeURIComponent(taskId)}`));
    } catch {
      setDetail(null);
    }
  };

  const decide = async (taskId: string, approved: boolean) => {
    const quote = quotes[taskId] || "";
    if (approved && !quote.trim()) {
      setDecideErr((m) => ({ ...m, [taskId]: "批准必须输入原话" }));
      return;
    }
    if (!consoleToken) {
      setDecideErr((m) => ({ ...m, [taskId]: "令牌未就绪，请稍后重试" }));
      return;
    }
    const res = await fetch("/api/decisions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // FR-21: local token required for write protection.
        "X-Console-Token": consoleToken,
      },
      body: JSON.stringify({ taskId, approved, quote }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setDecideErr((m) => ({ ...m, [taskId]: j.error || `提交失败 ${res.status}` }));
      return;
    }
    setDecided((d) => [...d, taskId]);
    setPending((p) => p.filter((r) => r.taskId !== taskId));
  };

  const hb = status?.heartbeat;
  const unhealthy =
    !!status &&
    (hb?.status !== "online" ||
      status.validation.errors.length > 0 ||
      status.external.mismatches.length > 0);
  const runsPages = Math.max(1, Math.ceil(runsTotal / PAGE_SIZE));

  return (
    <div className="content">
      <div className="head">
        <div className="hicon">
          <Cpu size={24} strokeWidth={1.6} />
        </div>
        <div>
          <div className="t">
            <h1>Engine</h1>
          </div>
          <p>引擎状态 · Runs · 待批 · 注册表，只读；批准只写决定文件，由引擎执行</p>
        </div>
      </div>
      <div style={{ background: "#fff", border: "1px solid #dbe7f3", borderRadius: 12, overflow: "hidden", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 6, padding: "12px 16px", borderBottom: "1px solid #eef3f9", background: "#fff" }}>
          {TABS.map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)} style={{ fontSize: 13, padding: "6px 14px", borderRadius: 999, border: "1px solid #e2e8f0", background: tab === t ? "#fff" : "transparent", fontWeight: tab === t ? 600 : 400, color: tab === t ? "#0f172a" : "#64748b", cursor: "pointer" }}>
              {label}
              {t === "pending" && pending.length > 0 ? ` (${pending.length})` : ""}
            </button>
          ))}
        </div>
        <div style={{ padding: "16px" }}>
          {tab === "status" && (
            <>
              {status?.heartbeat.error && <div role="alert" style={RED_BANNER}>Engine 故障：{status.heartbeat.error}</div>}
              {statusErr && <div style={RED_BANNER}>⚠️ {statusErr}</div>}
              {status && hb?.status !== "online" && (
                <div style={RED_BANNER}>
                  ⚠️ 引擎{hb?.status === "missing" ? "无心跳" : "离线"}，当前处理进度不可确认。请核对收据与错误，再用 npm run engine -- daemon 恢复引擎。
                </div>
              )}
              {status && unhealthy && hb?.status === "online" && (
                <div style={RED_BANNER}>
                  ⚠️ 数据健康异常：
                  {status.validation.errors.map((e) => (
                    <div key={e}>{e}</div>
                  ))}
                  {status.external.mismatches.map((m) => (
                    <div key={m}>外部修改：{m}</div>
                  ))}
                </div>
              )}
              {!status && !statusErr && <div className="empty">Loading engine status…</div>}
              {status && (
                <>
                  <div className="tr">
                    <span>
                      <span className="pill">
                        <i className={`dot ${hb?.status === "online" ? "" : "n"}`} />
                        {hb?.status === "online" ? "在线" : hb?.status === "offline" ? "离线" : "无心跳"}
                      </span>
                    </span>
                    <span className="mono">心跳 {hb?.updatedAt ? new Intl.DateTimeFormat("en-GB", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(hb.updatedAt)) + " 休斯顿" : "-"}</span>
                    <span className="mono">最后任务 {status.lastTaskId || "-"}</span>
                  </div>
                  <div className="tr" style={{ gridTemplateColumns: "max-content 1fr" }}>
                    <span className="mono" style={{ whiteSpace: "nowrap" }}>今日 {status.today}</span>
                    <span>
                      {status.todayRow
                        ? `发现 ${status.todayRow.discovery} · 筛选 ${status.todayRow.screening} · 定制 ${status.todayRow.tailoring} · 拍板 ${status.todayRow.review} · 投递 ${status.todayRow.apply}`
                        : "今日暂无 daily 行"}
                    </span>
                  </div>
                  {status.validation.warnings.length > 0 && (
                    <div className="mono" style={{ padding: "8px 14px" }}>
                      警告：{status.validation.warnings.join("；")}
                    </div>
                  )}
                  {status.validation.knownDrift.length > 0 && (
                    <div className="mono" style={{ padding: "8px 14px" }}>
                      已知漂移：
                      {dedupeCount(status.validation.knownDrift).map(([s, n]) => (
                        <div key={s}>
                          {s}
                          {n > 1 ? ` ×${n}` : ""}
                        </div>
                      ))}
                    </div>
                  )}
                  {status.external.stateMissing && (
                    <div className="mono" style={{ padding: "8px 14px" }}>外部修改检测：state.json 缺失，暂无法比对（启动引擎后自动建立）。</div>
                  )}
                </>
              )}
            </>
          )}
          {tab === "runs" && (
            <>
              {runs.map((r) => (
                <div className="tr" key={r.taskId}>
                  <span className="mono">{r.finishedAt ? r.finishedAt.slice(5, 16).replace("T", " ") : "-"}</span>
                  <span>
                    <button className="jlink" onClick={() => openRun(r.taskId)} title="查看 run 详情">
                      <b>{r.taskId}</b>
                      <small>{r.event}</small>
                    </button>
                  </span>
                  <span>
                    <span className="pill">
                      <i className={`dot ${r.status === "committed" || r.status === "verified" ? "" : r.status === "pending-approval" ? "w" : "n"}`} />
                      {r.status}
                    </span>
                  </span>
                  <span>{r.summary}</span>
                </div>
              ))}
              {!runs.length && <div className="empty">No runs yet.</div>}
              {runsPages > 1 && (
                <div className="pager mono">
                  <button
                    disabled={runsPage <= 1}
                    onClick={() => {
                      const p = runsPage - 1;
                      setRunsPage(p);
                      loadRuns(p);
                    }}
                  >
                    ← Prev
                  </button>
                  <span>
                    {runsPage} / {runsPages}
                  </span>
                  <button
                    disabled={runsPage >= runsPages}
                    onClick={() => {
                      const p = runsPage + 1;
                      setRunsPage(p);
                      loadRuns(p);
                    }}
                  >
                    Next →
                  </button>
                </div>
              )}
              {detail && (
                <div style={{ background: "#fff", border: "1px solid #dbe7f3", borderRadius: 12, marginTop: 12, overflow: "hidden" }}>
                  <div className="mono" style={{ padding: "10px 16px", fontSize: 12, color: "#64748b", borderBottom: "1px solid #eef3f9", background: "#fff" }}>
                    {detail.run?.taskId || detail.receipt?.taskId} · {detail.receipt?.status || detail.run?.status}
                    {detail.receipt?.ops && typeof detail.receipt.ops === "object" && "git" in detail.receipt.ops ? ` · git: ${String((detail.receipt.ops as Record<string, unknown>).git)}` : ""}
                  </div>
                  <div style={{ padding: "16px" }}>
                    {detail.receipt?.errors?.length ? (
                      <div style={RED_BANNER}>
                        {detail.receipt.errors.map((e) => (
                          <div key={e}>{e}</div>
                        ))}
                      </div>
                    ) : null}
                    <pre className="mono" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, margin: 0 }}>
                      {detail.receiptMd || detail.receipt?.summary || "无回执"}
                    </pre>
                  </div>
                </div>
              )}
            </>
          )}
          {tab === "pending" && (
            <>
              {pending.map((r) => {
                // FR-32: Diff Preview from receipt ops.
                const diffPreview = (r.ops as Record<string, unknown> | undefined)?.diffPreview as
                  | { files?: { path: string; operation: string; summary: string }[]; complete?: boolean; missingFiles?: string[] }
                  | undefined;
                return (
                <div className="tr" key={r.taskId}>
                  <span className="mono">{r.createdAt ? r.createdAt.slice(5, 16).replace("T", " ") : "-"}</span>
                  <span>
                    <b>{r.taskId}</b>
                    <small style={{ display: "block", color: "var(--mut)" }}>{r.event}</small>
                  </span>
                  <span>
                    {r.summary}
                    {diffPreview?.files && diffPreview.files.length > 0 && (
                      <details style={{ marginTop: 8 }}>
                        <summary className="mono" style={{ cursor: "pointer", fontSize: 12 }}>
                          Diff Preview ({diffPreview.files.length} 文件{diffPreview.complete ? "" : " ⚠️ 不完整"})
                        </summary>
                        <div className="mono" style={{ fontSize: 12, marginTop: 6, paddingLeft: 8 }}>
                          {diffPreview.files.map((f, i) => (
                            <div key={i} style={{ marginBottom: 4 }}>
                              <b>{f.path}</b> <span style={{ color: "var(--mut)" }}>({f.operation})</span>
                              <div style={{ paddingLeft: 8 }}>{f.summary}</div>
                            </div>
                          ))}
                          {diffPreview.missingFiles && diffPreview.missingFiles.length > 0 && (
                            <div style={{ color: "#8b1a1a" }}>
                              缺失预览: {diffPreview.missingFiles.join(", ")}
                            </div>
                          )}
                        </div>
                      </details>
                    )}
                  </span>
                  <span>
                    <input
                      className="srch"
                      placeholder="批准原话（必填）"
                      value={quotes[r.taskId] || ""}
                      onChange={(e) => setQuotes((m) => ({ ...m, [r.taskId]: e.target.value }))}
                    />
                    <span className="chips">
                      <button onClick={() => decide(r.taskId, true)}>批准</button>
                      <button onClick={() => decide(r.taskId, false)}>拒绝</button>
                    </span>
                    {decideErr[r.taskId] && <small style={{ display: "block", color: "#8b1a1a" }}>{decideErr[r.taskId]}</small>}
                  </span>
                </div>
                );
              })}
              {!pending.length && !decided.length && <div className="empty">暂无待批事项。</div>}
              {decided.length > 0 && (
                <div className="mono" style={{ padding: "8px 14px" }}>
                  已提交决定，待引擎处理：{decided.join("、")}（页面不宣称已执行，以引擎回执为准）
                </div>
              )}
            </>
          )}
          {tab === "registry" && (
            <pre className="mono" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, margin: 0 }}>
              {registry === null ? "Loading…" : registry}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
