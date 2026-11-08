"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pollInForeground, fetchJson } from "../../lib/polling";
import DetailDrawer from "../DetailDrawer";
import { Activity, Check, Copy, Info } from "lucide-react";
import { BUSINESS_STAGE_LABELS, freshRuntimeCount, type BusinessTask, type BusinessStage } from "../../lib/task-state";
import {
  buildRelayText,
  buildRerunText,
  buildSolveRequestText,
  displayStage,
  STAGES,
  STAGE_LABELS,
  statusColor,
  statusLabel,
} from "../../lib/activity-display";

type ActivityEntry = {
  activityId: string;
  jobId?: string;
  businessStage?: BusinessStage | null;
  runtimeDetail?: string;
  jobCompany?: string;
  jobRole?: string;
  jobChannel?: string;
  kind: string;
  stage: string | null;
  title: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  refs: string[];
  note: string;
  evidence: { kind: string; text: string }[];
  taskId: string;
  createdAt: string;
  runId?: string;
  sequence?: number;
  leaseExpiresAt?: string;
};
type WaitingItem = {
  waitingId: string;
  jobId?: string;
  question: string;
  context: string[];
  kind: string;
  category?: string;
  factKey?: string;
  fieldRef?: Record<string, string>;
  checkedSources?: string[];
  candidates?: string[];
  blocksStep?: string;
  status: string;
  createdAt: string;
  sourceActivityId: string | null;
  sourceStage: string | null;
  answer: string | null;
  answeredAt: string | null;
  answerScope?: string | null;
  resumeState?: "answered-pending-resume" | "resumed" | null;
  taskId: string;
};
type PlanField = {
  fieldKey: string;
  pageLabel: string;
  plannedValue?: unknown;
  valueKind: string;
  source: { kind: string; ref: string } | null;
  key: boolean;
};
type PlanRecord = {
  planId: string;
  jobId: string;
  runId: string;
  planVersion: number;
  resumeVersion: string;
  formUrl: string;
  fields: PlanField[];
  approvalBasis: { kind: string; ref: string } | null;
  status: string;
  blockers: string[];
  planHash: string;
  createdAt: string;
};
type CheckpointRecord = {
  checkpointId: string;
  jobId: string;
  runId: string;
  planId: string;
  planHash: string;
  type: string;
  status: string;
  results: { fieldKey: string; expected?: unknown; readback?: unknown; result: string; basis?: string }[];
  missingKeyFields: string[];
  createdAt: string;
};
type AttemptRecord = {
  attemptId: string;
  jobId: string;
  runId: string;
  planId: string;
  status: string;
  effectiveStatus: string;
  outcome: string | null;
  approvalRef: string;
  applicationId: string | null;
  evidence: { kind: string; text: string }[];
  createdAt: string;
  updatedAt: string;
};
const CHECKPOINT_TYPE_LABELS: Record<string, string> = {
  "after-upload": "上传后",
  "after-parse": "解析后",
  "on-page-change": "翻页时",
  "pre-submit": "提交前",
};
const ATTEMPT_STATUS_LABELS: Record<string, string> = {
  recorded: "已记录待点击",
  confirmed: "已确认提交",
  "not-submitted": "确认未提交",
  uncertain: "结果不确定",
  "uncertain-timeout": "结果不确定（超时）",
  "resolved-confirmed": "核查后确认已提交",
  "resolved-not-submitted": "核查后确认未提交",
  escalated: "已上报待决定",
};
const readbackText = (v: unknown): string =>
  v === undefined || v === null ? "—" : typeof v === "string" ? v : JSON.stringify(v);
const CATEGORY_LABELS: Record<string, string> = {
  "missing-fact": "缺少事实",
  conflict: "答案冲突",
  approval: "投递审批",
  "user-action": "本人操作",
};
const categoryOf = (w: WaitingItem): string =>
  w.category ?? (w.kind === "approval" ? "approval" : w.kind === "manual-step" ? "user-action" : "missing-fact");
const planValueText = (f: PlanField): string => {
  if (f.valueKind === "secret-action") return "安全输入（不在计划内）";
  if (f.valueKind === "absent" || f.plannedValue === undefined || f.plannedValue === null) return "—";
  return typeof f.plannedValue === "string" ? f.plannedValue : JSON.stringify(f.plannedValue);
};

const PAGE_SIZE = 15;

const PILL = { display: "inline-block", border: "1px solid #dbe7f3", borderRadius: 999, padding: "2px 10px", marginRight: 8, fontSize: 13 };
const SECTION_HEAD = { fontSize: 15, color: "#0f172a", marginBottom: 10 };
const TABLE_WRAP = { overflowX: "auto" as const, background: "#fff", border: "1px solid #dbe7f3", borderRadius: 12 };
const TABLE = { width: "100%", borderCollapse: "collapse" as const, fontSize: 14 };
const TH = { textAlign: "left" as const, padding: "10px 12px", borderBottom: "2px solid #dbe7f3", color: "#666", fontSize: 13, fontWeight: 400, whiteSpace: "nowrap" as const };
const TD = { padding: "10px 12px", borderBottom: "1px solid #eef3f9", verticalAlign: "top" as const };
const DRAWER_LABEL = { fontSize: 13, color: "#666", marginTop: 14, marginBottom: 4 };
const TEXTAREA = { width: "100%", border: "1px solid #dbe7f3", borderRadius: 8, padding: 8, fontSize: 14 };

type Distribution = { running: number; waiting: number; done: number; failed: number; interrupted: number };
type Overview = { totalToday: number; runningToday: number; openWaiting: number; submittedToday?: number };

const SORTS: [string, string][] = [
  ["created-desc", "时间倒序"],
  ["created-asc", "时间正序"],
  ["status", "状态"],
  ["kind", "种类"],
];
const WAITING_SORTS: [string, string][] = [
  ["default", "默认（待处理在前）"],
  ["created-desc", "时间倒序"],
  ["created-asc", "时间正序"],
  ["status", "状态"],
  ["kind", "种类"],
];
const WAITING_STATUS_RANK: Record<string, number> = { open: 0, answered: 1, parked: 2 };

// 下一步归属（2026-11-07 定版）：从活动状态与挂起的待定事项派生，只讲业务。
function nextStepText(a: ActivityEntry, hasOpenWaiting: boolean): string {
  if (hasOpenWaiting) return "我 · 处理待定事项";
  switch (a.status) {
    case "running": return "Agent · 执行中";
    case "waiting": return "我 · 查看待定事项";
    case "interrupted": return "Agent · 待恢复核对";
    case "done": return a.kind === "applying" ? "雇主 · 等回复" : "—";
    case "failed": return "我 · 决定是否重跑";
    default: return "—";
  }
}

function utcSlice(iso: string): string {
  return `${iso.slice(0, 19).replace("T", " ")} UTC`;
}

function relTime(iso: string, nowMs: number): string {
  const diff = Math.floor((nowMs - Date.parse(iso)) / 1000);
  if (!Number.isFinite(diff) || diff < 5) return "刚刚";
  if (diff < 60) return `${diff} 秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  return utcSlice(iso);
}

// 全页统一相对时间（2026-11-07 定版）：悬停 title 显示绝对时间。
function compactTime(iso: string, nowMs: number): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return "时间未知";
  const diff = nowMs - timestamp;
  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return `${Math.max(1, Math.floor(diff / 60000))} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 7 * 86400000) return `${Math.floor(diff / 86400000)} 天前`;
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function StageBar({ entry }: { entry: ActivityEntry }) {
  const current = displayStage(entry.kind, entry.stage);
  if (!current) return null;
  const idx = STAGES.findIndex((s) => s.id === current);
  const color = statusColor(entry.status);
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {STAGES.map((s, i) => (
          <span
            key={s.id}
            style={{
              ...PILL,
              marginRight: 0,
              background: "#fff",
              color: i === idx ? color : "#999",
              borderColor: i === idx ? color : "#dbe7f3",
              fontWeight: i === idx ? 600 : 400,
            }}
          >
            {i === idx ? `● ${s.short}` : s.short}
          </span>
        ))}
      </div>
      <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>
        当前：{STAGE_LABELS[current]}（{statusLabel(entry.status)}）
         · 其他阶段未核验，不按顺序推断完成
      </div>
    </div>
  );
}

function StatusCell({ status }: { status: string }) {
  return (
    <span style={{ color: statusColor(status), whiteSpace: "nowrap" }}>
      {status === "running" && (
        <span
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: statusColor(status),
            animation: "act-pulse 1.6s ease-in-out infinite",
            marginRight: 6,
          }}
        />
      )}
      {statusLabel(status)}
    </span>
  );
}

/** A concise read surface; evidence and execution identifiers belong in the drawer. */
export function ActivityFeedRow({ entry: a, now, flash, hasOpenWaiting, onOpen }: { entry: ActivityEntry; now: number; flash?: boolean; hasOpenWaiting?: boolean; onOpen: () => void }) {
  const subLine = [a.jobCompany, a.jobChannel].filter(Boolean).join(" · ");
  return <tr onClick={onOpen} style={{ cursor: "pointer", ...(flash ? { animation: "act-flash 2s ease-out" } : {}) }}>
    <td style={{ ...TD, minWidth: 220, maxWidth: 380 }}><button className="activity-title" title={a.title} onClick={event => { event.stopPropagation(); onOpen(); }}>{a.title}</button>{subLine && <div style={{ fontSize: 12, color: "#64748b", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 380 }}>{subLine}</div>}</td>
    <td style={TD}><StatusCell status={a.status} /></td>
    <td style={{ ...TD, maxWidth: 420 }}><span className="activity-preview" title={a.runtimeDetail || a.note || undefined}>{a.runtimeDetail || a.note || (a.status === "interrupted" ? "运行信号已过期，待核对" : "暂无步骤说明")}</span></td>
    <td style={{ ...TD, whiteSpace: "nowrap", color: "#475569", fontSize: 13 }}>{nextStepText(a, !!hasOpenWaiting)}</td>
    <td style={{ ...TD, whiteSpace: "nowrap", color: "#64748b", fontSize: 12 }} title={utcSlice(a.createdAt)}>{compactTime(a.createdAt, now)}</td>
  </tr>;
}

export default function ActivityView() {
  const [feed, setFeed] = useState<ActivityEntry[]>([]);
  const [feedTotal, setFeedTotal] = useState(0);
  const [feedPage, setFeedPage] = useState(1);
  const [finishedFeed, setFinishedFeed] = useState<ActivityEntry[]>([]);
  const [finishedTotal, setFinishedTotal] = useState(0);
  const [finishedPage, setFinishedPage] = useState(1);
  const [finishedOpen, setFinishedOpen] = useState(false);
  const [feedErr, setFeedErr] = useState("");
  const [feedSort, setFeedSort] = useState("created-desc");
  const [stageFilter, setStageFilter] = useState<string | null>(null);
  const [distribution, setDistribution] = useState<Distribution>({ running: 0, waiting: 0, done: 0, failed: 0, interrupted: 0 });
  const [overview, setOverview] = useState<Overview>({ totalToday: 0, runningToday: 0, openWaiting: 0 });
  const [stageCounts, setStageCounts] = useState<Record<string, number>>({});
  const [lastUpdated, setLastUpdated] = useState("");
  const [waiting, setWaiting] = useState<WaitingItem[]>([]);
  const [waitingErr, setWaitingErr] = useState("");
  const [waitingSort, setWaitingSort] = useState("default");
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [checkpoints, setCheckpoints] = useState<CheckpointRecord[]>([]);
  const [attempts, setAttempts] = useState<AttemptRecord[]>([]);
  const [answerScopes, setAnswerScopes] = useState<Record<string, string>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState<string[]>([]);
  // 复制到剪贴板：优先 Clipboard API，失败时回退 textarea 方案。只在点击处理里调用。
  const copyText = async (text: string): Promise<boolean> => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      /* 回退到 textarea 方案 */
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  };
  const copyRelay = async (waitingId: string, text: string) => {
    if (await copyText(text)) setCopied((m) => ({ ...m, [waitingId]: true }));
  };
  const [answerErr, setAnswerErr] = useState<Record<string, string>>({});
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleteSubmitted, setDeleteSubmitted] = useState<string[]>([]);
  const [deleteErr, setDeleteErr] = useState<Record<string, string>>({});
  const [healthOpen, setHealthOpen] = useState(false);
  const [feedDrawerId, setFeedDrawerId] = useState<string | null>(null);
  const [selectedActivity, setSelectedActivity] = useState<ActivityEntry | null>(null);
  const [running, setRunning] = useState<ActivityEntry[]>([]);
  const [tasks, setTasks] = useState<BusinessTask[]>([]);
  const activeSignalCount = freshRuntimeCount(running, tasks);
  const [taskIssues, setTaskIssues] = useState<string[]>([]);
  const [pendingInbox, setPendingInbox] = useState<{ count: number; items: { taskId: string; event: string; submittedAt: string }[] }>({ count: 0, items: [] });
  const [engineHb, setEngineHb] = useState<{ status: string; ageMs: number | null; updatedAt: string | null; lastTaskId: string | null; error?: string } | null>(null);
  const [waitingDrawerId, setWaitingDrawerId] = useState<string | null>(null);
  const feedDrawer = selectedActivity?.activityId === feedDrawerId ? selectedActivity : feed.find(a => a.activityId === feedDrawerId) ?? finishedFeed.find(a => a.activityId === feedDrawerId) ?? null;
  const waitingDrawer = waiting.find(w => w.waitingId === waitingDrawerId) ?? null;
  const refreshRef = useRef<() => void>(() => {});
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState(0);
  const [flashFeed, setFlashFeed] = useState<string[]>([]);
  const [flashWaiting, setFlashWaiting] = useState<string[]>([]);
  const prevFeedRef = useRef(new Map<string, string>());
  const prevWaitingRef = useRef(new Map<string, string>());

  useEffect(() => {
    setNow(Date.now());
    setMounted(true);
  }, []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const resetAction = useCallback(() => {
    setDeleteConfirm(null);
  }, []);
  const closeDrawers = useCallback(() => {
    setFeedDrawerId(null);
    setWaitingDrawerId(null);
    setHealthOpen(false);
    setCopied({});
  }, []);

  const flashTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => () => { flashTimers.current.forEach(clearTimeout); }, []);
  const flashLater = (setter: (f: (cur: string[]) => string[]) => void, ids: string[]) => {
    if (ids.length === 0) return;
    setter((cur) => [...new Set([...cur, ...ids])]);
    const timer = setTimeout(() => {
      flashTimers.current.delete(timer);
      setter((cur) => cur.filter((x) => !ids.includes(x)));
    }, 2500);
    flashTimers.current.add(timer);
  };

  const loadFeed = useCallback(async (page: number, signal: AbortSignal) => {
    try {
      const q = new URLSearchParams({ page: String(page), sort: feedSort });
      if (stageFilter) q.set("stage", stageFilter);
      q.set("status", "unfinished");
      if (feedDrawerId) q.set("selectedId", feedDrawerId);
      const j = await fetchJson<{
        activities: ActivityEntry[];
        selectedActivity: ActivityEntry | null;
        page: number;
        total: number;
        distribution: Distribution;
        overview: Overview;
        stageCounts: Record<string, number>;
        running?: ActivityEntry[];
        tasks?: BusinessTask[];
        taskIssues?: string[];
        pendingInbox?: { count: number; items: { taskId: string; event: string; submittedAt: string }[] };
      }>(`/api/activity?${q.toString()}`, signal);
      if (signal.aborted) return;
      const changed: string[] = [];
      for (const a of j.activities) {
        const key = `${a.status}|${a.stage ?? a.kind}|${a.title}|${a.note}`;
        const prev = prevFeedRef.current.get(a.activityId);
        if (prev === undefined || prev !== key) changed.push(a.activityId);
        prevFeedRef.current.set(a.activityId, key);
      }
      flashLater(setFlashFeed, changed);
      setFeed(j.activities);
      setSelectedActivity(j.selectedActivity);
      setFeedPage(j.page);
      setFeedTotal(j.total);
      setDistribution(j.distribution);
      setOverview(j.overview);
      setStageCounts(j.stageCounts);
      setRunning(j.running ?? []);
      setTasks(j.tasks ?? []);
      setTaskIssues(j.taskIssues ?? []);
      setPendingInbox(j.pendingInbox ?? { count: 0, items: [] });
      setLastUpdated(new Date().toISOString());
      setFeedErr("");
    } catch {
      if (signal.aborted) return;
      setFeedErr("活动流读不到：看板服务异常");
    }
  }, [feedSort, stageFilter, feedDrawerId]);
  const loadFinished = useCallback(async (page: number, signal: AbortSignal) => {
    try {
      const q = new URLSearchParams({ page: String(page), sort: feedSort, status: "finished" });
      if (stageFilter) q.set("stage", stageFilter);
      const j = await fetchJson<{ activities: ActivityEntry[]; page: number; total: number }>(`/api/activity?${q.toString()}`, signal);
      if (signal.aborted) return;
      setFinishedFeed(j.activities);
      setFinishedPage(j.page);
      setFinishedTotal(j.total);
    } catch {
      /* 已结束区读不到时保持上次数据，主区错误已由 loadFeed 报告 */
    }
  }, [feedSort, stageFilter]);
  const loadPlans = useCallback(async (signal: AbortSignal) => {
    try {
      const j = await fetchJson<{ plans: PlanRecord[] }>("/api/plans", signal);
      if (signal.aborted) return;
      setPlans(j.plans);
    } catch {
      /* 计划读不到时抽屉不展示计划区，不影响活动流 */
    }
  }, []);
  const loadAttempts = useCallback(async (signal: AbortSignal) => {
    try {
      const j = await fetchJson<{ attempts: AttemptRecord[]; checkpoints: CheckpointRecord[] }>("/api/attempts", signal);
      if (signal.aborted) return;
      setAttempts(j.attempts);
      setCheckpoints(j.checkpoints);
    } catch {
      /* 检查点/尝试读不到时抽屉不展示该区，不影响活动流 */
    }
  }, []);
  const loadWaiting = useCallback(async (signal: AbortSignal) => {
    try {
      const j = await fetchJson<{ waiting: WaitingItem[] }>("/api/waiting", signal);
      if (signal.aborted) return;
      const changed: string[] = [];
      for (const w of j.waiting) {
        const key = `${w.status}|${w.answer ?? ""}|${w.question}`;
        const prev = prevWaitingRef.current.get(w.waitingId);
        if (prev === undefined || prev !== key) changed.push(w.waitingId);
        prevWaitingRef.current.set(w.waitingId, key);
      }
      flashLater(setFlashWaiting, changed);
      setWaiting(j.waiting);
      setWaitingErr("");
      // 提醒卡“去处理”直达：卡片先写 flag 再切视图，waiting 数据到后直接切待定 tab 并打开第一项抽屉。
      let autoWaiting = false;
      try {
        autoWaiting = localStorage.getItem("jobpipe-activity-auto-waiting") === "1";
      } catch {
        /* 读不到就当没有 */
      }
      if (autoWaiting) {
        try {
          localStorage.removeItem("jobpipe-activity-auto-waiting");
        } catch {
          /* 忽略 */
        }
        document.getElementById("activity-action")?.scrollIntoView({ block: "start" });
        setFeedDrawerId(null);
        setHealthOpen(false);
        const firstOpen = j.waiting.find((w) => w.status === "open");
        if (firstOpen) setWaitingDrawerId(firstOpen.waitingId);
      }
    } catch {
      if (signal.aborted) return;
      setWaitingErr("待定队列读不到：看板服务异常");
    }
  }, []);
  const loadEngine = useCallback(async (signal: AbortSignal) => {
    try {
      const j = await fetchJson<{ heartbeat: { status: string; ageMs: number | null; updatedAt: string | null }; lastTaskId: string | null }>("/api/engine", signal);
      if (signal.aborted) return;
      setEngineHb({ ...j.heartbeat, lastTaskId: j.lastTaskId });
    } catch {
      if (!signal.aborted) setEngineHb(null);
    }
  }, []);

  useEffect(() => {
    const poller = pollInForeground(async signal => {
      await Promise.allSettled([loadFeed(feedPage, signal), loadFinished(finishedPage, signal), loadWaiting(signal), loadEngine(signal), loadPlans(signal), loadAttempts(signal)]);
    }, 2000);
    refreshRef.current = poller.refresh;
    return poller.stop;
  }, [loadFeed, loadFinished, loadWaiting, loadEngine, loadPlans, loadAttempts, feedPage, finishedPage]);

  const goFeedPage = (p: number) => {
    setFeedPage(p);

  };
  const goFinishedPage = (p: number) => {
    setFinishedPage(p);
  };
  const changeStage = (s: string | null) => {
    setStageFilter(s);
    setFeedPage(1);
    setFinishedPage(1);
  };
  const changeSort = (s: string) => {
    setFeedSort(s);
    setFeedPage(1);
    setFinishedPage(1);
  };
  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  const submitAnswer = async (waitingId: string, action: "answer" | "park", answerOverride?: string) => {
    const answer = answerOverride ?? answers[waitingId] ?? "";
    if (action === "answer" && !answer.trim()) {
      setAnswerErr((m) => ({ ...m, [waitingId]: "答复不能为空" }));
      return;
    }
    try {
      const res = await fetch("/api/waiting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ waitingId, action, answer, scope: action === "answer" ? (answerScopes[waitingId] ?? "once") : undefined }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setAnswerErr((m) => ({ ...m, [waitingId]: `提交失败：${j.error ?? res.status}` }));
        return;
      }
      setSubmitted((s) => [...s, waitingId]);
      setAnswerErr((m) => ({ ...m, [waitingId]: "" }));
      // 提交后把本次答复写回草稿：提交区展示的复制句与自动复制的完全一致；先放着时清空，复制句即“先放着”。
      setAnswers((m) => ({ ...m, [waitingId]: action === "park" ? "" : answer }));
      // v7 复制桥：抽屉答复提交后自动复制发给 Agent 的一句话，粘贴到聊天即传给浏览器。
      {
        const w = waiting.find((x) => x.waitingId === waitingId);
        if (w) void copyRelay(waitingId, buildRelayText(w.question, action === "park" ? "" : answer));
      }
      resetAction();
      refreshRef.current();
    } catch {
      setAnswerErr((m) => ({ ...m, [waitingId]: "提交失败：网络异常" }));
    }
  };

  const submitDelete = async (scope: "activity" | "waiting", id: string) => {
    const key = `${scope}:${id}`;
    try {
      const res = await fetch("/api/deletions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, id }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setDeleteErr((m) => ({ ...m, [key]: `删除提交失败：${j.error ?? res.status}` }));
        return;
      }
      setDeleteSubmitted((s) => [...s, key]);
      setDeleteConfirm(null);
        setDeleteErr((m) => ({ ...m, [key]: "" }));
      refreshRef.current();
    } catch {
      setDeleteErr((m) => ({ ...m, [key]: "删除提交失败：网络异常" }));
    }
  };

  const openCount = waiting.filter((w) => w.status === "open").length;
  const feedPages = Math.max(1, Math.ceil(feedTotal / PAGE_SIZE));
  const finishedPages = Math.max(1, Math.ceil(finishedTotal / PAGE_SIZE));
  const openWaitingActivityIds = new Set(waiting.filter((w) => w.status === "open" && w.sourceActivityId).map((w) => w.sourceActivityId as string));
  // 待定队列只显示 open（待处理）的，已答复的不显示（2026-11-05 用户定版）
  const sortedWaiting = [...waiting].filter((w) => w.status === "open").sort((a, b) => {
    const byCreatedDesc = b.createdAt < a.createdAt ? -1 : b.createdAt > a.createdAt ? 1 : a.waitingId < b.waitingId ? -1 : 1;
    if (waitingSort === "created-desc") return byCreatedDesc;
    if (waitingSort === "created-asc") return -byCreatedDesc;
    if (waitingSort === "status")
      return (WAITING_STATUS_RANK[a.status] ?? 9) - (WAITING_STATUS_RANK[b.status] ?? 9) || byCreatedDesc;
    if (waitingSort === "kind") return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : byCreatedDesc;
    return 0;
  });
  // 结构化问题聚合（阶段 B）：同 category + factKey 的 open 项互为同组；无 factKey 的项自成一组。
  const waitingGroupOf = (w: WaitingItem): WaitingItem[] => {
    if (!w.factKey) return [w];
    return waiting.filter((x) => x.status === "open" && x.factKey === w.factKey && categoryOf(x) === categoryOf(w));
  };
  const liveText = !lastUpdated
    ? ""
    : mounted
      ? ` · 最近更新 ${relTime(lastUpdated, now)}（${utcSlice(lastUpdated)}）`
      : ` · 最近更新 ${utcSlice(lastUpdated)}`;

  const feedDelKey = (a: ActivityEntry) => `activity:${a.activityId}`;
  const waitingDelKey = (w: WaitingItem) => `waiting:${w.waitingId}`;

  return (
    <div className="content activity-page">
      <style>{`@keyframes act-pulse { 0% { opacity: 1; } 50% { opacity: 0.35; } 100% { opacity: 1; } } @keyframes act-flash { 0% { background: #dbeafe; } 100% { background: transparent; } } .activity-page table tbody tr:nth-child(even) { background: #f7fafd; } .activity-page table tbody tr:hover { background: #e8f1fb; }`}</style>
      <div className="head activity-head">
        <div className="hicon"><Activity size={24} strokeWidth={1.6} /></div>
        <div><div className="t"><h1>Activity</h1></div><p>执行进展与需要你介入的事项</p></div>
        <div className="acts"><button className={`btn${feedErr || engineHb && engineHb.status !== "online" ? " activity-diagnostic-warning" : ""}`} onClick={() => { closeDrawers(); setHealthOpen(true); }}><Info size={15} />{feedErr ? "读取异常" : engineHb && engineHb.status !== "online" ? "引擎离线" : pendingInbox.count > 0 ? `待入账 ${pendingInbox.count}` : "运行详情"}</button></div>
      </div>
      <div className="activity-overview">
        <button onClick={() => scrollToSection("activity-action")}>待我处理 <strong>{openCount}</strong></button>
        <button onClick={() => scrollToSection("activity-active")}>进行中 <strong>{distribution.running}</strong></button>
        <span>今日已提交 <strong>{overview.submittedToday ?? 0}</strong></span>
        <button onClick={() => { setFinishedOpen(true); scrollToSection("activity-done"); }}>异常 <strong>{distribution.failed + distribution.interrupted}</strong></button>
        <span className="activity-freshness">{!lastUpdated ? "正在读取活动…" : feedErr ? "显示上次成功数据" : `更新于 ${mounted ? relTime(lastUpdated, now) : utcSlice(lastUpdated)}`}</span>
      </div>
      <div id="activity-action" style={{ marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 10 }}>
          <div style={{ ...SECTION_HEAD, marginBottom: 0 }}>需要我处理{openCount > 0 ? `（${openCount}）` : ""}</div>
          {sortedWaiting.length === 0 && !waitingErr && <span style={{ color: "#666", fontSize: 13 }}>暂无待处理事项。</span>}
          {sortedWaiting.length > 0 && <div className="activity-filters" style={{ marginLeft: "auto" }}><label>排序<select value={waitingSort} onChange={event => setWaitingSort(event.target.value)}>{WAITING_SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>}
        </div>
        {waitingErr && <div style={{ color: "#8b1a1a", marginBottom: 12 }}>{waitingErr}</div>}
        {sortedWaiting.length > 0 && (
          <div style={TABLE_WRAP}>
            <table style={TABLE}>
              <thead>
                <tr>
                  <th style={TH}>问题</th>
                  <th style={TH}>状态</th>
                  <th style={TH}>来源</th>
                  <th style={TH}>更新</th>
                </tr>
              </thead>
              <tbody>
                {sortedWaiting.map((w) => (
                  <tr
                    key={w.waitingId}
                    onClick={() => { resetAction(); setFeedDrawerId(null); setHealthOpen(false); setWaitingDrawerId(w.waitingId); }}
                    style={{ cursor: "pointer", ...(flashWaiting.includes(w.waitingId) ? { animation: "act-flash 2s ease-out" } : {}) }}
                  >
                    <td style={{ ...TD, minWidth: 220, maxWidth: 420 }}><button className="activity-title" style={{ maxWidth: 420 }} title={w.question} onClick={event => { event.stopPropagation(); resetAction(); setFeedDrawerId(null); setHealthOpen(false); setWaitingDrawerId(w.waitingId); }}>{w.question}</button>{(() => { const g = waitingGroupOf(w); return g.length > 1 ? <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>同类问题 ×{g.length} · 涉及 {new Set(g.map((x) => x.jobId).filter(Boolean)).size || g.length} 个岗位</div> : null; })()}</td>
                    <td style={TD}>
                      <StatusCell status={w.status} />
                    </td>
                    <td style={{ ...TD, whiteSpace: "nowrap" }}>{w.sourceStage ? (STAGE_LABELS[w.sourceStage] ?? w.sourceStage) : "—"}</td>
                    <td style={{ ...TD, whiteSpace: "nowrap", color: "#666", fontSize: 13 }} title={utcSlice(w.createdAt)}>{compactTime(w.createdAt, now)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div id="activity-active" style={{ marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 10 }}>
          <div style={{ ...SECTION_HEAD, marginBottom: 0 }}>进行中 / 等外部</div>
          <div className="activity-filters" style={{ marginLeft: "auto" }}>
            <label>环节<select value={stageFilter ?? ""} onChange={event => changeStage(event.target.value || null)}><option value="">全部环节</option>{STAGES.map(stage => <option key={stage.id} value={stage.id}>{stage.label} · {stageCounts[stage.id] ?? 0}</option>)}</select></label>
            <label>排序<select value={feedSort} onChange={event => changeSort(event.target.value)}>{SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          </div>
        </div>
        {feedErr && <div style={{ color: "#8b1a1a", marginBottom: 12 }}>{feedErr}</div>}
        {feed.length === 0 && !feedErr && <div style={{ color: "#666" }}>当前没有进行中的活动。</div>}
        {feed.length > 0 && (
          <div style={TABLE_WRAP}>
            <table style={TABLE} className="activity-table">
              <thead><tr><th style={TH}>岗位</th><th style={TH}>状态</th><th style={TH}>最新进展</th><th style={TH}>下一步</th><th style={TH}>更新</th></tr></thead>
              <tbody>{feed.map(a => <ActivityFeedRow key={a.activityId} entry={a} now={now} flash={flashFeed.includes(a.activityId)} hasOpenWaiting={openWaitingActivityIds.has(a.activityId)} onOpen={() => { resetAction(); setWaitingDrawerId(null); setHealthOpen(false); setFeedDrawerId(a.activityId); }} />)}</tbody>
            </table>
          </div>
        )}
        {feedTotal > PAGE_SIZE && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
            <button disabled={feedPage <= 1} onClick={() => goFeedPage(feedPage - 1)} style={{ ...PILL, cursor: feedPage <= 1 ? "default" : "pointer" }}>
              上一页
            </button>
            <span style={{ fontSize: 13, color: "#666" }}>
              第 {feedPage} / {feedPages} 页，共 {feedTotal} 条
            </span>
            <button disabled={feedPage >= feedPages} onClick={() => goFeedPage(feedPage + 1)} style={{ ...PILL, cursor: feedPage >= feedPages ? "default" : "pointer" }}>
              下一页
            </button>
          </div>
        )}
      </div>
      <div id="activity-done" style={{ marginTop: 24 }}>
        <button onClick={() => setFinishedOpen(o => !o)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", ...SECTION_HEAD, display: "block" }}>已结束（{finishedTotal}）{finishedOpen ? " ▾" : " ▸"}</button>
        {finishedOpen && (
          <div>
            {finishedFeed.length === 0 && <div style={{ color: "#666" }}>暂无已结束活动。</div>}
            {finishedFeed.length > 0 && (
              <div style={TABLE_WRAP}>
                <table style={TABLE} className="activity-table">
                  <thead><tr><th style={TH}>岗位</th><th style={TH}>状态</th><th style={TH}>最新进展</th><th style={TH}>下一步</th><th style={TH}>更新</th></tr></thead>
                  <tbody>{finishedFeed.map(a => <ActivityFeedRow key={a.activityId} entry={a} now={now} hasOpenWaiting={openWaitingActivityIds.has(a.activityId)} onOpen={() => { resetAction(); setWaitingDrawerId(null); setHealthOpen(false); setFeedDrawerId(a.activityId); }} />)}</tbody>
                </table>
              </div>
            )}
            {finishedTotal > PAGE_SIZE && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
                <button disabled={finishedPage <= 1} onClick={() => goFinishedPage(finishedPage - 1)} style={{ ...PILL, cursor: finishedPage <= 1 ? "default" : "pointer" }}>
                  上一页
                </button>
                <span style={{ fontSize: 13, color: "#666" }}>
                  第 {finishedPage} / {finishedPages} 页，共 {finishedTotal} 条
                </span>
                <button disabled={finishedPage >= finishedPages} onClick={() => goFinishedPage(finishedPage + 1)} style={{ ...PILL, cursor: finishedPage >= finishedPages ? "default" : "pointer" }}>
                  下一页
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {healthOpen && <DetailDrawer title="运行详情" onClose={closeDrawers}>
        <h3 style={DRAWER_LABEL}>页面刷新</h3>
        <p>{feedErr ? "读取失败，显示上次成功数据" : "每轮完成后 2 秒刷新"}{liveText}</p>
        <h3 style={DRAWER_LABEL}>执行信号</h3>
        <p>{activeSignalCount > 0 ? `${activeSignalCount} 项有新鲜运行信号` : "暂无新鲜运行信号，不能据此判断 Agent 空闲。"}</p>
        <h3 style={DRAWER_LABEL}>Engine</h3>
        <p>{!engineHb ? "状态暂不可用" : engineHb.status === "online" ? `在线 · 心跳 ${engineHb.ageMs === null ? "未知" : `${Math.floor(engineHb.ageMs / 1000)} 秒前`}` : "离线或缺少心跳；新事件尚不能确认已处理。"}</p>
        {engineHb?.error && <p role="alert">{engineHb.error}</p>}
        <dl className="activity-metadata"><dt>最后任务</dt><dd>{engineHb?.lastTaskId ?? "—"}</dd><dt>心跳时间</dt><dd>{engineHb?.updatedAt ? utcSlice(engineHb.updatedAt) : "—"}</dd></dl>
        <h3 style={DRAWER_LABEL}>收件箱 · {pendingInbox.count} 项</h3>
        {pendingInbox.items.map(item => <div className="activity-detail-text" key={item.taskId}><strong>{item.event}</strong><p>{item.taskId}</p><small>{utcSlice(item.submittedAt)}</small></div>)}
        {pendingInbox.count === 0 && <p>没有等待处理的 inbox 事件。</p>}
        {pendingInbox.count > pendingInbox.items.length && <p>还有 {pendingInbox.count - pendingInbox.items.length} 项未在摘要中列出。</p>}
        {taskIssues.length > 0 && <><h3 style={DRAWER_LABEL}>关联数据问题</h3><ul>{taskIssues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></>}
      </DetailDrawer>}
      {feedDrawerId && !feedDrawer && <DetailDrawer title="活动详情" onClose={closeDrawers}><p role="status">活动详情暂不可用或已移除，请稍后重试。</p></DetailDrawer>}
      {feedDrawer && (() => {
        const a = feedDrawer;
        const stage = displayStage(a.kind, a.stage);
        const delKey = feedDelKey(a);
        const canDelete = a.status === "done" || a.status === "failed";
        return (
          <DetailDrawer title={a.title} onClose={closeDrawers}>
              <div style={{ marginTop: 10 }}>
                <span style={PILL}>{a.kind}</span>
                {stage ? <span style={PILL}>{STAGE_LABELS[stage]}</span> : <span style={PILL}>未归类</span>}
                <span style={{ ...PILL, color: statusColor(a.status) }}>{statusLabel(a.status)}</span>
              </div>
              <StageBar entry={a} />
              {a.status === "waiting" && waiting.some(w => w.sourceActivityId === a.activityId && w.status === "open") && <button className="btn" style={{ marginTop: 12 }} onClick={() => { const item = waiting.find(w => w.sourceActivityId === a.activityId && w.status === "open"); if (item) { closeDrawers(); setWaitingDrawerId(item.waitingId); } }}>处理待定事项</button>}
              {a.runtimeDetail && <p className="activity-detail-text">{a.runtimeDetail}</p>}
              <dl className="activity-metadata">
                <dt>开始时间</dt><dd>{a.startedAt ? utcSlice(a.startedAt) : "—"}</dd>
                <dt>结束时间</dt><dd>{a.finishedAt ? utcSlice(a.finishedAt) : "尚未结束"}</dd>
                <dt>活动编号</dt><dd>{a.activityId}</dd>
                <dt>运行编号</dt><dd>{a.runId ?? "未提供"}</dd>
                <dt>信号序号</dt><dd>{a.sequence ?? "未提供"}</dd>
                <dt>租约到期</dt><dd>{a.leaseExpiresAt ? utcSlice(a.leaseExpiresAt) : "未提供"}</dd>
              </dl>
              <div style={{ marginTop: 8, fontSize: 13 }}>
                {a.jobId ? <>关联岗位：<a href={`/jobs-applications?jobId=${encodeURIComponent(a.jobId)}`}>{a.jobId}</a> · 业务阶段：{a.businessStage ? BUSINESS_STAGE_LABELS[a.businessStage] : "关联数据不可用"}</> : "未关联岗位：历史或通用活动，不推断业务阶段。"}
              </div>
              {a.jobId && (() => {
                const plan = plans.find((p) => p.jobId === a.jobId && p.status !== "superseded" && (!a.runId || p.runId === a.runId)) ?? plans.find((p) => p.jobId === a.jobId && p.status !== "superseded");
                if (!plan) return null;
                return (
                  <div>
                    <div style={DRAWER_LABEL}>表单计划（v{plan.planVersion} · {plan.status === "approved" ? "已批准" : "待补齐"}）</div>
                    <div style={{ fontSize: 13, color: "#666" }}>简历版本 {plan.resumeVersion} · <a href={plan.formUrl} target="_blank" rel="noreferrer">表单页</a> · 哈希 {plan.planHash.slice(0, 12)}</div>
                    <div style={{ fontSize: 14, marginTop: 6 }}>
                      {plan.fields.map((f) => (
                        <div key={f.fieldKey} style={{ padding: "4px 0", borderBottom: "1px solid #eef3f9" }}>
                          <span>{f.pageLabel}</span>
                          <span style={{ color: "#333" }}>：{planValueText(f)}</span>
                          {f.key && <span style={{ ...PILL, marginLeft: 8 }}>关键</span>}
                          {f.source && <span style={{ fontSize: 12, color: "#666" }}>来源 {f.source.kind}：{f.source.ref}</span>}
                        </div>
                      ))}
                    </div>
                    {plan.blockers.length > 0 && (
                      <div style={{ fontSize: 13, color: "#8b1a1a", marginTop: 6 }}>阻塞项：{plan.blockers.join("；")}</div>
                    )}
                  </div>
                );
              })()}
              {a.jobId && (() => {
                const plan = plans.find((p) => p.jobId === a.jobId && p.status !== "superseded" && (!a.runId || p.runId === a.runId)) ?? plans.find((p) => p.jobId === a.jobId && p.status !== "superseded");
                const cps = checkpoints.filter((c) => c.jobId === a.jobId && (!plan || c.planId === plan.planId));
                const ats = attempts.filter((t) => t.jobId === a.jobId);
                if (cps.length === 0 && ats.length === 0) return null;
                const latestByType: Record<string, CheckpointRecord> = {};
                for (const c of cps) {
                  const prev = latestByType[c.type];
                  if (!prev || c.createdAt >= prev.createdAt) latestByType[c.type] = c;
                }
                return (
                  <div>
                    <div style={DRAWER_LABEL}>检查点与提交尝试</div>
                    {["after-upload", "after-parse", "on-page-change", "pre-submit"].filter((t) => latestByType[t]).map((t) => {
                      const c = latestByType[t];
                      const bad = c.results.filter((r) => r.result === "mismatch" || r.result === "unreadable");
                      return (
                        <div key={t} style={{ padding: "4px 0", borderBottom: "1px solid #eef3f9", fontSize: 14 }}>
                          <span>{CHECKPOINT_TYPE_LABELS[t] ?? t}检查点</span>
                          <span style={{ ...PILL, marginLeft: 8 }}>{c.status === "passed" ? "通过" : "未通过"}</span>
                          {bad.map((r) => (
                            <div key={r.fieldKey} style={{ fontSize: 13, color: "#8b1a1a" }}>{r.fieldKey}：计划 {readbackText(r.expected)} · 读回 {readbackText(r.readback)}（{r.result === "mismatch" ? "不一致" : "读不到"}）</div>
                          ))}
                          {c.missingKeyFields.length > 0 && (
                            <div style={{ fontSize: 13, color: "#8b1a1a" }}>未覆盖关键字段：{c.missingKeyFields.join("、")}</div>
                          )}
                        </div>
                      );
                    })}
                    {ats.map((t) => (
                      <div key={t.attemptId} style={{ padding: "4px 0", borderBottom: "1px solid #eef3f9", fontSize: 14 }}>
                        <span>提交尝试 {t.attemptId}</span>
                        <span style={{ ...PILL, marginLeft: 8 }}>{ATTEMPT_STATUS_LABELS[t.effectiveStatus] ?? t.effectiveStatus}</span>
                        {t.effectiveStatus === "uncertain-timeout" && (
                          <div style={{ fontSize: 13, color: "#8b1a1a" }}>已超过 30 分钟未落定：按结果不确定处理，先核查再决定，禁止直接重投。</div>
                        )}
                        <div style={{ fontSize: 13, color: "#666" }}>授权引用 {t.approvalRef}{t.applicationId ? ` · 已入账 ${t.applicationId}` : ""} · 记录于 {utcSlice(t.createdAt)}</div>
                        {t.evidence.length > 0 && (
                          <div style={{ fontSize: 13, color: "#444" }}>
                            {t.evidence.map((e, i) => (
                              <div key={i}>[{e.kind}] {e.text}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })()}
              {a.note && (
                <div>
                  <div style={DRAWER_LABEL}>摘要</div>
                  <div style={{ fontSize: 14 }}>{a.note}</div>
                </div>
              )}
              {a.refs.length > 0 && (
                <div>
                  <div style={DRAWER_LABEL}>引用</div>
                  <div style={{ fontSize: 14, color: "#444" }}>
                    {a.refs.map((r, i) => (
                      <div key={i}>{r}</div>
                    ))}
                  </div>
                </div>
              )}
              {(a.evidence ?? []).length > 0 && (
                <div>
                  <div style={DRAWER_LABEL}>证据（{a.evidence.length} 条）</div>
                  <div style={{ fontSize: 14, color: "#444" }}>
                    {(a.evidence ?? []).map((e, i) => (
                      <div key={i}>
                        [{e.kind}] {e.text}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ marginTop: 12, background: "#f7fafd", border: "1px solid #dbe7f3", borderRadius: 8, padding: "8px 10px" }}>
                <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>发给 Agent 的话</div>
                <div style={{ fontSize: 14, display: "flex", gap: 6, alignItems: "flex-start" }}>
                  <span style={{ flex: 1 }}>{buildRerunText(a.title)}</span>
                  <button aria-label="复制任务" onClick={() => void copyRelay(a.activityId, buildRerunText(a.title, a))} style={{ border: "none", background: "none", cursor: "pointer", padding: 2, flexShrink: 0, color: "#2563eb" }}>
                    <Copy size={16} />{copied[a.activityId] && <Check size={14} />}
                  </button>
                </div>
                {copied[a.activityId] && <div style={{ fontSize: 13, color: "#1a7f37", marginTop: 4 }}>已复制，去聊天里粘贴发送。</div>}
                <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>复制后交给执行端核对，确认 Receipt 与运行状态后再决定是否重跑。</div>
              </div>
              <div style={{ fontSize: 13, color: "#666", marginTop: 16, borderTop: "1px solid #eef3f9", paddingTop: 10 }}>
                {utcSlice(a.createdAt)}
                {a.taskId ? ` · ${a.taskId}` : ""}
              </div>
              {canDelete && (
                <div style={{ marginTop: 14 }}>
                  {deleteSubmitted.includes(delKey) ? (
                    <span style={{ color: "#1a7f37", fontSize: 14 }}>已提交删除，待引擎处理。</span>
                  ) : deleteConfirm === delKey ? (
                    <span style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => submitDelete("activity", a.activityId)} style={{ ...PILL, cursor: "pointer", color: "#8b1a1a" }}>
                        确认删除？
                      </button>
                      <button onClick={() => setDeleteConfirm(null)} style={{ ...PILL, cursor: "pointer" }}>
                        取消
                      </button>
                    </span>
                  ) : (
                    <button onClick={() => setDeleteConfirm(delKey)} style={{ ...PILL, cursor: "pointer" }}>
                      删除
                    </button>
                  )}
                  {deleteErr[delKey] && <div style={{ color: "#8b1a1a", fontSize: 13, marginTop: 6 }}>{deleteErr[delKey]}</div>}
                </div>
              )}
          </DetailDrawer>
        );
      })()}
      {waitingDrawer && (() => {
        const w = waitingDrawer;
        const delKey = waitingDelKey(w);
        const canDelete = w.status === "answered" || w.status === "parked";
        const isOpen = w.status === "open" && !submitted.includes(w.waitingId);
        return (
          <DetailDrawer title={w.question} onClose={closeDrawers}>
              <div style={{ marginTop: 10 }}>
                <span style={PILL}>{w.kind}</span>
                {w.sourceStage && <span style={PILL}>{STAGE_LABELS[w.sourceStage] ?? w.sourceStage}</span>}
                {(w.category || w.factKey) && <span style={PILL}>{CATEGORY_LABELS[categoryOf(w)] ?? categoryOf(w)}</span>}
                <span style={{ ...PILL, color: statusColor(w.status) }}>{statusLabel(w.status)}</span>
              </div>
              {w.context.length > 0 && (
                <div>
                  <div style={DRAWER_LABEL}>背景</div>
                  <ul style={{ margin: 0, fontSize: 14 }}>
                    {w.context.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}
              {((w.candidates && w.candidates.length > 0) || (w.checkedSources && w.checkedSources.length > 0) || w.blocksStep || waitingGroupOf(w).length > 1) && (
                <div>
                  <div style={DRAWER_LABEL}>结构化信息</div>
                  <div style={{ fontSize: 14 }}>
                    {w.factKey && <div>事实键：{w.factKey}</div>}
                    {w.blocksStep && <div>阻塞步骤：{w.blocksStep}</div>}
                    {w.jobId && <div>关联岗位：{w.jobId}</div>}
                    {w.candidates && w.candidates.length > 0 && (
                      <div>候选答复：
                        <ul style={{ margin: 0 }}>
                          {w.candidates.map((c, i) => (<li key={i}>{c}</li>))}
                        </ul>
                      </div>
                    )}
                    {w.checkedSources && w.checkedSources.length > 0 && <div>已核查来源：{w.checkedSources.join("、")}</div>}
                    {waitingGroupOf(w).length > 1 && <div>同类问题共 {waitingGroupOf(w).length} 项（{waitingGroupOf(w).map((x) => x.waitingId).join("、")}），答复会逐项记档。</div>}
                  </div>
                </div>
              )}
              {w.sourceActivityId && <div style={{ fontSize: 13, color: "#666", marginTop: 10 }}>来源活动：{w.sourceActivityId}</div>}
              {w.status !== "open" && w.answer !== null && (
                <div>
                  <div style={DRAWER_LABEL}>答复</div>
                  <div style={{ fontSize: 14 }}>
                    {w.answer || "（先放着）"}
                    {w.answeredAt && <span style={{ fontSize: 13, color: "#666" }}> · {utcSlice(w.answeredAt)}</span>}
                  </div>
                </div>
              )}
              {w.status === "answered" && w.answerScope && (
                <div style={{ fontSize: 13, color: "#666", marginTop: 8 }}>答复范围：{w.answerScope === "standing" ? "保存为长期约定" : "仅本次使用"}</div>
              )}
              {w.resumeState === "answered-pending-resume" && (
                <div style={{ fontSize: 13, color: "#b45309", marginTop: 4 }}>已答复，待执行端读取并续跑。</div>
              )}
              {w.resumeState === "resumed" && (
                <div style={{ fontSize: 13, color: "#1a7f37", marginTop: 4 }}>执行端已续跑。</div>
              )}
              {isOpen && (
                <div>
                  <div style={{ marginBottom: 12, background: "#f7fafd", border: "1px solid #dbe7f3", borderRadius: 8, padding: "8px 10px", fontSize: 13, color: "#333" }}>
                    <div style={{ fontWeight: 400, marginBottom: 4 }}>怎么处理这一项</div>
                    {w.kind === "manual-step" ? (
                      <ol style={{ margin: 0, paddingLeft: 18 }}>
                        <li>需要登录 / 安全卡的步骤在聊天里完成；不确定怎么做，先复制下方“给 Muse 的指令”发到聊天，Muse 会带着你走。</li>
                        <li>做完回来点“已完成”提交；没做就点“先放着”。</li>
                        <li>再复制“发给 Agent 的话”发到聊天，执行端确认后继续。</li>
                      </ol>
                    ) : w.kind === "approval" ? (
                      <ol style={{ margin: 0, paddingLeft: 18 }}>
                        <li>看不懂背景时，先复制下方“给 Muse 的指令”发到聊天，让 Muse 把相关记录查清楚，再决定。</li>
                        <li>点“同意”/“不同意”，或在框里写带条件的答复，然后点“提交答复”（只记档，引擎随后处理）。</li>
                        <li>复制“发给 Agent 的话”发到聊天；执行端读取决定并实际恢复后，活动才更新为进行中。</li>
                      </ol>
                    ) : (
                      <ol style={{ margin: 0, paddingLeft: 18 }}>
                        <li>不用自己找记录：复制下方“给 Muse 的指令”发到聊天，Muse 会查 JobPipe 记录、Gmail 和简历，能答的直接答，只有必须你本人拍板的才会问你。</li>
                        <li>想自己答：在框里写答复，点“提交答复”，再复制“发给 Agent 的话”发到聊天。</li>
                        <li>还没想好，就点“先放着”。</li>
                      </ol>
                    )}
                  </div>
                  <div style={{ marginBottom: 12, background: "#eef4fb", border: "1px solid #c7dbf2", borderRadius: 8, padding: "8px 10px" }}>
                    <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>给 Muse 的指令（复制后粘贴到聊天，不用自己找记录）</div>
                    <div style={{ fontSize: 13, color: "#333", display: "flex", gap: 6, alignItems: "flex-start" }}>
                      <span style={{ flex: 1, whiteSpace: "pre-wrap" }}>{buildSolveRequestText(w)}</span>
                      <button aria-label="复制给 Muse 的指令" onClick={() => void copyRelay(`solve-${w.waitingId}`, buildSolveRequestText(w))} style={{ border: "none", background: "none", cursor: "pointer", padding: 2, flexShrink: 0, color: "#2563eb" }}>
                        <Copy size={16} />{copied[`solve-${w.waitingId}`] && <Check size={14} />}
                      </button>
                    </div>
                    {copied[`solve-${w.waitingId}`] && <div style={{ fontSize: 13, color: "#1a7f37", marginTop: 4 }}>已复制，去聊天里粘贴发送给 Muse。</div>}
                    <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>Muse 会先查 JobPipe 记录、Gmail 和简历再处理；只有必须你本人拍板的，才会问你。</div>
                  </div>
                  <div style={DRAWER_LABEL}>答复原文</div>
                  <textarea
                    value={answers[w.waitingId] ?? ""}
                    onChange={(e) => setAnswers((m) => ({ ...m, [w.waitingId]: e.target.value }))}
                    rows={4}
                    style={TEXTAREA}
                    placeholder="输入答复原文"
                  />
                  {w.kind === "manual-step" && (
                    <div style={{ fontSize: 13, color: "#666", marginTop: 6 }}>这一步在聊天里完成（安全卡 / 登录），做完后回来写“已完成”提交；还没做就点“先放着”。</div>
                  )}
                  {answerErr[w.waitingId] && <div style={{ color: "#8b1a1a", fontSize: 13, marginTop: 6 }}>{answerErr[w.waitingId]}</div>}
                  {categoryOf(w) === "approval" ? (
                    <div style={{ fontSize: 13, color: "#666", marginTop: 10 }}>审批类答复仅对本次有效，不会保存为长期约定。</div>
                  ) : (
                    <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
                      <span style={{ fontSize: 13, color: "#666" }}>答复范围</span>
                      <button onClick={() => setAnswerScopes((m) => ({ ...m, [w.waitingId]: "once" }))} style={{ ...PILL, cursor: "pointer", ...((answerScopes[w.waitingId] ?? "once") === "once" ? { background: "#e8f1fb" } : {}) }}>仅本次使用</button>
                      <button onClick={() => setAnswerScopes((m) => ({ ...m, [w.waitingId]: "standing" }))} style={{ ...PILL, cursor: "pointer", ...((answerScopes[w.waitingId] ?? "once") === "standing" ? { background: "#e8f1fb" } : {}) }}>保存为长期约定</button>
                    </div>
                  )}
                  {w.kind === "approval" && (
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <button onClick={() => submitAnswer(w.waitingId, "answer", "同意")} style={{ ...PILL, cursor: "pointer", background: "#e8f1fb" }}>
                        同意
                      </button>
                      <button onClick={() => submitAnswer(w.waitingId, "answer", "不同意")} style={{ ...PILL, cursor: "pointer" }}>
                        不同意
                      </button>
                    </div>
                  )}
                  {w.kind === "manual-step" && (
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <button onClick={() => submitAnswer(w.waitingId, "answer", "已完成")} style={{ ...PILL, cursor: "pointer", background: "#e8f1fb" }}>
                        已完成
                      </button>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button onClick={() => submitAnswer(w.waitingId, "answer")} style={{ ...PILL, cursor: "pointer", background: "#e8f1fb" }}>
                      提交答复
                    </button>
                    <button onClick={() => submitAnswer(w.waitingId, "park")} style={{ ...PILL, cursor: "pointer" }}>
                      先放着
                    </button>
                  </div>
                  {(answers[w.waitingId] ?? "").trim() && (
                    <div style={{ marginTop: 12, background: "#f7fafd", border: "1px solid #dbe7f3", borderRadius: 8, padding: "8px 10px" }}>
                      <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>发给 Agent 的话</div>
                      <div style={{ fontSize: 14, display: "flex", gap: 6, alignItems: "flex-start" }}>
                        <span style={{ flex: 1 }}>{buildRelayText(w.question, answers[w.waitingId] ?? "")}</span>
                        <button aria-label="复制发给 Agent 的话" onClick={() => void copyRelay(w.waitingId, buildRelayText(w.question, answers[w.waitingId] ?? ""))} style={{ border: "none", background: "none", cursor: "pointer", padding: 2, flexShrink: 0, color: "#2563eb" }}>
                          <Copy size={16} />{copied[w.waitingId] && <Check size={14} />}
                        </button>
                      </div>
                      {copied[w.waitingId] && <div style={{ fontSize: 13, color: "#1a7f37", marginTop: 4 }}>已复制，去聊天里粘贴发送。</div>}
                      <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>抽屉答复只记档；要让浏览器立刻动起来，请把这句话发给 Agent。</div>
                    </div>
                  )}
                </div>
              )}
              {w.status === "open" && submitted.includes(w.waitingId) && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ color: "#1a7f37", fontSize: 14 }}>已提交答复，待引擎处理。</div>
                  <div style={{ marginTop: 10, background: "#f7fafd", border: "1px solid #dbe7f3", borderRadius: 8, padding: "8px 10px" }}>
                    <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>发给 Agent 的话</div>
                    <div style={{ fontSize: 14, display: "flex", gap: 6, alignItems: "flex-start" }}>
                      <span style={{ flex: 1 }}>{buildRelayText(w.question, answers[w.waitingId] ?? "")}</span>
                      <button aria-label="复制发给 Agent 的话" onClick={() => void copyRelay(w.waitingId, buildRelayText(w.question, answers[w.waitingId] ?? ""))} style={{ border: "none", background: "none", cursor: "pointer", padding: 2, flexShrink: 0, color: "#2563eb" }}>
                        <Copy size={16} />{copied[w.waitingId] && <Check size={14} />}
                      </button>
                    </div>
                    {copied[w.waitingId] ? (
                      <div style={{ fontSize: 13, color: "#1a7f37", marginTop: 4 }}>已复制，去聊天里粘贴发送。</div>
                    ) : (
                      <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>抽屉答复只记档；要让浏览器立刻动起来，请把这句话发给 Agent。</div>
                    )}
                  </div>
                </div>
              )}
              <div style={{ fontSize: 13, color: "#666", marginTop: 16, borderTop: "1px solid #eef3f9", paddingTop: 10 }}>
                {utcSlice(w.createdAt)}
              </div>
              {canDelete && (
                <div style={{ marginTop: 14 }}>
                  {deleteSubmitted.includes(delKey) ? (
                    <span style={{ color: "#1a7f37", fontSize: 14 }}>已提交删除，待引擎处理。</span>
                  ) : deleteConfirm === delKey ? (
                    <span style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => submitDelete("waiting", w.waitingId)} style={{ ...PILL, cursor: "pointer", color: "#8b1a1a" }}>
                        确认删除？
                      </button>
                      <button onClick={() => setDeleteConfirm(null)} style={{ ...PILL, cursor: "pointer" }}>
                        取消
                      </button>
                    </span>
                  ) : (
                    <button onClick={() => setDeleteConfirm(delKey)} style={{ ...PILL, cursor: "pointer" }}>
                      删除
                    </button>
                  )}
                  {deleteErr[delKey] && <div style={{ color: "#8b1a1a", fontSize: 13, marginTop: 6 }}>{deleteErr[delKey]}</div>}
                </div>
              )}
          </DetailDrawer>
        );
      })()}
    </div>
  );
}
